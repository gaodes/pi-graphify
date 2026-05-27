import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "../config";
import type { GraphContextState } from "./state";

export interface GraphArtifactInfo {
	graphPath: string;
	reportPath: string;
	wikiIndexPath: string;
	graphExists: boolean;
	reportExists: boolean;
	wikiExists: boolean;
	graphSize: number;
	reportSize: number;
	graphMtimeMs: number;
	reportMtimeMs: number;
}

/** Detect graph/report/wiki paths and cheap file metadata (no content reads). */
export function detectGraphArtifacts(config: ResolvedConfig, cwd: string): GraphArtifactInfo {
	const outputDir = join(cwd, config.outputDir);
	const graphPath = join(outputDir, "graph.json");
	const reportPath = join(outputDir, "GRAPH_REPORT.md");
	const wikiIndexPath = join(outputDir, "wiki", "index.md");

	const graphExists = existsSync(graphPath);
	const reportExists = existsSync(reportPath);
	const wikiExists = existsSync(wikiIndexPath);

	let graphSize = 0;
	let reportSize = 0;
	let graphMtimeMs = 0;
	let reportMtimeMs = 0;

	if (graphExists) {
		try {
			const st = statSync(graphPath);
			graphSize = st.size;
			graphMtimeMs = st.mtimeMs;
		} catch {
			/* ignore stat errors */
		}
	}
	if (reportExists) {
		try {
			const st = statSync(reportPath);
			reportSize = st.size;
			reportMtimeMs = st.mtimeMs;
		} catch {
			/* ignore stat errors */
		}
	}

	return {
		graphPath,
		reportPath,
		wikiIndexPath,
		graphExists,
		reportExists,
		wikiExists,
		graphSize,
		reportSize,
		graphMtimeMs,
		reportMtimeMs,
	};
}

/** Sync per-project graph state (paths + existence) from the filesystem. */
export function syncGraphContextProjectState(
	state: GraphContextState,
	config: ResolvedConfig,
	cwd: string,
): void {
	const info = detectGraphArtifacts(config, cwd);
	state.graphPath = info.graphPath;
	state.reportPath = info.reportPath;
	state.wikiIndexPath = info.wikiIndexPath;
	state.graphExists = info.graphExists;
}

/** Reset all per-session state (caches, counters). Re-syncs project paths. */
export function resetGraphContextSessionState(
	state: GraphContextState,
	config: ResolvedConfig,
	cwd: string,
): void {
	syncGraphContextProjectState(state, config, cwd);
	state.reportContextInjected = false;
	state.augmentHits = 0;
	state.hookFires = 0;
	state.augmentedCache.clear();
	state.emptyCache.clear();
}
