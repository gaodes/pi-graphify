import { ToolBody, ToolCallHeader, ToolFooter } from "@gaodes/pi-utils-ui";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { defineTool, truncateHead } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import type { ResolvedConfig } from "../config";
import type { ExecFn } from "../lib/runner";
import {
	addUrl,
	buildGraph,
	clusterOnly,
	detectPython,
	ensureInstalled,
	explainNode,
	findPath,
	queryGraph,
	startWatch,
	updateGraph,
} from "../lib/runner";

// ---------------------------------------------------------------------------
// Shared exec adapter — wraps pi.exec(command, args[], opts) → ExecFn
// ---------------------------------------------------------------------------

function createExec(pi: ExtensionAPI, cwd: string): ExecFn {
	return async (command, options) => {
		const result = await pi.exec("sh", ["-c", command], {
			cwd: options?.cwd ?? cwd,
			signal: options?.signal,
		});
		return {
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: result.code,
		};
	};
}

// ---------------------------------------------------------------------------
// graphify_build
// ---------------------------------------------------------------------------

const buildParameters = Type.Object({
	path: Type.String({ description: "Directory path to build graph from" }),
	mode: Type.Optional(
		Type.Union([Type.Literal("standard"), Type.Literal("deep")], {
			description: "Extraction mode: 'deep' for more aggressive relationship inference",
		}),
	),
	no_viz: Type.Optional(Type.Boolean({ description: "Skip HTML visualization" })),
	obsidian: Type.Optional(Type.Boolean({ description: "Generate Obsidian vault" })),
	svg: Type.Optional(Type.Boolean({ description: "Export graph.svg" })),
	graphml: Type.Optional(Type.Boolean({ description: "Export graph.graphml" })),
	neo4j: Type.Optional(Type.Boolean({ description: "Generate cypher.txt for Neo4j" })),
});

type BuildParams = Static<typeof buildParameters>;

interface BuildDetails {
	path: string;
	nodes: number;
	edges: number;
	communities: number;
	outputDir: string;
}

export function createBuildTool(pi: ExtensionAPI, config: ResolvedConfig) {
	return defineTool({
		name: "graphify_build",
		label: "Graphify Build",
		description:
			"Build a knowledge graph from a directory. Runs the full pipeline: file detection, entity/relationship extraction, community detection, and output generation (HTML, JSON, report).",
		parameters: buildParameters,
		promptSnippet: "Use graphify_build to create a knowledge graph from any directory of files.",
		promptGuidelines: [
			"Call graphify_build before graphify_query, graphify_path, or graphify_explain — those tools require an existing graph.",
			"Provide the exact directory path. Use '.' for the current directory.",
		],

		async execute(
			_toolCallId: string,
			params: BuildParams,
			signal: AbortSignal,
			onUpdate: AgentToolUpdateCallback<BuildDetails> | undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<BuildDetails>> {
			const exec = createExec(pi, ctx.cwd);
			const python = await detectPython(exec, config.pythonPath, ctx.cwd, signal);
			await ensureInstalled(exec, python, ctx.cwd, signal);

			const result = await buildGraph(
				exec,
				python,
				ctx.cwd,
				{
					inputPath: params.path,
					mode: params.mode ?? "standard",
					noViz: params.no_viz,
					obsidian: params.obsidian,
					svg: params.svg,
					graphml: params.graphml,
					neo4j: params.neo4j,
				},
				signal,
				(msg) =>
					onUpdate?.({
						content: [{ type: "text", text: msg }],
						details: {} as BuildDetails,
					}),
			);

			return {
				content: [
					{
						type: "text",
						text: `Graph built: ${result.nodes} nodes, ${result.edges} edges, ${result.communities} communities. Output in ${config.outputDir}/`,
					},
				],
				details: {
					path: params.path,
					nodes: result.nodes,
					edges: result.edges,
					communities: result.communities,
					outputDir: config.outputDir,
				},
			};
		},

		renderCall(params: BuildParams, theme: Theme) {
			const optionArgs: Array<{ label: string; value: string }> = [];
			if (params.mode === "deep") optionArgs.push({ label: "mode", value: "deep" });
			if (params.no_viz) optionArgs.push({ label: "no-viz", value: "true" });
			if (params.obsidian) optionArgs.push({ label: "obsidian", value: "true" });
			if (params.svg) optionArgs.push({ label: "svg", value: "true" });
			if (params.graphml) optionArgs.push({ label: "graphml", value: "true" });
			if (params.neo4j) optionArgs.push({ label: "neo4j", value: "true" });
			return new ToolCallHeader(
				{
					toolName: "Graphify",
					action: "build",
					mainArg: params.path,
					optionArgs,
					showColon: true,
				},
				theme,
			);
		},

		renderResult(
			result: AgentToolResult<BuildDetails>,
			options: ToolRenderResultOptions,
			theme: Theme,
		) {
			if (options.isPartial) {
				return new Text(theme.fg("muted", "Graphify: building graph..."), 0, 0);
			}

			const details = result.details as BuildDetails | undefined;
			if (!details?.nodes) {
				const textBlock = result.content.find((c) => c.type === "text");
				const errorMsg = (textBlock?.type === "text" && textBlock.text) || "Build failed";
				return new Text(theme.fg("error", errorMsg), 0, 0);
			}

			return new ToolBody(
				{
					fields: [
						{
							label: "Graph",
							value: `${details.nodes} nodes | ${details.edges} edges | ${details.communities} communities`,
							showCollapsed: false,
						},
						{ label: "Path", value: details.path, showCollapsed: true },
						{ label: "Output", value: details.outputDir, showCollapsed: true },
					],
					footer: new ToolFooter(theme, {
						items: [{ label: "status", value: "complete" }],
						separator: " | ",
					}),
					includeSpacerBeforeFooter: true,
				},
				options,
				theme,
			);
		},
	});
}

// ---------------------------------------------------------------------------
// graphify_query
// ---------------------------------------------------------------------------

const queryParameters = Type.Object({
	question: Type.String({ description: "Natural language question to answer from the graph" }),
	mode: Type.Optional(
		Type.Union([Type.Literal("bfs"), Type.Literal("dfs")], {
			description: "Traversal mode: bfs (broad context) or dfs (trace a specific path)",
		}),
	),
	budget: Type.Optional(
		Type.Number({ description: "Token budget for the answer (default 2000)", default: 2000 }),
	),
});

type QueryParams = Static<typeof queryParameters>;

interface QueryDetails {
	question: string;
	mode: string;
	result: string;
}

export function createQueryTool(pi: ExtensionAPI, config: ResolvedConfig) {
	return defineTool({
		name: "graphify_query",
		label: "Graphify Query",
		description:
			"Query the knowledge graph using BFS (broad context) or DFS (trace a path). Requires an existing graph built with graphify_build.",
		parameters: queryParameters,
		promptSnippet:
			"Use graphify_query to answer questions about a codebase using its knowledge graph.",
		promptGuidelines: [
			"Run graphify_build before graphify_query — the graph must exist first.",
			"Use BFS mode for 'what is X connected to?' questions.",
			"Use DFS mode for 'how does X reach Y?' questions.",
		],

		async execute(
			_toolCallId: string,
			params: QueryParams,
			signal: AbortSignal,
			_onUpdate: AgentToolUpdateCallback<QueryDetails> | undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<QueryDetails>> {
			const exec = createExec(pi, ctx.cwd);
			const python = await detectPython(exec, config.pythonPath, ctx.cwd, signal);
			await ensureInstalled(exec, python, ctx.cwd, signal);

			const queryResult = await queryGraph(
				exec,
				python,
				ctx.cwd,
				{
					question: params.question,
					mode: params.mode ?? "bfs",
					budget: params.budget,
				},
				signal,
			);

			return {
				content: [{ type: "text", text: queryResult }],
				details: {
					question: params.question,
					mode: params.mode ?? "bfs",
					result: queryResult,
				},
			};
		},

		renderCall(params: QueryParams, theme: Theme) {
			return new ToolCallHeader(
				{
					toolName: "Graphify",
					action: "query",
					mainArg: params.question,
					optionArgs: [
						...(params.mode === "dfs" ? [{ label: "mode", value: "dfs" }] : []),
						...(params.budget ? [{ label: "budget", value: String(params.budget) }] : []),
					],
					showColon: true,
				},
				theme,
			);
		},

		renderResult(
			result: AgentToolResult<QueryDetails>,
			options: ToolRenderResultOptions,
			theme: Theme,
		) {
			if (options.isPartial) {
				return new Text(theme.fg("muted", "Graphify: querying graph..."), 0, 0);
			}

			const details = result.details as QueryDetails | undefined;
			if (!details?.result) {
				const textBlock = result.content.find((c) => c.type === "text");
				const errorMsg = (textBlock?.type === "text" && textBlock.text) || "Query failed";
				return new Text(theme.fg("error", errorMsg), 0, 0);
			}

			const truncated = truncateHead(details.result, {
				maxBytes: 50000,
				maxLines: 2000,
			});

			return new ToolBody(
				{
					fields: [
						{ label: "Mode", value: details.mode.toUpperCase(), showCollapsed: true },
						{ label: "Question", value: details.question, showCollapsed: true },
						{ label: "Result", value: truncated.content, showCollapsed: false },
					],
					footer: truncated.truncated
						? new ToolFooter(theme, {
								items: [
									{
										label: "lines",
										value: `${truncated.outputLines}/${truncated.totalLines}`,
									},
								],
								separator: " | ",
							})
						: undefined,
					includeSpacerBeforeFooter: true,
				},
				options,
				theme,
			);
		},
	});
}

// ---------------------------------------------------------------------------
// graphify_path
// ---------------------------------------------------------------------------

const pathParameters = Type.Object({
	from: Type.String({ description: "Starting concept name" }),
	to: Type.String({ description: "Target concept name" }),
});

type PathParams = Static<typeof pathParameters>;

interface PathDetails {
	from: string;
	to: string;
	result: string;
}

export function createPathTool(pi: ExtensionAPI, config: ResolvedConfig) {
	return defineTool({
		name: "graphify_path",
		label: "Graphify Path",
		description:
			"Find the shortest path between two concepts in the knowledge graph. Requires an existing graph.",
		parameters: pathParameters,
		promptSnippet:
			"Use graphify_path to trace connections between two concepts in the knowledge graph.",
		promptGuidelines: [
			"Both concepts must exist as nodes in the graph.",
			"Use concept names that appear in graph node labels.",
		],

		async execute(
			_toolCallId: string,
			params: PathParams,
			signal: AbortSignal,
			_onUpdate: AgentToolUpdateCallback<PathDetails> | undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<PathDetails>> {
			const exec = createExec(pi, ctx.cwd);
			const python = await detectPython(exec, config.pythonPath, ctx.cwd, signal);
			await ensureInstalled(exec, python, ctx.cwd, signal);

			const pathResult = await findPath(exec, python, ctx.cwd, params.from, params.to, signal);

			return {
				content: [{ type: "text", text: pathResult }],
				details: { from: params.from, to: params.to, result: pathResult },
			};
		},

		renderCall(params: PathParams, theme: Theme) {
			return new ToolCallHeader(
				{
					toolName: "Graphify",
					action: "path",
					mainArg: `${params.from} → ${params.to}`,
					showColon: true,
				},
				theme,
			);
		},

		renderResult(
			result: AgentToolResult<PathDetails>,
			options: ToolRenderResultOptions,
			theme: Theme,
		) {
			if (options.isPartial) {
				return new Text(theme.fg("muted", "Graphify: finding path..."), 0, 0);
			}

			const details = result.details as PathDetails | undefined;
			if (!details?.result) {
				const textBlock = result.content.find((c) => c.type === "text");
				const errorMsg = (textBlock?.type === "text" && textBlock.text) || "Path not found";
				return new Text(theme.fg("error", errorMsg), 0, 0);
			}

			return new ToolBody(
				{
					fields: [
						{
							label: "Path",
							value: `${details.from} → ${details.to}`,
							showCollapsed: true,
						},
						{ label: "Result", value: details.result, showCollapsed: false },
					],
				},
				options,
				theme,
			);
		},
	});
}

// ---------------------------------------------------------------------------
// graphify_explain
// ---------------------------------------------------------------------------

const explainParameters = Type.Object({
	concept: Type.String({ description: "Name of the concept/node to explain" }),
});

type ExplainParams = Static<typeof explainParameters>;

interface ExplainDetails {
	concept: string;
	result: string;
}

export function createExplainTool(pi: ExtensionAPI, config: ResolvedConfig) {
	return defineTool({
		name: "graphify_explain",
		label: "Graphify Explain",
		description:
			"Explain a concept from the knowledge graph — shows everything connected to it. Requires an existing graph.",
		parameters: explainParameters,
		promptSnippet:
			"Use graphify_explain to get a plain-language explanation of a concept and all its connections in the graph.",
		promptGuidelines: [
			"graphify_explain works best with concept names that appear as node labels in the graph.",
		],

		async execute(
			_toolCallId: string,
			params: ExplainParams,
			signal: AbortSignal,
			_onUpdate: AgentToolUpdateCallback<ExplainDetails> | undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<ExplainDetails>> {
			const exec = createExec(pi, ctx.cwd);
			const python = await detectPython(exec, config.pythonPath, ctx.cwd, signal);
			await ensureInstalled(exec, python, ctx.cwd, signal);

			const explainResult = await explainNode(exec, python, ctx.cwd, params.concept, signal);

			return {
				content: [{ type: "text", text: explainResult }],
				details: { concept: params.concept, result: explainResult },
			};
		},

		renderCall(params: ExplainParams, theme: Theme) {
			return new ToolCallHeader(
				{
					toolName: "Graphify",
					action: "explain",
					mainArg: params.concept,
					showColon: true,
				},
				theme,
			);
		},

		renderResult(
			result: AgentToolResult<ExplainDetails>,
			options: ToolRenderResultOptions,
			theme: Theme,
		) {
			if (options.isPartial) {
				return new Text(theme.fg("muted", "Graphify: explaining node..."), 0, 0);
			}

			const details = result.details as ExplainDetails | undefined;
			if (!details?.result) {
				const textBlock = result.content.find((c) => c.type === "text");
				const errorMsg = (textBlock?.type === "text" && textBlock.text) || "Explain failed";
				return new Text(theme.fg("error", errorMsg), 0, 0);
			}

			return new ToolBody(
				{
					fields: [
						{ label: "Concept", value: details.concept, showCollapsed: true },
						{ label: "Details", value: details.result, showCollapsed: false },
					],
				},
				options,
				theme,
			);
		},
	});
}

// ---------------------------------------------------------------------------
// graphify_add
// ---------------------------------------------------------------------------

const addParameters = Type.Object({
	url: Type.String({ description: "URL to fetch and add to the corpus" }),
	author: Type.Optional(Type.String({ description: "Author of the content" })),
	contributor: Type.Optional(Type.String({ description: "Who added this to the corpus" })),
});

type AddParams = Static<typeof addParameters>;

interface AddDetails {
	url: string;
	savedTo: string;
}

export function createAddTool(pi: ExtensionAPI, config: ResolvedConfig) {
	return defineTool({
		name: "graphify_add",
		label: "Graphify Add",
		description:
			"Fetch a URL (paper, tweet, PDF, image, webpage) and add it to the corpus. Then update the graph.",
		parameters: addParameters,
		promptSnippet: "Use graphify_add to fetch a URL and incorporate it into the knowledge graph.",
		promptGuidelines: [
			"graphify_add fetches the content and runs an incremental graph update automatically.",
			"Supports arXiv papers, Twitter/X, PDFs, images, and general web pages.",
		],

		async execute(
			_toolCallId: string,
			params: AddParams,
			signal: AbortSignal,
			onUpdate: AgentToolUpdateCallback<AddDetails> | undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<AddDetails>> {
			const exec = createExec(pi, ctx.cwd);
			const python = await detectPython(exec, config.pythonPath, ctx.cwd, signal);
			await ensureInstalled(exec, python, ctx.cwd, signal);

			onUpdate?.({
				content: [{ type: "text", text: `Fetching ${params.url}...` }],
				details: {} as AddDetails,
			});

			const savedTo = await addUrl(
				exec,
				python,
				ctx.cwd,
				{
					url: params.url,
					author: params.author,
					contributor: params.contributor,
				},
				signal,
			);

			onUpdate?.({
				content: [{ type: "text", text: "Updating graph with new content..." }],
				details: {} as AddDetails,
			});

			await updateGraph(exec, python, ctx.cwd, "./raw", signal);

			return {
				content: [{ type: "text", text: `Added ${params.url} to corpus and updated graph.` }],
				details: { url: params.url, savedTo },
			};
		},

		renderCall(params: AddParams, theme: Theme) {
			return new ToolCallHeader(
				{
					toolName: "Graphify",
					action: "add",
					mainArg: params.url,
					optionArgs: [
						...(params.author ? [{ label: "author", value: params.author }] : []),
						...(params.contributor ? [{ label: "contributor", value: params.contributor }] : []),
					],
					showColon: true,
				},
				theme,
			);
		},

		renderResult(
			result: AgentToolResult<AddDetails>,
			options: ToolRenderResultOptions,
			theme: Theme,
		) {
			if (options.isPartial) {
				return new Text(theme.fg("muted", "Graphify: adding URL..."), 0, 0);
			}

			const details = result.details as AddDetails | undefined;
			if (!details?.url) {
				const textBlock = result.content.find((c) => c.type === "text");
				const errorMsg = (textBlock?.type === "text" && textBlock.text) || "Add failed";
				return new Text(theme.fg("error", errorMsg), 0, 0);
			}

			return new ToolBody(
				{
					fields: [
						{ label: "URL", value: details.url, showCollapsed: true },
						{ label: "Saved", value: details.savedTo, showCollapsed: true },
					],
					footer: new ToolFooter(theme, {
						items: [{ label: "graph", value: "updated" }],
						separator: " | ",
					}),
					includeSpacerBeforeFooter: true,
				},
				options,
				theme,
			);
		},
	});
}

// ---------------------------------------------------------------------------
// graphify_update
// ---------------------------------------------------------------------------

const updateParameters = Type.Object({
	path: Type.String({
		description: "Directory path to update (re-extract changed files only)",
	}),
});

type UpdateParams = Static<typeof updateParameters>;

interface UpdateDetails {
	path: string;
	newFiles: number;
	nodes: number;
	edges: number;
}

export function createUpdateTool(pi: ExtensionAPI, config: ResolvedConfig) {
	return defineTool({
		name: "graphify_update",
		label: "Graphify Update",
		description:
			"Incrementally update the knowledge graph — re-extract only new or changed files. Much faster than a full rebuild.",
		parameters: updateParameters,
		promptSnippet:
			"Use graphify_update for incremental graph updates after files change, instead of rebuilding from scratch.",
		promptGuidelines: [
			"graphify_update is cheaper and faster than graphify_build — it only processes changed files.",
			"Run graphify_update after adding or modifying files in an already-graphed directory.",
		],

		async execute(
			_toolCallId: string,
			params: UpdateParams,
			signal: AbortSignal,
			onUpdate: AgentToolUpdateCallback<UpdateDetails> | undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<UpdateDetails>> {
			const exec = createExec(pi, ctx.cwd);
			const python = await detectPython(exec, config.pythonPath, ctx.cwd, signal);
			await ensureInstalled(exec, python, ctx.cwd, signal);

			const updateResult = await updateGraph(exec, python, ctx.cwd, params.path, signal, (msg) =>
				onUpdate?.({
					content: [{ type: "text", text: msg }],
					details: {} as UpdateDetails,
				}),
			);

			if (updateResult.newFiles === 0) {
				return {
					content: [
						{
							type: "text",
							text: "No files changed since last build. Graph is up to date.",
						},
					],
					details: { path: params.path, newFiles: 0, nodes: 0, edges: 0 },
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Updated graph: ${updateResult.newFiles} files re-extracted. Graph now has ${updateResult.nodes} nodes and ${updateResult.edges} edges.`,
					},
				],
				details: {
					path: params.path,
					newFiles: updateResult.newFiles,
					nodes: updateResult.nodes,
					edges: updateResult.edges,
				},
			};
		},

		renderCall(params: UpdateParams, theme: Theme) {
			return new ToolCallHeader(
				{
					toolName: "Graphify",
					action: "update",
					mainArg: params.path,
					showColon: true,
				},
				theme,
			);
		},

		renderResult(
			result: AgentToolResult<UpdateDetails>,
			options: ToolRenderResultOptions,
			theme: Theme,
		) {
			if (options.isPartial) {
				return new Text(theme.fg("muted", "Graphify: updating graph..."), 0, 0);
			}

			const details = result.details as UpdateDetails | undefined;
			if (!details) {
				const textBlock = result.content.find((c) => c.type === "text");
				const errorMsg = (textBlock?.type === "text" && textBlock.text) || "Update failed";
				return new Text(theme.fg("error", errorMsg), 0, 0);
			}

			if (details.newFiles === 0) {
				return new Text(theme.fg("muted", "Graph is up to date — no files changed."), 0, 0);
			}

			return new ToolBody(
				{
					fields: [
						{
							label: "Updated",
							value: `${details.newFiles} files re-extracted`,
							showCollapsed: false,
						},
						{
							label: "Graph",
							value: `${details.nodes} nodes | ${details.edges} edges`,
							showCollapsed: true,
						},
						{ label: "Path", value: details.path, showCollapsed: true },
					],
					footer: new ToolFooter(theme, {
						items: [{ label: "status", value: "updated" }],
						separator: " | ",
					}),
					includeSpacerBeforeFooter: true,
				},
				options,
				theme,
			);
		},
	});
}

// ---------------------------------------------------------------------------
// graphify_watch
// ---------------------------------------------------------------------------

const watchParameters = Type.Object({
	path: Type.String({ description: "Directory path to watch" }),
	debounce: Type.Optional(
		Type.Number({
			description: "Debounce seconds before triggering rebuild (default 3)",
			default: 3,
		}),
	),
});

type WatchParams = Static<typeof watchParameters>;

interface WatchDetails {
	path: string;
	message: string;
}

export function createWatchTool(pi: ExtensionAPI, config: ResolvedConfig) {
	return defineTool({
		name: "graphify_watch",
		label: "Graphify Watch",
		description:
			"Watch a directory for file changes and auto-rebuild the graph. Code changes trigger AST rebuild; doc changes flag for manual update.",
		parameters: watchParameters,
		promptSnippet:
			"Use graphify_watch to start a file watcher that auto-updates the knowledge graph when code changes.",
		promptGuidelines: [
			"graphify_watch runs in the foreground — use the process tool to run it in the background.",
			"Code-only changes are rebuilt automatically. Doc/image changes require manual /graphify --update.",
		],

		async execute(
			_toolCallId: string,
			params: WatchParams,
			signal: AbortSignal,
			onUpdate: AgentToolUpdateCallback<WatchDetails> | undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<WatchDetails>> {
			const exec = createExec(pi, ctx.cwd);
			const python = await detectPython(exec, config.pythonPath, ctx.cwd, signal);
			await ensureInstalled(exec, python, ctx.cwd, signal);

			const message = await startWatch(
				exec,
				python,
				ctx.cwd,
				params.path,
				params.debounce ?? 3,
				signal,
				(msg) =>
					onUpdate?.({ content: [{ type: "text", text: msg }], details: {} as WatchDetails }),
			);

			return {
				content: [{ type: "text", text: message }],
				details: { path: params.path, message },
			};
		},

		renderCall(params: WatchParams, theme: Theme) {
			return new ToolCallHeader(
				{
					toolName: "Graphify",
					action: "watch",
					mainArg: params.path,
					optionArgs: params.debounce
						? [{ label: "debounce", value: String(params.debounce) }]
						: [],
					showColon: true,
				},
				theme,
			);
		},

		renderResult(
			result: AgentToolResult<WatchDetails>,
			options: ToolRenderResultOptions,
			theme: Theme,
		) {
			if (options.isPartial) {
				return new Text(theme.fg("muted", "Graphify: watching for changes..."), 0, 0);
			}
			const details = result.details as WatchDetails | undefined;
			if (!details?.message) {
				return new Text(theme.fg("muted", "Watch ended."), 0, 0);
			}
			return new Text(theme.fg("muted", details.message), 0, 0);
		},
	});
}

// ---------------------------------------------------------------------------
// graphify_cluster
// ---------------------------------------------------------------------------

const clusterParameters = Type.Object({});

type ClusterParams = Static<typeof clusterParameters>;

interface ClusterDetails {
	communities: number;
}

export function createClusterTool(pi: ExtensionAPI, config: ResolvedConfig) {
	return defineTool({
		name: "graphify_cluster",
		label: "Graphify Cluster",
		description:
			"Re-run community detection on an existing graph.json and regenerate the report. No re-extraction needed.",
		parameters: clusterParameters,
		promptSnippet:
			"Use graphify_cluster to re-cluster an existing graph without re-extracting files.",
		promptGuidelines: [
			"graphify_cluster is cheap — it only reruns the clustering algorithm on existing data.",
			"Requires an existing graphify-out/graph.json.",
		],

		async execute(
			_toolCallId: string,
			_params: ClusterParams,
			signal: AbortSignal,
			_onUpdate: AgentToolUpdateCallback<ClusterDetails> | undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<ClusterDetails>> {
			const exec = createExec(pi, ctx.cwd);
			const python = await detectPython(exec, config.pythonPath, ctx.cwd, signal);
			await ensureInstalled(exec, python, ctx.cwd, signal);

			const result = await clusterOnly(exec, python, ctx.cwd, signal);

			return {
				content: [{ type: "text", text: `Re-clustered: ${result.communities} communities` }],
				details: { communities: result.communities },
			};
		},

		renderCall(_params: ClusterParams, theme: Theme) {
			return new ToolCallHeader(
				{ toolName: "Graphify", action: "cluster", mainArg: "re-cluster", showColon: true },
				theme,
			);
		},

		renderResult(
			result: AgentToolResult<ClusterDetails>,
			options: ToolRenderResultOptions,
			theme: Theme,
		) {
			if (options.isPartial) {
				return new Text(theme.fg("muted", "Graphify: re-clustering..."), 0, 0);
			}
			const details = result.details as ClusterDetails | undefined;
			if (!details?.communities) {
				return new Text(theme.fg("error", "Cluster failed"), 0, 0);
			}
			return new ToolBody(
				{
					fields: [
						{ label: "Communities", value: String(details.communities), showCollapsed: false },
					],
				},
				options,
				theme,
			);
		},
	});
}

// ---------------------------------------------------------------------------
// Re-export all creators
// ---------------------------------------------------------------------------

export function createAllTools(pi: ExtensionAPI, config: ResolvedConfig) {
	return [
		createBuildTool(pi, config),
		createQueryTool(pi, config),
		createPathTool(pi, config),
		createExplainTool(pi, config),
		createAddTool(pi, config),
		createUpdateTool(pi, config),
		createWatchTool(pi, config),
		createClusterTool(pi, config),
	];
}
