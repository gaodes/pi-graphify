/**
 * Graphify CLI runner — pure domain logic, no Pi imports.
 *
 * All functions accept a generic `exec` callback so the tools layer can
 * inject `pi.exec()` while keeping this module independently testable.
 *
 * NOTE: pi.exec() signature is (command: string, args: string[], options?: ExecOptions).
 * The exec adapter in the tools/commands layer wraps this to accept a single shell string.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ExecOptions {
	cwd?: string;
	signal?: AbortSignal;
	maxOutputBytes?: number;
}

// Output budget constants (bytes)
export const DEFAULT_EXEC_OUTPUT_BYTES = 1_048_576; // 1 MiB
export const JSON_EXEC_OUTPUT_BYTES = 2_097_152; // 2 MiB
export const QUERY_EXEC_OUTPUT_BYTES = 262_144; // 256 KiB
export const OUTPUT_LIMIT_EXIT_CODE = 125;

export interface ExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export type ExecFn = (command: string, options?: ExecOptions) => Promise<ExecResult>;

const GRAPHIFY_GITIGNORE_REQUIRED = ["graphify-out/"] as const;

const GRAPHIFY_GITIGNORE_LEGACY = [
	"graphify-out/cache/",
	"graphify-out/.graphify_python",
	"graphify-out/.graphify_root",
	"graphify-out/cost.json",
	"/graphify-out/",
] as const;

// ---------------------------------------------------------------------------
// Python / graphify detection
// ---------------------------------------------------------------------------

/** Detect the correct Python interpreter from a graphify installation. */
export async function detectPython(
	exec: ExecFn,
	configPython: string,
	cwd: string,
	signal?: AbortSignal,
): Promise<string> {
	const cacheResult = await exec("cat graphify-out/.graphify_python 2>/dev/null || true", {
		cwd,
		signal,
		maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES,
	});
	if (cacheResult.stdout.trim()) return cacheResult.stdout.trim();

	const whichResult = await exec("which graphify 2>/dev/null || true", {
		cwd,
		signal,
		maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES,
	});
	if (whichResult.stdout.trim()) {
		const binPath = whichResult.stdout.trim();
		const shebang = await exec(`head -1 '${binPath}' | tr -d '#!'`, {
			cwd,
			signal,
			maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES,
		});
		let python = shebang.stdout.trim().replace(/^#!\s*/, "");
		if (!python || !/^[a-zA-Z0-9/_.-]+$/.test(python)) {
			python = configPython;
		}
		return python;
	}

	return configPython;
}

/** Ensure graphify is importable; auto-install if needed. */
export async function ensureInstalled(
	exec: ExecFn,
	python: string,
	cwd: string,
	signal?: AbortSignal,
): Promise<void> {
	const check = await exec(`${python} -c "import graphify" 2>/dev/null; echo $?`, {
		cwd,
		signal,
		maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES,
	});
	if (check.stdout.trim() === "0") return;

	await exec(
		`${python} -m pip install graphifyy -q 2>/dev/null || ${python} -m pip install graphifyy -q --break-system-packages 2>&1 | tail -3`,
		{ cwd, signal, maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES },
	);

	const verify = await exec(`${python} -c "import graphify" 2>/dev/null; echo $?`, {
		cwd,
		signal,
		maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES,
	});
	if (verify.stdout.trim() !== "0") {
		throw new Error(
			"Could not install graphifyy. Install manually: pip install graphifyy (or uv tool install graphifyy)",
		);
	}
}

// ---------------------------------------------------------------------------
// Build graph (full pipeline) — delegates to graphify CLI
// ---------------------------------------------------------------------------

export interface BuildOptions {
	inputPath: string;
	mode?: "standard" | "deep";
	noViz?: boolean;
	obsidian?: boolean;
	svg?: boolean;
	graphml?: boolean;
	neo4j?: boolean;
	neo4jUri?: string;
}

export async function buildGraph(
	exec: ExecFn,
	_python: string,
	cwd: string,
	options: BuildOptions,
	signal?: AbortSignal,
	onUpdate?: (message: string) => void,
): Promise<{ nodes: number; edges: number; communities: number }> {
	const { inputPath, noViz } = options;

	const gitignoreResult = await ensureGraphifyGitignore(cwd);
	if (gitignoreResult.updated) {
		onUpdate?.("Updated .gitignore for graph artifacts.");
	}

	// Step 1: graphify extract — full pipeline (detect → extract → cluster → graph.json)
	onUpdate?.("Running graphify extract...");
	const extractResult = await exec(`graphify extract ${shellQuote(inputPath)}`, {
		cwd,
		signal,
		maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES,
	});
	if (extractResult.exitCode !== 0) {
		throw new Error(`graphify extract failed: ${extractResult.stderr || extractResult.stdout}`);
	}
	onUpdate?.(extractResult.stdout.trim());

	// Step 2: graphify cluster-only — generate report + visualization
	const vizFlag = noViz ? " --no-viz" : "";
	onUpdate?.("Generating report and visualization...");
	const clusterResult = await exec(`graphify cluster-only ${shellQuote(inputPath)}${vizFlag}`, {
		cwd,
		signal,
		maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES,
	});
	if (clusterResult.exitCode !== 0) {
		onUpdate?.(`Warning: report generation failed: ${clusterResult.stderr}`);
	} else {
		onUpdate?.(clusterResult.stdout.trim());
	}

	// Step 3: Optional exports (obsidian, svg, graphml)
	if (options.obsidian || options.svg || options.graphml) {
		await exportGraph(exec, _python, cwd, options, signal, onUpdate);
	}

	// Parse stats from extract output
	const stdout = extractResult.stdout;
	const match = stdout.match(
		/(\d[\d,]*)\s+nodes?,\s*(\d[\d,]*)\s+edges?,\s*(\d[\d,]*)\s+communities/i,
	);
	return {
		nodes: match ? Number.parseInt(match[1].replace(/,/g, ""), 10) : 0,
		edges: match ? Number.parseInt(match[2].replace(/,/g, ""), 10) : 0,
		communities: match ? Number.parseInt(match[3].replace(/,/g, ""), 10) : 0,
	};
}

// ---------------------------------------------------------------------------
// Optional exports (obsidian, svg, graphml) — reads from graph.json
// ---------------------------------------------------------------------------

export interface ExportOptions {
	obsidian?: boolean;
	svg?: boolean;
	graphml?: boolean;
}

export async function exportGraph(
	exec: ExecFn,
	python: string,
	cwd: string,
	options: ExportOptions,
	signal?: AbortSignal,
	onUpdate?: (message: string) => void,
): Promise<void> {
	const exports: string[] = [];
	if (options.obsidian) exports.push("obsidian");
	if (options.svg) exports.push("svg");
	if (options.graphml) exports.push("graphml");
	if (exports.length === 0) return;

	onUpdate?.(`Generating exports: ${exports.join(", ")}...`);

	const result = await exec(
		`${python} -c "
import json, sys
from pathlib import Path
from networkx.readwrite import json_graph as _jg

gp = Path('graphify-out/graph.json')
if not gp.exists():
    print('error: graphify-out/graph.json not found', file=sys.stderr)
    sys.exit(1)

data = json.loads(gp.read_text(encoding='utf-8'))
G = _jg.node_link_graph(data, edges='links')

communities = {}
for nid, ndata in G.nodes(data=True):
    cid = ndata.get('community', ndata.get('community_id'))
    if cid is not None:
        key = int(cid) if isinstance(cid, (int, float)) else cid
        communities.setdefault(key, []).append(nid)
labels = {cid: 'Community ' + str(cid) for cid in communities}
${
	options.obsidian
		? `
from graphify.export import to_obsidian, to_canvas
n = to_obsidian(G, communities, 'graphify-out/obsidian', community_labels=labels)
to_canvas(G, communities, 'graphify-out/obsidian/graph.canvas', community_labels=labels)
print(f'Obsidian vault: {n} notes')`
		: ""
}
${
	options.svg
		? `
from graphify.export import to_svg
to_svg(G, communities, 'graphify-out/graph.svg', community_labels=labels)
print('graph.svg written')`
		: ""
}
${
	options.graphml
		? `
from graphify.export import to_graphml
to_graphml(G, communities, 'graphify-out/graph.graphml')
print('graph.graphml written')`
		: ""
}
"`,
		{ cwd, signal, maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES },
	);

	if (result.exitCode !== 0) {
		throw new Error(`Export failed: ${result.stderr || result.stdout}`);
	}
	onUpdate?.(result.stdout.trim());
}

// ---------------------------------------------------------------------------
// Query — delegates to graphify CLI
// ---------------------------------------------------------------------------

export interface QueryOptions {
	question: string;
	mode: "bfs" | "dfs";
	budget?: number;
}

export async function queryGraph(
	exec: ExecFn,
	_python: string,
	cwd: string,
	options: QueryOptions,
	signal?: AbortSignal,
): Promise<string> {
	const { question, mode, budget = 2000 } = options;

	const maxBytes = Math.min(Math.max(budget * 4 + 4096, 16_384), QUERY_EXEC_OUTPUT_BYTES);

	const modeFlag = mode === "dfs" ? " --dfs" : "";
	const result = await exec(
		`graphify query ${shellQuote(question)}${modeFlag} --budget ${budget}`,
		{ cwd, signal, maxOutputBytes: maxBytes },
	);

	if (result.exitCode !== 0) {
		throw new Error(`Query failed: ${result.stderr || result.stdout}`);
	}

	return result.stdout.trim();
}

// ---------------------------------------------------------------------------
// Path (shortest path) — delegates to graphify CLI
// ---------------------------------------------------------------------------

export async function findPath(
	exec: ExecFn,
	_python: string,
	cwd: string,
	fromConcept: string,
	toConcept: string,
	signal?: AbortSignal,
): Promise<string> {
	const result = await exec(`graphify path ${shellQuote(fromConcept)} ${shellQuote(toConcept)}`, {
		cwd,
		signal,
		maxOutputBytes: QUERY_EXEC_OUTPUT_BYTES,
	});

	if (result.exitCode !== 0 && !result.stdout.trim()) {
		throw new Error(`Path search failed: ${result.stderr}`);
	}

	return result.stdout.trim();
}

// ---------------------------------------------------------------------------
// Explain (explain a single node) — delegates to graphify CLI
// ---------------------------------------------------------------------------

export async function explainNode(
	exec: ExecFn,
	_python: string,
	cwd: string,
	concept: string,
	signal?: AbortSignal,
): Promise<string> {
	const result = await exec(`graphify explain ${shellQuote(concept)}`, {
		cwd,
		signal,
		maxOutputBytes: QUERY_EXEC_OUTPUT_BYTES,
	});

	if (result.exitCode !== 0 && !result.stdout.trim()) {
		throw new Error(`Explain failed: ${result.stderr}`);
	}

	return result.stdout.trim();
}

// ---------------------------------------------------------------------------
// Add URL — delegates to graphify CLI
// ---------------------------------------------------------------------------

export interface AddOptions {
	url: string;
	author?: string;
	contributor?: string;
}

export async function addUrl(
	exec: ExecFn,
	_python: string,
	cwd: string,
	options: AddOptions,
	signal?: AbortSignal,
): Promise<string> {
	const { url, author, contributor } = options;
	let cmd = `graphify add ${shellQuote(url)}`;
	if (author) cmd += ` --author ${shellQuote(author)}`;
	if (contributor) cmd += ` --contributor ${shellQuote(contributor)}`;

	const result = await exec(cmd, {
		cwd,
		signal,
		maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES,
	});

	if (result.exitCode !== 0) {
		throw new Error(`Failed to add URL: ${result.stderr || result.stdout}`);
	}

	return result.stdout.trim();
}

// ---------------------------------------------------------------------------
// Update (incremental re-extraction) — delegates to graphify CLI
// ---------------------------------------------------------------------------

export async function updateGraph(
	exec: ExecFn,
	_python: string,
	cwd: string,
	inputPath: string,
	signal?: AbortSignal,
	onUpdate?: (message: string) => void,
): Promise<{ newFiles: number; nodes: number; edges: number }> {
	onUpdate?.("Running graphify update...");

	const result = await exec(`graphify update ${shellQuote(inputPath)}`, {
		cwd,
		signal,
		maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES,
	});

	if (result.exitCode !== 0) {
		throw new Error(`graphify update failed: ${result.stderr || result.stdout}`);
	}

	onUpdate?.(result.stdout.trim());

	// Parse stats from CLI output
	const nodeMatch = result.stdout.match(/(\d[\d,]*)\s+nodes?/i);
	const edgeMatch = result.stdout.match(/(\d[\d,]*)\s+edges?/i);
	const filesMatch = result.stdout.match(/(\d+)\s+(?:files?|re-extracted)/i);

	return {
		newFiles: filesMatch ? Number.parseInt(filesMatch[1], 10) : 1,
		nodes: nodeMatch ? Number.parseInt(nodeMatch[1].replace(/,/g, ""), 10) : 0,
		edges: edgeMatch ? Number.parseInt(edgeMatch[1].replace(/,/g, ""), 10) : 0,
	};
}

// ---------------------------------------------------------------------------
// Watch (file watcher)
// ---------------------------------------------------------------------------

export async function startWatch(
	exec: ExecFn,
	python: string,
	cwd: string,
	inputPath: string,
	debounce: number = 3,
	signal?: AbortSignal,
	onUpdate?: (message: string) => void,
): Promise<string> {
	onUpdate?.(`Watching ${inputPath} for changes...`);
	const result = await exec(
		`${python} -m graphify.watch ${shellQuote(inputPath)} --debounce ${debounce}`,
		{
			cwd,
			signal,
			maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES,
		},
	);
	return result.stdout.trim() || result.stderr.trim();
}

// ---------------------------------------------------------------------------
// Cluster-only (rerun clustering) — delegates to graphify CLI
// ---------------------------------------------------------------------------

export async function clusterOnly(
	exec: ExecFn,
	_python: string,
	cwd: string,
	signal?: AbortSignal,
): Promise<{ communities: number }> {
	const result = await exec("graphify cluster-only .", {
		cwd,
		signal,
		maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES,
	});

	if (result.exitCode !== 0) {
		throw new Error(`Cluster-only failed: ${result.stderr || result.stdout}`);
	}

	const match = result.stdout.trim().match(/(\d+) communities/);
	return { communities: match ? Number.parseInt(match[1], 10) : 0 };
}

// ---------------------------------------------------------------------------
// Extract (headless extraction for CI)
// ---------------------------------------------------------------------------

export interface ExtractOptions {
	inputPath: string;
	backend?: string;
	maxWorkers?: number;
	tokenBudget?: number;
	maxConcurrency?: number;
	apiTimeout?: number;
	resolution?: number;
	excludeHubs?: number;
	exclude?: string[];
	update?: boolean;
	global?: boolean;
	asTag?: string;
}

export interface ExtractResult {
	files: number;
	inputTokens: number;
	outputTokens: number;
	nodes: number;
	edges: number;
}

export async function runExtract(
	exec: ExecFn,
	python: string,
	cwd: string,
	options: ExtractOptions,
	signal?: AbortSignal,
	onUpdate?: (message: string) => void,
): Promise<ExtractResult> {
	const { inputPath, backend, maxWorkers, tokenBudget, maxConcurrency, apiTimeout } = options;

	let cmd = `${python} -m graphify extract ${shellQuote(inputPath)}`;
	if (backend) cmd += ` --backend ${backend}`;
	if (maxWorkers) cmd += ` --max-workers ${maxWorkers}`;
	if (tokenBudget) cmd += ` --token-budget ${tokenBudget}`;
	if (maxConcurrency) cmd += ` --max-concurrency ${maxConcurrency}`;
	if (apiTimeout) cmd += ` --api-timeout ${apiTimeout}`;
	if (options.resolution != null) cmd += ` --resolution ${options.resolution}`;
	if (options.excludeHubs != null) cmd += ` --exclude-hubs ${options.excludeHubs}`;
	if (options.exclude?.length) {
		for (const pattern of options.exclude) {
			cmd += ` --exclude ${shellQuote(pattern)}`;
		}
	}

	onUpdate?.(`Running headless extraction with backend: ${backend ?? "auto-detected"}...`);

	const result = await exec(cmd, { cwd, signal, maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES });

	if (result.exitCode !== 0) {
		throw new Error(`Extract failed: ${result.stderr || result.stdout}`);
	}

	onUpdate?.(result.stdout.trim());

	// Parse stats from extract CLI stdout. The CLI prints:
	//   [graphify extract] wrote graphify-out/graph.json: N nodes, M edges, K communities
	//   [graphify extract] tokens: N in / M out, est. cost (~backend): $X.XXXX
	// Numbers may be comma-formatted (e.g. "12,345").
	const stdout = result.stdout;

	// Match the summary line for nodes/edges/communities
	const summaryMatch = stdout.match(
		/(\d[\d,]*)\s+nodes?,\s*(\d[\d,]*)\s+edges?,\s*(\d[\d,]*)\s+communities/i,
	);
	const nodesStr = summaryMatch
		? summaryMatch[1].replace(/,/g, "")
		: stdout.match(/(\d+)\s+nodes?/i)?.[1];
	const edgesStr = summaryMatch
		? summaryMatch[2].replace(/,/g, "")
		: stdout.match(/(\d+)\s+edges?/i)?.[1];

	// Match token counts from the cost line: "N in / M out"
	const tokenMatch = stdout.match(/(\d[\d,]*)\s+in\s*\/\s*(\d[\d,]*)\s+out/i);
	const inputTokens = tokenMatch
		? Number.parseInt(tokenMatch[1].replace(/,/g, ""), 10)
		: Number.parseInt(stdout.match(/input_tokens[=:](\d+)/i)?.[1] ?? "0", 10);
	const outputTokens = tokenMatch
		? Number.parseInt(tokenMatch[2].replace(/,/g, ""), 10)
		: Number.parseInt(stdout.match(/output_tokens[=:](\d+)/i)?.[1] ?? "0", 10);

	const filesMatch = stdout.match(/(\d+)\s+files?/i);

	return {
		files: filesMatch ? Number.parseInt(filesMatch[1], 10) : 0,
		inputTokens,
		outputTokens,
		nodes: nodesStr ? Number.parseInt(nodesStr, 10) : 0,
		edges: edgesStr ? Number.parseInt(edgesStr, 10) : 0,
	};
}

// ---------------------------------------------------------------------------
// Export callflow HTML
// ---------------------------------------------------------------------------

export async function exportCallflowHtml(
	exec: ExecFn,
	python: string,
	cwd: string,
	options?: { graphPath?: string; outputPath?: string },
	signal?: AbortSignal,
): Promise<string> {
	const graphPath = options?.graphPath ?? "graphify-out/graph.json";
	const outputPath = options?.outputPath ?? "graphify-out/callflow.html";
	const result = await exec(
		`${python} -m graphify export callflow-html --graph ${shellQuote(graphPath)} --output ${shellQuote(outputPath)}`,
		{ cwd, signal, maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES },
	);

	if (result.exitCode !== 0) {
		throw new Error(`Callflow export failed: ${result.stderr || result.stdout}`);
	}

	return outputPath;
}

// ---------------------------------------------------------------------------
// Tree HTML (collapsible tree visualization)
// ---------------------------------------------------------------------------

export async function generateTree(
	exec: ExecFn,
	python: string,
	cwd: string,
	options?: { graphPath?: string; outputPath?: string; root?: string; label?: string },
	signal?: AbortSignal,
): Promise<string> {
	const graphPath = options?.graphPath ?? "graphify-out/graph.json";
	const outputPath = options?.outputPath ?? "graphify-out/GRAPH_TREE.html";
	let cmd = `${python} -m graphify tree --graph ${shellQuote(graphPath)} --output ${shellQuote(outputPath)}`;
	if (options?.root) cmd += ` --root ${shellQuote(options.root)}`;
	if (options?.label) cmd += ` --label ${shellQuote(options.label)}`;

	const result = await exec(cmd, { cwd, signal, maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES });
	if (result.exitCode !== 0) {
		throw new Error(`Tree generation failed: ${result.stderr}`);
	}
	return outputPath;
}

// ---------------------------------------------------------------------------
// Git hooks (install/uninstall/status)
// ---------------------------------------------------------------------------

export async function hookAction(
	exec: ExecFn,
	python: string,
	cwd: string,
	action: "install" | "uninstall" | "status",
	signal?: AbortSignal,
): Promise<string> {
	const result = await exec(`${python} -m graphify hook ${action}`, {
		cwd,
		signal,
		maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES,
	});
	if (result.exitCode !== 0 && action !== "status") {
		throw new Error(`Hook ${action} failed: ${result.stderr}`);
	}
	return result.stdout.trim() || result.stderr.trim();
}

// ---------------------------------------------------------------------------
// Neo4j push
// ---------------------------------------------------------------------------

export async function pushNeo4j(
	exec: ExecFn,
	python: string,
	cwd: string,
	uri: string,
	user: string,
	credentials: string,
	signal?: AbortSignal,
): Promise<string> {
	const result = await exec(
		`NEO4J_URI=${shellQuote(uri)} NEO4J_USER=${shellQuote(user)} NEO4J_CREDS=${shellQuote(credentials)} ${python} -c "
import json, os
from graphify.build import build_from_json
from graphify.export import push_to_neo4j
from pathlib import Path

extraction = json.loads(Path('.graphify_extract.json').read_text()) if Path('.graphify_extract.json').exists() else None
if extraction:
    G = build_from_json(extraction)
else:
    from networkx.readwrite import json_graph; import networkx as nx
    data = json.loads(Path('graphify-out/graph.json').read_text())
    G = json_graph.node_link_graph(data, edges='links')

r = push_to_neo4j(G, uri=os.environ['NEO4J_URI'], user=os.environ['NEO4J_USER'], credentials=os.environ['NEO4J_CREDS'])
print(f'Pushed to Neo4j: {r['nodes']} nodes, {r['edges']} edges')
"`,
		{ cwd, signal, maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES },
	);
	if (result.exitCode !== 0) {
		throw new Error(`Neo4j push failed: ${result.stderr || result.stdout}`);
	}
	return result.stdout.trim();
}

// ---------------------------------------------------------------------------
// Save result (feedback loop)
// ---------------------------------------------------------------------------

export async function saveResult(
	exec: ExecFn,
	python: string,
	cwd: string,
	options: { question: string; answer: string; type: string; nodes: string[] },
	signal?: AbortSignal,
): Promise<string> {
	const q = options.question;
	const a = options.answer;
	const t = options.type;
	const nodes = options.nodes.map((n) => shellQuote(n)).join(" ");

	const result = await exec(
		`${python} -m graphify save-result --question ${shellQuote(q)} --answer ${shellQuote(a)} --type ${shellQuote(t)} --nodes ${nodes}`,
		{ cwd, signal, maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES },
	);
	return result.stdout.trim() || result.stderr.trim();
}

// ---------------------------------------------------------------------------
// Clone repo
// ---------------------------------------------------------------------------

export async function cloneRepo(
	exec: ExecFn,
	python: string,
	cwd: string,
	githubUrl: string,
	signal?: AbortSignal,
): Promise<string> {
	const result = await exec(`${python} -m graphify clone ${shellQuote(githubUrl)}`, {
		cwd,
		signal,
		maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES,
	});
	if (result.exitCode !== 0) {
		throw new Error(`Clone failed: ${result.stderr}`);
	}
	return result.stdout.trim();
}

// ---------------------------------------------------------------------------
// Merge graphs
// ---------------------------------------------------------------------------

export async function mergeGraphs(
	exec: ExecFn,
	python: string,
	cwd: string,
	graphs: string[],
	outPath?: string,
	signal?: AbortSignal,
): Promise<string> {
	const graphArgs = graphs.map((g) => shellQuote(g)).join(" ");
	let cmd = `${python} -m graphify merge-graphs ${graphArgs}`;
	if (outPath) cmd += ` --out ${shellQuote(outPath)}`;

	const result = await exec(cmd, { cwd, signal, maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES });
	if (result.exitCode !== 0) {
		throw new Error(`Merge failed: ${result.stderr}`);
	}
	return result.stdout.trim();
}

// ---------------------------------------------------------------------------
// Upgrade (check/install graphifyy via uv)
// ---------------------------------------------------------------------------

export interface UpgradeCheckResult {
	installedVersion: string;
	latestVersion: string;
	updateAvailable: boolean;
}

export interface UpgradeRunResult {
	previousVersion: string;
	newVersion: string;
	upgraded: boolean;
}

/** Get the currently installed graphifyy version. */
export async function getInstalledVersion(exec: ExecFn, signal?: AbortSignal): Promise<string> {
	const result = await exec(
		"graphify --version 2>/dev/null || uv tool list 2>/dev/null | grep graphifyy | awk '{print $2}'",
		{ signal, maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES },
	);
	const raw = result.stdout.trim();
	// graphify --version may output warning lines; take the last line
	const lastLine = raw.split("\n").pop() || raw;
	return lastLine.replace(/^v/, "").replace(/^graphify\s+/i, "");
}

/** Get the latest available graphifyy version from PyPI. */
export async function getLatestVersion(exec: ExecFn, signal?: AbortSignal): Promise<string | null> {
	// pip3 index versions outputs: "graphifyy (0.8.16) Available versions: ..."
	const result = await exec(
		"pip3 index versions graphifyy 2>/dev/null | head -1 | sed -n 's/graphifyy ([^)]*).*/\\1/p'",
		{ signal, maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES },
	);
	const version = result.stdout.trim();
	if (version && /^\d+\.\d+/.test(version)) return version;

	// Fallback: uv pip index
	const uvResult = await exec(
		"uv pip index versions graphifyy 2>/dev/null | head -1 | sed -n 's/graphifyy (v?([^)]*)).*/\\1/p'",
		{ signal, maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES },
	);
	const uvVersion = uvResult.stdout.trim().replace(/^v/, "");
	if (uvVersion && /^\d+\.\d+/.test(uvVersion)) return uvVersion;

	return null;
}

/** Check the currently installed and latest available version of graphifyy. */
export async function checkUpgrade(
	exec: ExecFn,
	signal?: AbortSignal,
): Promise<UpgradeCheckResult> {
	const installedVersion = await getInstalledVersion(exec, signal);
	const latestVersion = (await getLatestVersion(exec, signal)) ?? installedVersion;
	const updateAvailable = latestVersion !== installedVersion;

	return { installedVersion, latestVersion, updateAvailable };
}

/** Run uv tool upgrade graphifyy and return the result. */
export async function runUpgrade(exec: ExecFn, signal?: AbortSignal): Promise<UpgradeRunResult> {
	const beforeVersion = await getInstalledVersion(exec, signal);

	const result = await exec("uv tool upgrade graphifyy 2>&1", {
		signal,
		maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES,
	});
	if (result.exitCode !== 0) {
		throw new Error(`Upgrade failed: ${result.stderr || result.stdout}`);
	}

	const afterVersion = await getInstalledVersion(exec, signal);

	// Detect upgrade from uv output: "Updated graphifyy v0.8.13 -> v0.8.16"
	const upgraded = afterVersion !== beforeVersion;

	return {
		previousVersion: beforeVersion,
		newVersion: afterVersion,
		upgraded,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function ensureGraphifyGitignore(cwd: string): Promise<{ updated: boolean }> {
	const path = join(cwd, ".gitignore");
	let original = "";

	try {
		original = await readFile(path, "utf-8");
	} catch {
		original = "";
	}

	const lines = original.length > 0 ? original.split(/\r?\n/) : [];
	const filtered = lines.filter((line) => {
		const trimmed = line.trim();
		return !GRAPHIFY_GITIGNORE_LEGACY.includes(
			trimmed as (typeof GRAPHIFY_GITIGNORE_LEGACY)[number],
		);
	});

	for (const entry of GRAPHIFY_GITIGNORE_REQUIRED) {
		if (!filtered.some((line) => line.trim() === entry)) {
			filtered.push(entry);
		}
	}

	let next = filtered.join("\n");
	if (next.length > 0 && !next.endsWith("\n")) {
		next += "\n";
	}

	if (next === original) {
		return { updated: false };
	}

	await writeFile(path, next, "utf-8");
	return { updated: true };
}

// ---------------------------------------------------------------------------
// Skill sync — fetch upstream skill-pi.md and write to bundled skills/ directory
// ---------------------------------------------------------------------------

export interface SkillSyncResult {
	synced: boolean;
	fromVersion: string;
	toVersion: string;
	error?: string;
}

/** Upstream skill file URL template. */
const UPSTREAM_SKILL_URL =
	"https://raw.githubusercontent.com/safishamsi/graphify/v{VERSION}/graphify/skill-pi.md";

/**
 * Fetch the upstream skill-pi.md for a given graphify version and write it
 * to the bundled skills directory. Uses native fetch — no exec dependency.
 *
 * @param version  Semver version string (e.g. "0.8.14")
 * @param extensionRoot  Absolute path to the pi-graphify package root
 * @param signal  Optional abort signal
 */
export async function syncSkillFromUpstream(
	version: string,
	extensionRoot: string,
	signal?: AbortSignal,
): Promise<SkillSyncResult> {
	const url = UPSTREAM_SKILL_URL.replace("{VERSION}", version);
	const skillPath = join(extensionRoot, "skills", "graphify", "SKILL.md");

	try {
		const response = await fetch(url, { signal });
		if (!response.ok) {
			return {
				synced: false,
				fromVersion: "",
				toVersion: version,
				error: `HTTP ${response.status} fetching ${url}`,
			};
		}

		const content = await response.text();

		if (!content.trim()) {
			return {
				synced: false,
				fromVersion: "",
				toVersion: version,
				error: "Fetched skill-pi.md is empty",
			};
		}

		// Read the current skill to detect if it actually changed
		let currentContent: string | undefined;
		try {
			currentContent = await readFile(skillPath, "utf-8");
		} catch {
			// File may not exist yet — that's fine
		}

		if (currentContent === content) {
			return {
				synced: false,
				fromVersion: version,
				toVersion: version,
			};
		}

		await writeFile(skillPath, content, "utf-8");

		return {
			synced: true,
			fromVersion: currentContent ? "previous" : "none",
			toVersion: version,
		};
	} catch (err) {
		return {
			synced: false,
			fromVersion: "",
			toVersion: version,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Update the upstreamVersion in .upstream.json after a successful skill sync.
 */
export async function updateUpstreamVersion(
	extensionRoot: string,
	newVersion: string,
): Promise<void> {
	const upstreamPath = join(extensionRoot, ".upstream.json");

	let raw: string;
	try {
		raw = await readFile(upstreamPath, "utf-8");
	} catch {
		return; // No .upstream.json — nothing to update
	}

	const upstream = JSON.parse(raw) as Record<string, unknown>;
	if (
		typeof upstream.primary === "object" &&
		upstream.primary !== null &&
		"upstreamVersion" in (upstream.primary as Record<string, unknown>)
	) {
		(upstream.primary as Record<string, unknown>).upstreamVersion = newVersion;
		await writeFile(upstreamPath, `${JSON.stringify(upstream, null, "\t")}\n`, "utf-8");
	}
}

/** Safe shell argument quoting — wraps in single quotes, escapes internal single quotes. */
export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Safe Python literal embedding for shell double-quoted -c "..." context. */
export function pythonLiteral(value: string): string {
	const escaped = value
		.replace(/\\/g, "\\\\") // \ → \\ (must be first)
		.replace(/'/g, "\\'") // ' → \' (Python single-quoted literal)
		.replace(/"/g, '\\"') // " → \" (prevents ending shell double-quote)
		.replace(/\$/g, "\\$") // $ → \$ (prevent shell variable expansion)
		.replace(/`/g, "\\`"); // ` → \` (prevent command substitution)
	return `'${escaped}'`;
}
