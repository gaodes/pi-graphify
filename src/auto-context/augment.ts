import { readFileSync } from "node:fs";
import type { ResolvedConfig } from "../config";
import type { GraphContextState } from "./state";

/** Build the system-prompt hint injected once per session via before_agent_start. */
export function buildGraphifySystemPrompt(config: ResolvedConfig): string {
	const outputDir = config.outputDir;
	return (
		`[Graphify active] This project has a knowledge graph in ${outputDir}/. ` +
		`Read ${outputDir}/GRAPH_REPORT.md before broad codebase exploration, ` +
		`check ${outputDir}/wiki/index.md when present, and prefer graphify_query, ` +
		`graphify_path, and graphify_explain for cross-module questions.`
	);
}

/** Build a concise session orientation with suggested queries. */
export function buildSessionOrientation(
	config: ResolvedConfig,
	state: GraphContextState,
	reportSnippet?: string,
	wikiSnippet?: string,
): string {
	const outputDir = config.outputDir;
	const parts: string[] = [
		`[Graphify active] This project has ${outputDir}/graph.json. Use Graphify for architecture, concept, and cross-file questions.`,
	];

	const available: string[] = [];
	if (state.graphExists) available.push("graph.json");
	// Report/wiki presence can be inferred from snippet existence
	if (reportSnippet !== undefined) available.push("GRAPH_REPORT.md");
	if (wikiSnippet !== undefined) available.push("wiki/index.md");
	parts.push(`Available: ${available.join(", ")}.`);

	parts.push(
		"Good follow-ups:",
		`- graphify_query({ question: "What are the main communities in this package?" })`,
		`- graphify_query({ question: "How does settings relate to tool registration?" })`,
		`- graphify_explain({ concept: "Auto-context hooks" })`,
	);

	if (reportSnippet) {
		parts.push(`\nReport summary: ${reportSnippet}`);
	}

	if (wikiSnippet) {
		parts.push(`\nWiki: ${wikiSnippet}`);
	}

	return parts.join("\n");
}

/** Read a bounded text file, returning up to maxChars characters or undefined. */
export function readBoundedText(filePath: string, maxChars: number): string | undefined {
	try {
		const buf = readFileSync(filePath, "utf-8");
		return buf.length > maxChars ? buf.slice(0, maxChars) + "…" : buf;
	} catch {
		return undefined;
	}
}

/**
 * Extract a relevant snippet from GRAPH_REPORT.md based on trigger terms.
 * Returns up to maxChars from the best-matching section, or undefined.
 */
export function extractRelevantReportSnippet(
	reportText: string,
	terms: string[],
	maxChars: number,
): string | undefined {
	if (!reportText || !terms.length) return undefined;

	const lines = reportText.split("\n");
	let bestSection = "";
	let bestScore = 0;

	let currentSection: string[] = [];
	let currentScore = 0;

	for (const line of lines) {
		const isHeading = /^#{1,4}\s/.test(line);
		if (isHeading) {
			if (currentScore > bestScore && currentSection.length > 0) {
				bestSection = currentSection.join("\n");
				bestScore = currentScore;
			}
			currentSection = [line];
			currentScore = 0;
		} else {
			currentSection.push(line);
		}

		const lower = line.toLowerCase();
		for (const term of terms) {
			if (lower.includes(term.toLowerCase())) {
				currentScore += 1;
			}
		}
	}

	// Check last section
	if (currentScore > bestScore && currentSection.length > 0) {
		bestSection = currentSection.join("\n");
		bestScore = currentScore;
	}

	if (bestScore === 0) return undefined;
	return bestSection.length > maxChars ? bestSection.slice(0, maxChars) + "…" : bestSection;
}

/** Extract a cache key from a tool result event for deduplication. */
export function extractAugmentCacheKey(event: { toolName?: string; input?: unknown }): string {
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

/** Build the tool-result augmentation text appended to matching results. */
export function buildGraphifyAugmentContext(
	state: GraphContextState,
	config: ResolvedConfig,
	suggestedQuestion?: string,
): string | undefined {
	if (!state.graphExists) return undefined;

	const question = suggestedQuestion
		? `Suggested query: "${suggestedQuestion}"`
		: "For architecture context, use graphify_query for the full BFS view.";

	return (
		`[Graphify] This result spans multiple concepts/files. ${question} ` +
		`Budget: ${config.autoContext.queryBudget}.`
	);
}
