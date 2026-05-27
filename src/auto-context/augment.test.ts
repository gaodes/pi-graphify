import { describe, expect, it } from "vitest";
import {
	buildGraphifySystemPrompt,
	buildGraphifyAugmentContext,
	extractAugmentCacheKey,
	readBoundedText,
	extractRelevantReportSnippet,
	buildSessionOrientation,
} from "./augment";
import { createGraphContextState } from "./state";
import type { ResolvedConfig } from "../config";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function baseConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
	return {
		enabled: true,
		pythonPath: "python3",
		outputDir: "graphify-out",
		semanticBackend: "deepseek",
		autoContext: {
			enabled: true,
			augmentSearchResults: true,
			includeReport: true,
			includeWiki: true,
			reportMaxChars: 6000,
			queryBudget: 1200,
		},
		...overrides,
	} as ResolvedConfig;
}

describe("auto-context/augment", () => {
	describe("buildGraphifySystemPrompt", () => {
		it("includes outputDir in prompt", () => {
			const prompt = buildGraphifySystemPrompt(baseConfig());
			expect(prompt).toContain("[Graphify active]");
			expect(prompt).toContain("graphify-out/GRAPH_REPORT.md");
			expect(prompt).toContain("graphify_query");
		});
	});

	describe("buildGraphifyAugmentContext", () => {
		it("returns undefined when graph does not exist", () => {
			const state = createGraphContextState();
			const result = buildGraphifyAugmentContext(state, baseConfig());
			expect(result).toBeUndefined();
		});

		it("returns augmentation text when graph exists", () => {
			const state = createGraphContextState();
			state.graphExists = true;
			const result = buildGraphifyAugmentContext(state, baseConfig());
			expect(result).toContain("[Graphify]");
			expect(result).toContain("1200");
		});

		it("includes suggested question when provided", () => {
			const state = createGraphContextState();
			state.graphExists = true;
			const result = buildGraphifyAugmentContext(
				state,
				baseConfig(),
				"How do tools relate to commands?",
			);
			expect(result).toContain("How do tools relate to commands?");
		});
	});

	describe("extractAugmentCacheKey", () => {
		it("uses tool name when no input", () => {
			expect(extractAugmentCacheKey({ toolName: "grep" })).toBe("grep");
		});

		it("extracts pattern from input", () => {
			expect(extractAugmentCacheKey({ toolName: "grep", input: { pattern: "test" } })).toBe(
				"grep:test",
			);
		});

		it("extracts path from input", () => {
			expect(extractAugmentCacheKey({ toolName: "find", input: { path: "src/" } })).toBe(
				"find:src/",
			);
		});

		it("extracts command from input", () => {
			expect(extractAugmentCacheKey({ toolName: "bash", input: { command: "ls" } })).toBe(
				"bash:ls",
			);
		});
	});

	describe("readBoundedText", () => {
		it("reads file content within bounds", () => {
			const dir = mkdtempSync(join(tmpdir(), "augment-read-"));
			const file = join(dir, "test.txt");
			writeFileSync(file, "hello world", "utf-8");
			expect(readBoundedText(file, 100)).toBe("hello world");
		});

		it("truncates when content exceeds maxChars", () => {
			const dir = mkdtempSync(join(tmpdir(), "augment-read-"));
			const file = join(dir, "long.txt");
			writeFileSync(file, "abcdefghij", "utf-8");
			const result = readBoundedText(file, 5);
			expect(result).toBe("abcde…");
		});

		it("returns undefined for missing files", () => {
			expect(readBoundedText("/nonexistent/file.txt", 100)).toBeUndefined();
		});
	});

	describe("extractRelevantReportSnippet", () => {
		it("returns undefined for empty text or terms", () => {
			expect(extractRelevantReportSnippet("", ["test"], 100)).toBeUndefined();
			expect(extractRelevantReportSnippet("some text", [], 100)).toBeUndefined();
		});

		it("returns best-matching section", () => {
			const report = `# Overview\nThis is the overview.\n\n# Communities\nCommunities: core and tools.\n\n# Settings\nSettings are managed here.`;
			const result = extractRelevantReportSnippet(report, ["communities"], 200);
			expect(result).toContain("Communities");
			expect(result).toContain("core and tools");
		});

		it("returns undefined when no terms match", () => {
			const report = "# Overview\nNothing relevant here.";
			expect(extractRelevantReportSnippet(report, ["missing"], 100)).toBeUndefined();
		});

		it("truncates long sections", () => {
			const report = `# Section\n${"x".repeat(200)}`;
			const result = extractRelevantReportSnippet(report, ["section"], 50);
			expect(result!.length).toBeLessThanOrEqual(51); // 50 + ellipsis char
		});
	});

	describe("buildSessionOrientation", () => {
		it("includes graph path and suggested queries", () => {
			const state = createGraphContextState();
			state.graphExists = true;
			const config = baseConfig();
			const result = buildSessionOrientation(config, state);
			expect(result).toContain("[Graphify active]");
			expect(result).toContain("graphify-out/graph.json");
			expect(result).toContain("graphify_query");
			expect(result).toContain("graphify_explain");
		});

		it("includes report snippet when provided", () => {
			const state = createGraphContextState();
			state.graphExists = true;
			const config = baseConfig();
			const result = buildSessionOrientation(config, state, "Key insight from report.");
			expect(result).toContain("Key insight from report.");
		});

		it("works without report snippet", () => {
			const state = createGraphContextState();
			state.graphExists = true;
			const config = baseConfig();
			const result = buildSessionOrientation(config, state);
			expect(result).not.toContain("Report summary:");
		});

		it("includes wiki snippet when provided", () => {
			const state = createGraphContextState();
			state.graphExists = true;
			const config = baseConfig();
			const result = buildSessionOrientation(config, state, undefined, "Wiki intro text.");
			expect(result).toContain("Wiki intro text.");
			expect(result).toContain("wiki/index.md");
		});
	});
});
