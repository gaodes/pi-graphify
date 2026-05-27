import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ResolvedConfig } from "../config";
import { createGraphContextState, MAX_AUGMENT_CACHE_KEYS, addBoundedSet } from "./state";
import type { GraphContextState } from "./state";
import {
	syncGraphContextProjectState,
	resetGraphContextSessionState,
	detectGraphArtifacts,
} from "./graph-state";
import {
	buildGraphifySystemPrompt,
	buildSessionOrientation,
	buildGraphifyAugmentContext,
	extractAugmentCacheKey,
	readBoundedText,
} from "./augment";
import { classifyGraphifyIntent, type GraphifyIntent } from "./intent";
import { runAutoQuery } from "./auto-query";
import { createBoundedExec } from "../tools/exec-adapter";

// Minimal local types for event payloads (avoids importing internal Pi types)
type BeforeAgentStartEvent = { systemPrompt?: string };
type ToolResultEvent = {
	toolName?: string;
	input?: unknown;
	content?: Array<{ type: string; text?: string }>;
};

export type AutoContextRegistration = {
	graphContextState: GraphContextState;
};

/** Truncate text to maxLen, cutting at the last newline before the limit. */
function truncateSnippet(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	const truncated = text.slice(0, maxLen);
	const lastNewline = truncated.lastIndexOf("\n");
	return (lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated) + "\u2026";
}

/** Build the intent-aware augmentation text for tool results. */
function buildIntentAugmentation(
	intent: GraphifyIntent,
	state: GraphContextState,
	config: ResolvedConfig,
): string | undefined {
	if (!state.graphExists) return undefined;

	if (intent.kind === "none") return undefined;

	const question = intent.suggestedQuestion ?? "How do these files relate in the system?";

	if (config.autoContext.intentSuggestions) {
		return (
			`[Graphify] ${intent.reason}. For architecture context, use:\n` +
			`graphify_query({ question: "${question}", budget: ${config.autoContext.queryBudget} })`
		);
	}

	return buildGraphifyAugmentContext(state, config, question);
}

/**
 * Register Graphify auto-context hooks on the Pi extension API.
 * Returns the mutable state for testing and cross-hook access.
 */
export function registerGraphifyAutoContext(
	pi: ExtensionAPI,
	config: ResolvedConfig,
	triggerTools?: Set<string>,
): AutoContextRegistration {
	const graphContextState = createGraphContextState();

	// Resolve trigger tools from config if not explicitly provided
	const effectiveTriggerTools = triggerTools ?? new Set(config.autoContext.triggerTools);

	pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
		resetGraphContextSessionState(graphContextState, config, ctx.cwd);
	});

	pi.on("before_agent_start", async (_event: unknown, ctx: ExtensionContext) => {
		syncGraphContextProjectState(graphContextState, config, ctx.cwd);

		if (!config.autoContext.enabled) return;
		if (!graphContextState.graphExists) return;
		if (graphContextState.reportContextInjected) return;

		const event = _event as BeforeAgentStartEvent;
		if (!event.systemPrompt) return;

		graphContextState.reportContextInjected = true;

		// Build enhanced session orientation when sessionSummary is enabled
		let promptText: string;
		if (config.autoContext.sessionSummary) {
			const artifacts = detectGraphArtifacts(config, ctx.cwd);
			let reportSnippet: string | undefined;

			if (config.autoContext.includeReport && artifacts.reportExists) {
				const reportText = readBoundedText(artifacts.reportPath, config.autoContext.reportMaxChars);
				if (reportText) {
					// Session orientation uses a simple truncation for a broad overview.
					// extractRelevantReportSnippet() is available for per-tool-result scoring.
					reportSnippet = truncateSnippet(reportText, 400);
				}
			}

			// Include wiki/index.md summary when enabled
			let wikiSnippet: string | undefined;
			if (config.autoContext.includeWiki && artifacts.wikiExists) {
				const wikiText = readBoundedText(artifacts.wikiIndexPath, 400);
				if (wikiText) {
					wikiSnippet = truncateSnippet(wikiText, 300);
				}
			}

			promptText = buildSessionOrientation(config, graphContextState, reportSnippet, wikiSnippet);

			// Hard bound at maxAugmentChars
			if (promptText.length > config.autoContext.maxAugmentChars) {
				promptText = promptText.slice(0, config.autoContext.maxAugmentChars) + "\u2026";
			}
		} else {
			promptText = buildGraphifySystemPrompt(config);
		}

		return {
			systemPrompt: `${event.systemPrompt}\n\n${promptText}`,
		};
	});

	// tool_result is a typed event on ExtensionAPI
	// Use broad cast to bypass strict handler type while keeping event name type-safe
	(
		pi as {
			on: (
				event: string,
				handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown>,
			) => void;
		}
	).on("tool_result", async (_event: unknown, ctx: ExtensionContext) => {
		if (!config.autoContext.enabled || !config.autoContext.augmentSearchResults) return;

		const event = _event as ToolResultEvent;
		if (!event.toolName || !effectiveTriggerTools.has(event.toolName)) return;
		if (!event.content || !Array.isArray(event.content)) return;

		syncGraphContextProjectState(graphContextState, config, ctx.cwd);
		if (!graphContextState.graphExists) return;

		// Enforce session augmentation budget
		if (graphContextState.augmentHits >= config.autoContext.maxSessionAugments) return;

		// Skip small results
		const totalLines = event.content.reduce((acc, c) => {
			if (c.text) return acc + c.text.split("\n").length;
			return acc;
		}, 0);
		if (totalLines < config.autoContext.minToolResultLines) return;

		// Classify intent
		const intent = classifyGraphifyIntent(event, config.autoContext.triggerPatterns);
		if (intent.kind === "none") return;

		graphContextState.hookFires += 1;
		const cacheKey = extractAugmentCacheKey(event).toLowerCase();
		if (graphContextState.augmentedCache.has(cacheKey)) return;
		if (graphContextState.emptyCache.has(cacheKey)) return;

		let augmentText: string | undefined;

		// Auto-query mode: run actual graphify query on high-confidence intents
		if (config.autoContext.autoQuery && intent.confidence >= 0.7) {
			const exec = createBoundedExec(pi, ctx.cwd);
			const queryResult = await runAutoQuery(
				exec,
				config.pythonPath,
				ctx.cwd,
				intent,
				config.autoContext.queryBudget,
				config.autoContext.maxAugmentChars,
			);
			if (queryResult) {
				augmentText = `[Graphify] ${intent.reason}.\n\n${queryResult}`;
			}
		}

		// Fall back to intent-aware hint
		if (!augmentText) {
			augmentText = buildIntentAugmentation(intent, graphContextState, config);
		}

		if (!augmentText) {
			addBoundedSet(graphContextState.emptyCache, cacheKey, MAX_AUGMENT_CACHE_KEYS);
			return;
		}

		// Bound augmentation text
		const boundedText =
			augmentText.length > config.autoContext.maxAugmentChars
				? augmentText.slice(0, config.autoContext.maxAugmentChars) + "\u2026"
				: augmentText;

		addBoundedSet(graphContextState.augmentedCache, cacheKey, MAX_AUGMENT_CACHE_KEYS);
		graphContextState.augmentHits += 1;

		return {
			content: [...event.content, { type: "text", text: `\n\n---\n${boundedText}\n---` }],
		};
	});

	pi.on("session_shutdown", async () => {
		graphContextState.augmentedCache.clear();
		graphContextState.emptyCache.clear();
	});

	return { graphContextState };
}
