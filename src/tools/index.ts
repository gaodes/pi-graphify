import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensurePrimeSettings, loadConfig, type ResolvedConfig } from "../config";
import {
	createStatusbarState,
	registerGraphifyStatusbar,
	type StatusbarState,
	unregisterGraphifyStatusbar,
	updateGraphifyStatusbar,
} from "../statusbar.js";
import { createAllTools } from "./graphify-tools";

const AUTO_CONTEXT_TOOL_NAMES = new Set(["grep", "ffgrep", "find", "fffind"]);

type GraphContextState = {
	graphExists: boolean;
	graphPath: string;
	reportPath: string;
	wikiIndexPath: string;
	reportContextInjected: boolean;
	augmentHits: number;
	hookFires: number;
	augmentedCache: Set<string>;
	emptyCache: Set<string>;
};

type BeforeAgentStartEvent = {
	systemPrompt?: string;
};

type ToolResultContent = {
	type: string;
	text?: string;
};

type ToolResultEvent = {
	toolName?: string;
	input?: unknown;
	content?: ToolResultContent[];
};

type ToolsExtensionState = {
	statusbarState: StatusbarState;
	graphContextState: GraphContextState;
};

function syncGraphContextProjectState(
	graphContextState: GraphContextState,
	config: ResolvedConfig,
	cwd: string,
): void {
	const outputDir = join(cwd, config.outputDir);
	graphContextState.graphPath = join(outputDir, "graph.json");
	graphContextState.reportPath = join(outputDir, "GRAPH_REPORT.md");
	graphContextState.wikiIndexPath = join(outputDir, "wiki", "index.md");
	graphContextState.graphExists = existsSync(graphContextState.graphPath);
}

function resetGraphContextSessionState(
	graphContextState: GraphContextState,
	config: ResolvedConfig,
	cwd: string,
): void {
	syncGraphContextProjectState(graphContextState, config, cwd);
	graphContextState.reportContextInjected = false;
	graphContextState.augmentHits = 0;
	graphContextState.hookFires = 0;
	graphContextState.augmentedCache.clear();
	graphContextState.emptyCache.clear();
}

function createToolsExtensionState(config: ResolvedConfig, cwd: string): ToolsExtensionState {
	const graphContextState: GraphContextState = {
		graphExists: false,
		graphPath: "",
		reportPath: "",
		wikiIndexPath: "",
		reportContextInjected: false,
		augmentHits: 0,
		hookFires: 0,
		augmentedCache: new Set<string>(),
		emptyCache: new Set<string>(),
	};

	syncGraphContextProjectState(graphContextState, config, cwd);

	return {
		statusbarState: createStatusbarState(),
		graphContextState,
	};
}

function buildGraphifySystemPrompt(config: ResolvedConfig): string {
	const outputDir = config.outputDir;
	return (
		`[Graphify active] This project has a knowledge graph in ${outputDir}/. ` +
		`Read ${outputDir}/GRAPH_REPORT.md before broad codebase exploration, ` +
		`check ${outputDir}/wiki/index.md when present, and prefer graphify_query, ` +
		`graphify_path, and graphify_explain for cross-module questions.`
	);
}

function extractAugmentCacheKey(event: ToolResultEvent): string {
	const toolName = event.toolName ?? "unknown";
	if (!event.input || typeof event.input !== "object") return toolName;

	const input = event.input as Record<string, unknown>;
	const candidate =
		typeof input.pattern === "string"
			? input.pattern
			: typeof input.path === "string"
				? input.path
				: typeof input.command === "string"
					? input.command
					: "";

	return candidate ? `${toolName}:${candidate}` : toolName;
}

function buildGraphifyAugmentContext(
	graphContextState: GraphContextState,
	config: ResolvedConfig,
): string | undefined {
	if (!graphContextState.graphExists) return undefined;

	return (
		`[Graphify] Graph detected at ${config.outputDir}/graph.json. ` +
		`Prefer graphify_query (budget ${config.autoContext.queryBudget}), graphify_path, and graphify_explain for structural questions.`
	);
}

export default function (pi: ExtensionAPI) {
	ensurePrimeSettings();

	const config = loadConfig(process.cwd());
	if (!config.enabled) return;

	const state = createToolsExtensionState(config, process.cwd());

	for (const tool of createAllTools(pi, config, state.statusbarState)) {
		pi.registerTool(tool);
	}

	pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
		resetGraphContextSessionState(state.graphContextState, config, ctx.cwd);
		registerGraphifyStatusbar(pi, config);
		await updateGraphifyStatusbar(pi, config, ctx, state.statusbarState);
	});

	pi.on("before_agent_start", async (_event: unknown, ctx: ExtensionContext) => {
		syncGraphContextProjectState(state.graphContextState, config, ctx.cwd);
		await updateGraphifyStatusbar(pi, config, ctx, state.statusbarState);

		if (!config.autoContext.enabled) return;
		if (!state.graphContextState.graphExists) return;
		if (state.graphContextState.reportContextInjected) return;

		const event = _event as BeforeAgentStartEvent;
		if (!event.systemPrompt) return;

		state.graphContextState.reportContextInjected = true;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildGraphifySystemPrompt(config)}`,
		};
	});

	(
		pi as unknown as {
			on: (
				event: string,
				handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown>,
			) => void;
		}
	).on("tool_result", async (_event: unknown, ctx: ExtensionContext) => {
		if (!config.autoContext.enabled || !config.autoContext.augmentSearchResults) return;

		const event = _event as ToolResultEvent;
		if (!event.toolName || !AUTO_CONTEXT_TOOL_NAMES.has(event.toolName)) return;
		if (!event.content || !Array.isArray(event.content)) return;

		syncGraphContextProjectState(state.graphContextState, config, ctx.cwd);
		if (!state.graphContextState.graphExists) return;

		state.graphContextState.hookFires += 1;
		const cacheKey = extractAugmentCacheKey(event).toLowerCase();
		if (state.graphContextState.augmentedCache.has(cacheKey)) return;
		if (state.graphContextState.emptyCache.has(cacheKey)) return;

		const augmentText = buildGraphifyAugmentContext(state.graphContextState, config);
		if (!augmentText) {
			state.graphContextState.emptyCache.add(cacheKey);
			return;
		}

		state.graphContextState.augmentedCache.add(cacheKey);
		state.graphContextState.augmentHits += 1;

		return {
			content: [...event.content, { type: "text", text: `\n\n---\n${augmentText}\n---` }],
		};
	});

	pi.on("session_shutdown", async () => {
		state.graphContextState.augmentedCache.clear();
		state.graphContextState.emptyCache.clear();
		unregisterGraphifyStatusbar(pi);
	});
}
