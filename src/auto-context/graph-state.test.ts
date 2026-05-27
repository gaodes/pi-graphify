import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ResolvedConfig } from "../config";
import {
	detectGraphArtifacts,
	resetGraphContextSessionState,
	syncGraphContextProjectState,
} from "./graph-state";
import { createGraphContextState } from "./state";

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

describe("auto-context/graph-state", () => {
	describe("detectGraphArtifacts", () => {
		it("detects graph.json, report, and wiki when present", () => {
			const root = mkdtempSync(join(tmpdir(), "graph-state-test-"));
			const outDir = join(root, "graphify-out");
			mkdirSync(outDir, { recursive: true });
			mkdirSync(join(outDir, "wiki"), { recursive: true });
			writeFileSync(join(outDir, "graph.json"), '{"nodes":[]}', "utf-8");
			writeFileSync(join(outDir, "GRAPH_REPORT.md"), "# Report", "utf-8");
			writeFileSync(join(outDir, "wiki", "index.md"), "# Wiki", "utf-8");

			const config = baseConfig();
			const info = detectGraphArtifacts(config, root);

			expect(info.graphExists).toBe(true);
			expect(info.reportExists).toBe(true);
			expect(info.wikiExists).toBe(true);
			expect(info.graphSize).toBeGreaterThan(0);
			expect(info.reportSize).toBeGreaterThan(0);
		});

		it("returns exists=false when files are absent", () => {
			const root = mkdtempSync(join(tmpdir(), "graph-state-empty-"));
			const config = baseConfig();
			const info = detectGraphArtifacts(config, root);

			expect(info.graphExists).toBe(false);
			expect(info.reportExists).toBe(false);
			expect(info.wikiExists).toBe(false);
		});
	});

	describe("syncGraphContextProjectState", () => {
		it("populates state paths and existence from filesystem", () => {
			const root = mkdtempSync(join(tmpdir(), "graph-state-sync-"));
			const outDir = join(root, "graphify-out");
			mkdirSync(outDir, { recursive: true });
			writeFileSync(join(outDir, "graph.json"), "{}", "utf-8");

			const state = createGraphContextState();
			syncGraphContextProjectState(state, baseConfig(), root);

			expect(state.graphExists).toBe(true);
			expect(state.graphPath).toBe(join(outDir, "graph.json"));
		});
	});

	describe("resetGraphContextSessionState", () => {
		it("clears session counters and caches", () => {
			const root = mkdtempSync(join(tmpdir(), "graph-state-reset-"));
			const state = createGraphContextState();
			state.augmentHits = 5;
			state.hookFires = 10;
			state.reportContextInjected = true;
			state.augmentedCache.add("old-key");

			resetGraphContextSessionState(state, baseConfig(), root);

			expect(state.augmentHits).toBe(0);
			expect(state.hookFires).toBe(0);
			expect(state.reportContextInjected).toBe(false);
			expect(state.augmentedCache.size).toBe(0);
		});
	});
});
