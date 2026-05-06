import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { loadConfig, type ResolvedConfig } from "../config";
import type { ExecFn } from "../lib/runner";
import {
	clusterOnly,
	detectPython,
	ensureInstalled,
	explainNode,
	findPath,
	hookAction,
	queryGraph,
	updateGraph,
} from "../lib/runner";

// ---------------------------------------------------------------------------
// Autocomplete definitions
// ---------------------------------------------------------------------------

const SUBCOMMANDS: AutocompleteItem[] = [
	{
		value: "",
		label: "<path>",
		description: "Build graph from directory (full pipeline)",
	},
	{
		value: "query",
		label: "query",
		description: "Query the graph — BFS for broad context, DFS for tracing paths",
	},
	{
		value: "path",
		label: "path",
		description: "Find shortest path between two concepts",
	},
	{
		value: "explain",
		label: "explain",
		description: "Plain-language explanation of a node",
	},
	{
		value: "add",
		label: "add",
		description: "Fetch a URL and add it to the corpus",
	},
	{
		value: "update",
		label: "update",
		description: "Incremental update — re-extract only changed files",
	},
	{
		value: "watch",
		label: "watch",
		description: "Watch directory for changes, auto-rebuild graph",
	},
	{
		value: "cluster",
		label: "cluster",
		description: "Re-run clustering on existing graph (no re-extraction)",
	},
	{
		value: "hook",
		label: "hook",
		description: "Manage git hooks (install/uninstall/status)",
	},
];

const BUILD_FLAGS: AutocompleteItem[] = [
	{
		value: "--mode deep",
		label: "--mode deep",
		description: "More aggressive relationship inference",
	},
	{ value: "--no-viz", label: "--no-viz", description: "Skip HTML visualization" },
	{ value: "--obsidian", label: "--obsidian", description: "Generate Obsidian vault" },
	{ value: "--svg", label: "--svg", description: "Export graph.svg" },
	{ value: "--graphml", label: "--graphml", description: "Export for Gephi / yEd" },
	{ value: "--neo4j", label: "--neo4j", description: "Generate cypher.txt for Neo4j" },
	{
		value: "--update",
		label: "--update",
		description: "Incremental — re-extract only changed files",
	},
	{
		value: "--cluster-only",
		label: "--cluster-only",
		description: "Rerun clustering on existing graph",
	},
];

const QUERY_FLAGS: AutocompleteItem[] = [
	{ value: "--dfs", label: "--dfs", description: "DFS traversal — trace a specific path" },
	{
		value: "--budget",
		label: "--budget N",
		description: "Token budget for the answer (default 2000)",
	},
];

function getCompletions(argumentPrefix: string): AutocompleteItem[] {
	const parts = argumentPrefix.trim().split(/\s+/);

	if (parts.length <= 1) {
		const prefix = parts[0] ?? "";
		if (prefix.startsWith("--")) {
			return BUILD_FLAGS.filter((f) => f.value.startsWith(prefix));
		}
		return SUBCOMMANDS.filter((s) => s.value === "" || s.value.startsWith(prefix.toLowerCase()));
	}

	const subcommand = parts[0].toLowerCase();

	switch (subcommand) {
		case "query": {
			if (parts[parts.length - 1]?.startsWith("--")) {
				return QUERY_FLAGS.filter((f) => f.value.startsWith(parts[parts.length - 1] ?? ""));
			}
			return [
				{
					value: `query "${parts.slice(1).join(" ")}`,
					label: `"${parts.slice(1).join(" ")}..."`,
					description: "Your question (wrap in quotes)",
				},
			];
		}
		case "path": {
			return [
				{
					value: `path ${parts.slice(1).join(" ")}`,
					label: parts.slice(1).join(" ") || '"A" "B"',
					description: "Two concept names in quotes",
				},
			];
		}
		case "explain": {
			return [
				{
					value: `explain ${parts.slice(1).join(" ")}`,
					label: parts.slice(1).join(" ") || "ConceptName",
					description: "Name of the concept to explain",
				},
			];
		}
		case "add": {
			const addFlags: AutocompleteItem[] = [
				{ value: "--author", label: '--author "Name"', description: "Tag who wrote it" },
				{
					value: "--contributor",
					label: '--contributor "Name"',
					description: "Tag who added it",
				},
			];
			if (parts[parts.length - 1]?.startsWith("--")) {
				return addFlags.filter((f) => f.value.startsWith(parts[parts.length - 1] ?? ""));
			}
			return [
				{
					value: `add ${parts.slice(1).join(" ")}`,
					label: parts.slice(1).join(" ") || "<url>",
					description: "URL to fetch and add",
				},
			];
		}
		case "update": {
			return [
				{
					value: `update ${parts.slice(1).join(" ")}`,
					label: parts.slice(1).join(" ") || ".",
					description: "Directory path to update",
				},
			];
		}
		case "watch": {
			return [
				{
					value: `watch ${parts.slice(1).join(" ")}`,
					label: parts.slice(1).join(" ") || ".",
					description: "Directory path to watch",
				},
			];
		}
		case "cluster": {
			return [{ value: "cluster", label: "cluster", description: "Re-cluster existing graph" }];
		}
		case "hook": {
			const hookActions: AutocompleteItem[] = [
				{ value: "hook install", label: "install", description: "Install git hooks" },
				{ value: "hook uninstall", label: "uninstall", description: "Remove git hooks" },
				{ value: "hook status", label: "status", description: "Check hook status" },
			];
			const partial = parts.slice(1).join(" ").toLowerCase();
			return hookActions.filter((h) => h.label.startsWith(partial || h.label));
		}
		default: {
			if (parts[parts.length - 1]?.startsWith("--")) {
				return BUILD_FLAGS.filter((f) => f.value.startsWith(parts[parts.length - 1] ?? ""));
			}
			return BUILD_FLAGS;
		}
	}
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
	subcommand:
		| "build"
		| "query"
		| "path"
		| "explain"
		| "add"
		| "update"
		| "watch"
		| "cluster"
		| "hook";
	positionals: string[];
	flags: Record<string, string | boolean>;
}

function parseArgs(raw: string): ParsedArgs {
	const tokens = raw.trim().split(/\s+/).filter(Boolean);
	const flags: Record<string, string | boolean> = {};
	const positionals: string[] = [];

	let i = 0;
	let subcommand: ParsedArgs["subcommand"] = "build";

	if (tokens.length > 0) {
		const first = tokens[0].toLowerCase();
		if (
			["query", "path", "explain", "add", "update", "watch", "cluster", "hook"].includes(first) &&
			!first.startsWith("-")
		) {
			subcommand = first as ParsedArgs["subcommand"];
			i = 1;
		}
	}

	while (i < tokens.length) {
		const token = tokens[i];
		if (token === "--mode" && tokens[i + 1]) {
			flags.mode = tokens[i + 1];
			i += 2;
		} else if (token === "--budget" && tokens[i + 1]) {
			flags.budget = tokens[i + 1];
			i += 2;
		} else if (token === "--author" && tokens[i + 1]) {
			flags.author = tokens[i + 1];
			i += 2;
		} else if (token === "--contributor" && tokens[i + 1]) {
			flags.contributor = tokens[i + 1];
			i += 2;
		} else if (token === "--debounce" && tokens[i + 1]) {
			flags.debounce = tokens[i + 1];
			i += 2;
		} else if (token.startsWith("--")) {
			flags[token.slice(2)] = true;
			i++;
		} else {
			positionals.push(token);
			i++;
		}
	}

	return { subcommand, positionals, flags };
}

// ---------------------------------------------------------------------------
// Exec adapter for commands
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
// Command handlers
// ---------------------------------------------------------------------------

async function handleBuild(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	config: ResolvedConfig,
	positionals: string[],
	flags: Record<string, string | boolean>,
) {
	const inputPath = positionals[0] ?? ".";
	const exec = createExec(pi, ctx.cwd);
	const python = await detectPython(exec, config.pythonPath, ctx.cwd);
	await ensureInstalled(exec, python, ctx.cwd);

	if (flags["cluster-only"] === true) {
		const result = await pi.exec(
			"sh",
			[
				"-c",
				`${python} -c "
import json
from networkx.readwrite import json_graph
from graphify.cluster import cluster, score_all
from graphify.report import generate
from graphify.export import to_json
from pathlib import Path

data = json.loads(Path('graphify-out/graph.json').read_text())
G = json_graph.node_link_graph(data, edges='links')
communities = cluster(G)
to_json(G, communities, 'graphify-out/graph.json')
print(f'Re-clustered: {len(communities)} communities')
"`,
			],
			{ cwd: ctx.cwd },
		);
		await ctx.ui.notify(result.stdout.trim() || "Re-clustered graph.");
		return;
	}

	if (flags.update === true) {
		const result = await updateGraph(exec, python, ctx.cwd, inputPath);
		await ctx.ui.notify(
			result.newFiles === 0
				? "No files changed. Graph is up to date."
				: `Updated: ${result.newFiles} files re-extracted. ${result.nodes} nodes, ${result.edges} edges.`,
		);
		return;
	}

	const buildArgs = {
		path: inputPath,
		...(flags.mode === "deep" ? { mode: "deep" } : {}),
		...(flags["no-viz"] === true ? { no_viz: true } : {}),
		...(flags.obsidian === true ? { obsidian: true } : {}),
		...(flags.svg === true ? { svg: true } : {}),
		...(flags.graphml === true ? { graphml: true } : {}),
		...(flags.neo4j === true ? { neo4j: true } : {}),
	};

	// Full build — send a message to the agent so it uses the tool with explicit params
	pi.sendUserMessage(
		`Use the graphify_build tool with these exact params: ${JSON.stringify(buildArgs)}. After the graph is built, read graphify-out/GRAPH_REPORT.md and show me the God Nodes, Surprising Connections, and Suggested Questions.`,
	);
}

async function handleQuery(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	config: ResolvedConfig,
	positionals: string[],
	flags: Record<string, string | boolean>,
) {
	const question = positionals.join(" ").replace(/^["']|["']$/g, "");
	if (!question) {
		await ctx.ui.notify('Usage: /graphify query "<question>"', "warning");
		return;
	}

	const exec = createExec(pi, ctx.cwd);
	const python = await detectPython(exec, config.pythonPath, ctx.cwd);
	await ensureInstalled(exec, python, ctx.cwd);

	const mode = flags.dfs === true ? "dfs" : "bfs";
	const budget = typeof flags.budget === "string" ? Number.parseInt(flags.budget, 10) : 2000;

	const result = await queryGraph(exec, python, ctx.cwd, { question, mode, budget });

	pi.sendUserMessage(
		`Based on the graph query result below, answer this question: "${question}"\n\nGraph traversal result:\n${result}`,
	);
}

async function handlePath(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	config: ResolvedConfig,
	positionals: string[],
) {
	if (positionals.length < 2) {
		await ctx.ui.notify('Usage: /graphify path "ConceptA" "ConceptB"', "warning");
		return;
	}

	const exec = createExec(pi, ctx.cwd);
	const python = await detectPython(exec, config.pythonPath, ctx.cwd);
	await ensureInstalled(exec, python, ctx.cwd);

	const result = await findPath(exec, python, ctx.cwd, positionals[0], positionals[1]);

	pi.sendUserMessage(`Explain this graph path in plain language:\n${result}`);
}

async function handleExplain(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	config: ResolvedConfig,
	positionals: string[],
) {
	const concept = positionals.join(" ").replace(/^["']|["']$/g, "");
	if (!concept) {
		await ctx.ui.notify('Usage: /graphify explain "ConceptName"', "warning");
		return;
	}

	const exec = createExec(pi, ctx.cwd);
	const python = await detectPython(exec, config.pythonPath, ctx.cwd);
	await ensureInstalled(exec, python, ctx.cwd);

	const result = await explainNode(exec, python, ctx.cwd, concept);

	pi.sendUserMessage(
		`Based on the graph data below, provide a plain-language explanation of "${concept}":\n${result}`,
	);
}

async function handleAdd(
	pi: ExtensionAPI,
	positionals: string[],
	flags: Record<string, string | boolean>,
) {
	const url = positionals[0];
	if (!url) {
		await pi.sendUserMessage("Usage: /graphify add <url>");
		return;
	}

	const authorStr = typeof flags.author === "string" ? ` (author: ${flags.author})` : "";
	const contributorStr =
		typeof flags.contributor === "string" ? ` (contributor: ${flags.contributor})` : "";

	pi.sendUserMessage(
		`Use the graphify_add tool to fetch and add this URL to the corpus: ${url}${authorStr}${contributorStr}. After adding it, run an incremental graph update.`,
	);
}

async function handleUpdate(pi: ExtensionAPI, positionals: string[]) {
	const inputPath = positionals[0] ?? ".";
	pi.sendUserMessage(
		`Use the graphify_update tool to incrementally update the knowledge graph for path "${inputPath}".`,
	);
}

async function handleWatch(
	pi: ExtensionAPI,
	_ctx: ExtensionCommandContext,
	_config: ResolvedConfig,
	positionals: string[],
	flags: Record<string, string | boolean>,
) {
	const inputPath = positionals[0] ?? ".";
	const debounce = typeof flags.debounce === "string" ? flags.debounce : "3";
	pi.sendUserMessage(
		`Use the graphify_watch tool to watch "${inputPath}" for changes with debounce ${debounce}s. Run it as a background process.`,
	);
}

async function handleCluster(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	config: ResolvedConfig,
) {
	const exec = createExec(pi, ctx.cwd);
	const python = await detectPython(exec, config.pythonPath, ctx.cwd);
	await ensureInstalled(exec, python, ctx.cwd);

	try {
		const result = await clusterOnly(exec, python, ctx.cwd);
		await ctx.ui.notify(`Re-clustered: ${result.communities} communities`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await ctx.ui.notify(`Cluster failed: ${message}`, "error");
	}
}

async function handleHook(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	config: ResolvedConfig,
	positionals: string[],
) {
	const action = positionals[0];
	if (!action || !["install", "uninstall", "status"].includes(action)) {
		await ctx.ui.notify("Usage: /graphify hook <install|uninstall|status>", "warning");
		return;
	}

	const exec = createExec(pi, ctx.cwd);
	const python = await detectPython(exec, config.pythonPath, ctx.cwd);
	await ensureInstalled(exec, python, ctx.cwd);

	const result = await hookAction(
		exec,
		python,
		ctx.cwd,
		action as "install" | "uninstall" | "status",
	);
	await ctx.ui.notify(result);
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	const config = loadConfig(process.cwd());
	if (!config.enabled) return;

	pi.registerCommand("graphify", {
		description: "Knowledge graph: build, query, explore, and update graphs from directories",
		getArgumentCompletions(argumentPrefix: string): AutocompleteItem[] {
			return getCompletions(argumentPrefix);
		},
		async handler(args: string, ctx: ExtensionCommandContext) {
			const parsed = parseArgs(args);

			try {
				switch (parsed.subcommand) {
					case "build":
						await handleBuild(pi, ctx, config, parsed.positionals, parsed.flags);
						break;
					case "query":
						await handleQuery(pi, ctx, config, parsed.positionals, parsed.flags);
						break;
					case "path":
						await handlePath(pi, ctx, config, parsed.positionals);
						break;
					case "explain":
						await handleExplain(pi, ctx, config, parsed.positionals);
						break;
					case "add":
						await handleAdd(pi, parsed.positionals, parsed.flags);
						break;
					case "update":
						await handleUpdate(pi, parsed.positionals);
						break;
					case "watch":
						await handleWatch(pi, ctx, config, parsed.positionals, parsed.flags);
						break;
					case "cluster":
						await handleCluster(pi, ctx, config);
						break;
					case "hook":
						await handleHook(pi, ctx, config, parsed.positionals);
						break;
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				await ctx.ui.notify(`Graphify error: ${message}`, "error");
			}
		},
	});
}
