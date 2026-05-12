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
}

export interface ExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export type ExecFn = (command: string, options?: ExecOptions) => Promise<ExecResult>;

const GRAPHIFY_GITIGNORE_REQUIRED = [
	"graphify-out/cache/",
	"graphify-out/.graphify_python",
	"graphify-out/.graphify_root",
	"graphify-out/cost.json",
] as const;

const GRAPHIFY_GITIGNORE_LEGACY = ["graphify-out/", "/graphify-out/"] as const;

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
	});
	if (cacheResult.stdout.trim()) return cacheResult.stdout.trim();

	const whichResult = await exec("which graphify 2>/dev/null || true", { cwd, signal });
	if (whichResult.stdout.trim()) {
		const binPath = whichResult.stdout.trim();
		const shebang = await exec(`head -1 '${binPath}' | tr -d '#!'`, { cwd, signal });
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
	});
	if (check.stdout.trim() === "0") return;

	await exec(
		`${python} -m pip install graphifyy -q 2>/dev/null || ${python} -m pip install graphifyy -q --break-system-packages 2>&1 | tail -3`,
		{ cwd, signal },
	);

	const verify = await exec(`${python} -c "import graphify" 2>/dev/null; echo $?`, {
		cwd,
		signal,
	});
	if (verify.stdout.trim() !== "0") {
		throw new Error(
			"Could not install graphifyy. Install manually: pip install graphifyy (or uv tool install graphifyy)",
		);
	}
}

// ---------------------------------------------------------------------------
// Detect files
// ---------------------------------------------------------------------------

export interface DetectResult {
	total_files: number;
	total_words: number;
	files: Record<string, string[]>;
	skipped_sensitive?: number;
}

export async function detectFiles(
	exec: ExecFn,
	python: string,
	cwd: string,
	inputPath: string,
	signal?: AbortSignal,
): Promise<DetectResult> {
	const result = await exec(
		`${python} -c "import json; from graphify.detect import detect; from pathlib import Path; r=detect(Path('${escapeShell(inputPath)}')); print(json.dumps(r))"`,
		{ cwd, signal },
	);
	if (result.exitCode !== 0) {
		throw new Error(`graphify detect failed: ${result.stderr}`);
	}
	return JSON.parse(result.stdout.trim()) as DetectResult;
}

// ---------------------------------------------------------------------------
// Build graph (full pipeline)
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
	python: string,
	cwd: string,
	options: BuildOptions,
	signal?: AbortSignal,
	onUpdate?: (message: string) => void,
): Promise<{ nodes: number; edges: number; communities: number }> {
	const { inputPath } = options;
	const outDir = "graphify-out";

	const gitignoreResult = await ensureGraphifyGitignore(cwd);
	if (gitignoreResult.updated) {
		onUpdate?.("Updated .gitignore for graphify artifacts.");
	}

	await exec(`mkdir -p ${outDir}`, { cwd, signal });

	await exec(
		`${python} -c "import sys; open('${outDir}/.graphify_python', 'w').write(sys.executable)"`,
		{
			cwd,
			signal,
		},
	);

	onUpdate?.("Detecting files...");
	const detection = await detectFiles(exec, python, cwd, inputPath, signal);

	if (detection.total_files === 0) {
		throw new Error(`No supported files found in ${inputPath}.`);
	}

	onUpdate?.(
		`Corpus: ${detection.total_files} files · ~${detection.total_words.toLocaleString()} words`,
	);

	// Save detection result for downstream steps
	await writeFile(join(cwd, ".graphify_detect.json"), JSON.stringify(detection, null, 2), "utf-8");

	// AST extraction
	onUpdate?.("Extracting structural relationships (AST)...");
	const astResult = await exec(
		`${python} -c "
import sys, json
from graphify.extract import collect_files, extract
from pathlib import Path

code_files = []
detect = json.loads(Path('.graphify_detect.json').read_text())
for f in detect.get('files', {}).get('code', []):
    code_files.extend(collect_files(Path(f)) if Path(f).is_dir() else [Path(f)])

if code_files:
    result = extract(code_files)
    Path('.graphify_ast.json').write_text(json.dumps(result, indent=2))
    print(f'AST: {len(result['nodes'])} nodes, {len(result['edges'])} edges')
else:
    Path('.graphify_ast.json').write_text(json.dumps({'nodes':[],'edges':[],'input_tokens':0,'output_tokens':0}))
    print('No code files - skipping AST extraction')
"`,
		{ cwd, signal },
	);

	if (astResult.exitCode !== 0) {
		throw new Error(`AST extraction failed: ${astResult.stderr}`);
	}
	onUpdate?.(astResult.stdout.trim());

	// Semantic extraction (placeholder for code-only corpus)
	const semanticFiles = [
		...(detection.files.document ?? []),
		...(detection.files.paper ?? []),
		...(detection.files.image ?? []),
	];
	if (semanticFiles.length > 0) {
		onUpdate?.(
			`Semantic extraction: ${semanticFiles.length} files — extracting entities and relationships...`,
		);
	}

	// Always write semantic placeholder for merge step
	await exec(
		`${python} -c "import json; from pathlib import Path; Path('.graphify_semantic.json').write_text(json.dumps({'nodes':[],'edges':[],'hyperedges':[],'input_tokens':0,'output_tokens':0}))"`,
		{ cwd, signal },
	);

	// Merge AST + semantic
	onUpdate?.("Merging extraction results...");
	const mergeResult = await exec(
		`${python} -c "
import json; from pathlib import Path
ast = json.loads(Path('.graphify_ast.json').read_text())
sem = json.loads(Path('.graphify_semantic.json').read_text())
seen = {n['id'] for n in ast['nodes']}
merged_nodes = list(ast['nodes'])
for n in sem['nodes']:
    if n['id'] not in seen: merged_nodes.append(n); seen.add(n['id'])
merged_edges = ast['edges'] + sem['edges']
merged = {'nodes': merged_nodes, 'edges': merged_edges, 'hyperedges': sem.get('hyperedges',[]), 'input_tokens': sem.get('input_tokens',0), 'output_tokens': sem.get('output_tokens',0)}
Path('.graphify_extract.json').write_text(json.dumps(merged, indent=2))
print(f'Merged: {len(merged_nodes)} nodes, {len(merged_edges)} edges')
"`,
		{ cwd, signal },
	);
	if (mergeResult.exitCode !== 0) {
		throw new Error(`Merge failed: ${mergeResult.stderr}`);
	}
	onUpdate?.(mergeResult.stdout.trim());

	// Build, cluster, analyze
	onUpdate?.("Building graph and detecting communities...");
	const escapedPath = escapeShell(inputPath);
	const buildResult = await exec(
		`${python} -c "
import json
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json
from pathlib import Path

extraction = json.loads(Path('.graphify_extract.json').read_text())
detection = json.loads(Path('.graphify_detect.json').read_text()) if Path('.graphify_detect.json').exists() else {}

G = build_from_json(extraction)
if G.number_of_nodes() == 0:
    print('ERROR: Graph is empty')
    raise SystemExit(1)
communities = cluster(G)
cohesion = score_all(G, communities)
tokens = {'input': extraction.get('input_tokens',0), 'output': extraction.get('output_tokens',0)}
gods = god_nodes(G)
surprises = surprising_connections(G, communities)
labels = {cid: 'Community ' + str(cid) for cid in communities}
questions = suggest_questions(G, communities, labels)

report = generate(G, communities, cohesion, labels, gods, surprises, detection, tokens, '${escapedPath}', suggested_questions=questions)
Path('graphify-out/GRAPH_REPORT.md').write_text(report)
to_json(G, communities, 'graphify-out/graph.json')

analysis = {'communities': {str(k):v for k,v in communities.items()}, 'cohesion': {str(k):v for k,v in cohesion.items()}, 'gods': gods, 'surprises': surprises, 'questions': questions}
Path('.graphify_analysis.json').write_text(json.dumps(analysis, indent=2))
print(f'Graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges, {len(communities)} communities')
"`,
		{ cwd, signal },
	);

	if (buildResult.exitCode !== 0) {
		throw new Error(`Build failed: ${buildResult.stderr || buildResult.stdout}`);
	}
	onUpdate?.(buildResult.stdout.trim());

	// Generate HTML (unless no-viz)
	if (!options.noViz) {
		onUpdate?.("Generating interactive HTML visualization...");
		await exec(
			`${python} -c "
import json
from graphify.build import build_from_json
from graphify.export import to_html
from pathlib import Path

extraction = json.loads(Path('.graphify_extract.json').read_text())
analysis = json.loads(Path('.graphify_analysis.json').read_text())
labels_raw = json.loads(Path('.graphify_labels.json').read_text()) if Path('.graphify_labels.json').exists() else {}

G = build_from_json(extraction)
communities = {int(k):v for k,v in analysis['communities'].items()}
labels = {int(k):v for k,v in labels_raw.items()}

if G.number_of_nodes() > 5000:
    print(f'Graph has {G.number_of_nodes()} nodes - too large for HTML viz.')
else:
    to_html(G, communities, 'graphify-out/graph.html', community_labels=labels or None)
    print('graph.html written')
"`,
			{ cwd, signal },
		);
	}

	// Optional exports
	if (options.obsidian) {
		onUpdate?.("Generating Obsidian vault...");
		await exec(
			`${python} -c "
import json
from graphify.build import build_from_json
from graphify.export import to_obsidian, to_canvas
from pathlib import Path

extraction = json.loads(Path('.graphify_extract.json').read_text())
analysis = json.loads(Path('.graphify_analysis.json').read_text())
labels_raw = json.loads(Path('.graphify_labels.json').read_text()) if Path('.graphify_labels.json').exists() else {}

G = build_from_json(extraction)
communities = {int(k):v for k,v in analysis['communities'].items()}
cohesion = {int(k):v for k,v in analysis['cohesion'].items()}
labels = {int(k):v for k,v in labels_raw.items()}

n = to_obsidian(G, communities, 'graphify-out/obsidian', community_labels=labels or None, cohesion=cohesion)
print(f'Obsidian vault: {n} notes')
to_canvas(G, communities, 'graphify-out/obsidian/graph.canvas', community_labels=labels or None)
"`,
			{ cwd, signal },
		);
	}

	if (options.svg) {
		await exec(
			`${python} -c "
import json
from graphify.build import build_from_json
from graphify.export import to_svg
from pathlib import Path
extraction = json.loads(Path('.graphify_extract.json').read_text())
analysis = json.loads(Path('.graphify_analysis.json').read_text())
labels_raw = json.loads(Path('.graphify_labels.json').read_text()) if Path('.graphify_labels.json').exists() else {}
G = build_from_json(extraction)
communities = {int(k):v for k,v in analysis['communities'].items()}
labels = {int(k):v for k,v in labels_raw.items()}
to_svg(G, communities, 'graphify-out/graph.svg', community_labels=labels or None)
print('graph.svg written')
"`,
			{ cwd, signal },
		);
	}

	if (options.graphml) {
		await exec(
			`${python} -c "
import json
from graphify.build import build_from_json
from graphify.export import to_graphml
from pathlib import Path
extraction = json.loads(Path('.graphify_extract.json').read_text())
analysis = json.loads(Path('.graphify_analysis.json').read_text())
G = build_from_json(extraction)
communities = {int(k):v for k,v in analysis['communities'].items()}
to_graphml(G, communities, 'graphify-out/graph.graphml')
print('graph.graphml written')
"`,
			{ cwd, signal },
		);
	}

	if (options.neo4j) {
		await exec(
			`${python} -c "
import json
from graphify.build import build_from_json
from graphify.export import to_cypher
from pathlib import Path
G = build_from_json(json.loads(Path('.graphify_extract.json').read_text()))
to_cypher(G, 'graphify-out/cypher.txt')
print('cypher.txt written')
"`,
			{ cwd, signal },
		);
	}

	// Save manifest and cost
	await exec(
		`${python} -c "
import json
from pathlib import Path
from datetime import datetime, timezone
from graphify.detect import save_manifest

detect = json.loads(Path('.graphify_detect.json').read_text()) if Path('.graphify_detect.json').exists() else {}
if detect: save_manifest(detect.get('files', {}))

extract = json.loads(Path('.graphify_extract.json').read_text()) if Path('.graphify_extract.json').exists() else {}
input_tok = extract.get('input_tokens', 0)
output_tok = extract.get('output_tokens', 0)

cost_path = Path('graphify-out/cost.json')
if cost_path.exists():
    cost = json.loads(cost_path.read_text())
else:
    cost = {'runs': [], 'total_input_tokens': 0, 'total_output_tokens': 0}

cost['runs'].append({'date': datetime.now(timezone.utc).isoformat(), 'input_tokens': input_tok, 'output_tokens': output_tok, 'files': detect.get('total_files',0)})
cost['total_input_tokens'] += input_tok
cost['total_output_tokens'] += output_tok
cost_path.write_text(json.dumps(cost, indent=2))
"`,
		{ cwd, signal },
	);

	// Clean up temp files
	await exec(
		`rm -f .graphify_detect.json .graphify_extract.json .graphify_ast.json .graphify_semantic.json .graphify_analysis.json .graphify_labels.json`,
		{ cwd, signal },
	);

	const match = buildResult.stdout.match(/Graph: (\d+) nodes, (\d+) edges, (\d+) communities/);
	return {
		nodes: match ? Number.parseInt(match[1], 10) : 0,
		edges: match ? Number.parseInt(match[2], 10) : 0,
		communities: match ? Number.parseInt(match[3], 10) : 0,
	};
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export interface QueryOptions {
	question: string;
	mode: "bfs" | "dfs";
	budget?: number;
}

export async function queryGraph(
	exec: ExecFn,
	python: string,
	cwd: string,
	options: QueryOptions,
	signal?: AbortSignal,
): Promise<string> {
	const { question, mode, budget = 2000 } = options;
	const escapedQuestion = escapeShell(question);

	const result = await exec(
		`${python} -c "
import json, sys
from networkx.readwrite import json_graph
from pathlib import Path

if not Path('graphify-out/graph.json').exists():
    print('ERROR: No graph found. Build one first.')
    sys.exit(1)

data = json.loads(Path('graphify-out/graph.json').read_text())
G = json_graph.node_link_graph(data, edges='links')

question = '${escapedQuestion}'
mode = '${mode}'
terms = [t.lower() for t in question.split() if len(t) > 3]

scored = []
for nid, ndata in G.nodes(data=True):
    label = ndata.get('label', '').lower()
    score = sum(1 for t in terms if t in label)
    if score > 0: scored.append((score, nid))
scored.sort(reverse=True)
start_nodes = [nid for _, nid in scored[:3]]

if not start_nodes:
    print('No matching nodes found for: ' + ' '.join(terms))
    sys.exit(0)

subgraph_nodes = set()
subgraph_edges = []

if mode == 'dfs':
    visited = set()
    stack = [(n, 0) for n in reversed(start_nodes)]
    while stack:
        node, depth = stack.pop()
        if node in visited or depth > 6: continue
        visited.add(node)
        subgraph_nodes.add(node)
        for neighbor in G.neighbors(node):
            if neighbor not in visited:
                stack.append((neighbor, depth + 1))
                subgraph_edges.append((node, neighbor))
else:
    frontier = set(start_nodes)
    subgraph_nodes = set(start_nodes)
    for _ in range(3):
        next_frontier = set()
        for n in frontier:
            for neighbor in G.neighbors(n):
                if neighbor not in subgraph_nodes:
                    next_frontier.add(neighbor)
                    subgraph_edges.append((n, neighbor))
        subgraph_nodes.update(next_frontier)
        frontier = next_frontier

def relevance(nid):
    label = G.nodes[nid].get('label', '').lower()
    return sum(1 for t in terms if t in label)

ranked_nodes = sorted(subgraph_nodes, key=relevance, reverse=True)

lines = [f'Traversal: {mode.upper()} | Start: {[G.nodes[n].get('label', n) for n in start_nodes]} | {len(subgraph_nodes)} nodes']
for nid in ranked_nodes:
    d = G.nodes[nid]
    lines.append(f'  NODE {d.get('label', nid)} [src={d.get('source_file', '')}]')
for u, v in subgraph_edges:
    if u in subgraph_nodes and v in subgraph_nodes:
        d = G.edges[u, v]
        lines.append(f'  EDGE {G.nodes[u].get('label', u)} --{d.get('relation', '')} [{d.get('confidence', '')}]--> {G.nodes[v].get('label', v)}')

output = chr(10).join(lines)
if len(output) > ${budget * 4}:
    output = output[:${budget * 4}] + f'\\n... (truncated)'
print(output)
"`,
		{ cwd, signal },
	);

	if (result.exitCode !== 0) {
		throw new Error(`Query failed: ${result.stderr || result.stdout}`);
	}

	return result.stdout.trim();
}

// ---------------------------------------------------------------------------
// Path (shortest path between two concepts)
// ---------------------------------------------------------------------------

export async function findPath(
	exec: ExecFn,
	python: string,
	cwd: string,
	fromConcept: string,
	toConcept: string,
	signal?: AbortSignal,
): Promise<string> {
	const escapedFrom = JSON.stringify(fromConcept).replace(/'/g, "'\\''");
	const escapedTo = JSON.stringify(toConcept).replace(/'/g, "'\\''");

	const result = await exec(
		`${python} -c "
import json, sys
import networkx as nx
from networkx.readwrite import json_graph
from pathlib import Path

if not Path('graphify-out/graph.json').exists():
    print('ERROR: No graph found. Build one first.')
    sys.exit(1)

data = json.loads(Path('graphify-out/graph.json').read_text())
G = json_graph.node_link_graph(data, edges='links')

a_term = '${escapedFrom}'
b_term = '${escapedTo}'

def find_node(term):
    term = term.lower()
    scored = sorted([(sum(1 for w in term.split() if w in G.nodes[n].get('label','').lower()), n) for n in G.nodes()], reverse=True)
    return scored[0][1] if scored and scored[0][0] > 0 else None

src = find_node(a_term)
tgt = find_node(b_term)

if not src or not tgt:
    print(f'Could not find nodes matching: {a_term!r} or {b_term!r}')
    sys.exit(0)

try:
    path = nx.shortest_path(G, src, tgt)
    print(f'Shortest path ({len(path)-1} hops):')
    for i, nid in enumerate(path):
        label = G.nodes[nid].get('label', nid)
        if i < len(path) - 1:
            edge = G.edges[nid, path[i+1]]
            rel = edge.get('relation', '')
            conf = edge.get('confidence', '')
            print(f'  {label} --{rel}--> [{conf}]')
        else:
            print(f'  {label}')
except nx.NetworkXNoPath:
    print(f'No path found between {a_term!r} and {b_term!r}')
"`,
		{ cwd, signal },
	);

	if (result.exitCode !== 0 && !result.stdout.trim()) {
		throw new Error(`Path search failed: ${result.stderr}`);
	}

	return result.stdout.trim();
}

// ---------------------------------------------------------------------------
// Explain (explain a single node)
// ---------------------------------------------------------------------------

export async function explainNode(
	exec: ExecFn,
	python: string,
	cwd: string,
	concept: string,
	signal?: AbortSignal,
): Promise<string> {
	const escapedConcept = escapeShell(concept);

	const result = await exec(
		`${python} -c "
import json, sys
from networkx.readwrite import json_graph
from pathlib import Path

if not Path('graphify-out/graph.json').exists():
    print('ERROR: No graph found. Build one first.')
    sys.exit(1)

data = json.loads(Path('graphify-out/graph.json').read_text())
G = json_graph.node_link_graph(data, edges='links')

term = '${escapedConcept}'
term_lower = term.lower()

scored = sorted([(sum(1 for w in term_lower.split() if w in G.nodes[n].get('label','').lower()), n) for n in G.nodes()], reverse=True)
if not scored or scored[0][0] == 0:
    print(f'No node matching {term!r}')
    sys.exit(0)

nid = scored[0][1]
d = G.nodes[nid]
print(f'NODE: {d.get('label', nid)}')
print(f'  source: {d.get('source_file', 'unknown')}')
print(f'  type: {d.get('file_type', 'unknown')}')
print(f'  degree: {G.degree(nid)}')
print()
print('CONNECTIONS:')
for neighbor in G.neighbors(nid):
    edge = G.edges[nid, neighbor]
    nlabel = G.nodes[neighbor].get('label', neighbor)
    rel = edge.get('relation', '')
    conf = edge.get('confidence', '')
    src_file = G.nodes[neighbor].get('source_file', '')
    print(f'  --{rel}--> {nlabel} [{conf}] ({src_file})')
"`,
		{ cwd, signal },
	);

	if (result.exitCode !== 0 && !result.stdout.trim()) {
		throw new Error(`Explain failed: ${result.stderr}`);
	}

	return result.stdout.trim();
}

// ---------------------------------------------------------------------------
// Add URL
// ---------------------------------------------------------------------------

export interface AddOptions {
	url: string;
	author?: string;
	contributor?: string;
}

export async function addUrl(
	exec: ExecFn,
	python: string,
	cwd: string,
	options: AddOptions,
	signal?: AbortSignal,
): Promise<string> {
	const { url, author, contributor } = options;
	const escapedUrl = escapeShell(url);
	const authorKwarg = author ? `, author='${escapeShell(author)}'` : "";
	const contributorKwarg = contributor ? `, contributor='${escapeShell(contributor)}'` : "";

	const result = await exec(
		`${python} -c "
import sys
from graphify.ingest import ingest
from pathlib import Path

try:
    out = ingest('${escapedUrl}', Path('./raw')${authorKwarg}${contributorKwarg})
    print(f'Saved to {out}')
except ValueError as e:
    print(f'error: {e}', file=sys.stderr)
    sys.exit(1)
except RuntimeError as e:
    print(f'error: {e}', file=sys.stderr)
    sys.exit(1)
"`,
		{ cwd, signal },
	);

	if (result.exitCode !== 0) {
		throw new Error(`Failed to add URL: ${result.stderr || result.stdout}`);
	}

	return result.stdout.trim();
}

// ---------------------------------------------------------------------------
// Update (incremental re-extraction)
// ---------------------------------------------------------------------------

export async function updateGraph(
	exec: ExecFn,
	python: string,
	cwd: string,
	inputPath: string,
	signal?: AbortSignal,
	onUpdate?: (message: string) => void,
): Promise<{ newFiles: number; nodes: number; edges: number }> {
	onUpdate?.("Checking for changes...");

	const escapedPath = escapeShell(inputPath);
	const result = await exec(
		`${python} -c "
import json
from graphify.detect import detect_incremental
from pathlib import Path

r = detect_incremental(Path('${escapedPath}'))
print(json.dumps(r, indent=2))
"`,
		{ cwd, signal },
	);

	if (result.exitCode !== 0) {
		throw new Error(`Incremental detect failed: ${result.stderr}`);
	}

	const incremental = JSON.parse(result.stdout.trim()) as {
		new_total: number;
		new_files?: Record<string, string[]>;
	};

	if (incremental.new_total === 0) {
		return { newFiles: 0, nodes: 0, edges: 0 };
	}

	onUpdate?.(`${incremental.new_total} files changed — re-extracting...`);

	const buildResult = await buildGraph(exec, python, cwd, { inputPath }, signal, onUpdate);

	return {
		newFiles: incremental.new_total,
		nodes: buildResult.nodes,
		edges: buildResult.edges,
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
	const escapedPath = escapeShell(inputPath);
	const result = await exec(`${python} -m graphify.watch '${escapedPath}' --debounce ${debounce}`, {
		cwd,
		signal,
	});
	return result.stdout.trim() || result.stderr.trim();
}

// ---------------------------------------------------------------------------
// Cluster-only (rerun clustering)
// ---------------------------------------------------------------------------

export async function clusterOnly(
	exec: ExecFn,
	python: string,
	cwd: string,
	signal?: AbortSignal,
): Promise<{ communities: number }> {
	const result = await exec(
		`${python} -c "
import json, sys
from graphify.cluster import cluster, score_all
from graphify.report import generate
from graphify.export import to_json
from networkx.readwrite import json_graph
from pathlib import Path

data = json.loads(Path('graphify-out/graph.json').read_text())
import networkx as nx
G = json_graph.node_link_graph(data, edges='links')
communities = cluster(G)
to_json(G, communities, 'graphify-out/graph.json')
print(f'Re-clustered: {len(communities)} communities')
"`,
		{ cwd, signal },
	);

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
	const escapedPath = escapeShell(inputPath);

	let cmd = `${python} -m graphify extract '${escapedPath}'`;
	if (backend) cmd += ` --backend ${backend}`;
	if (maxWorkers) cmd += ` --max-workers ${maxWorkers}`;
	if (tokenBudget) cmd += ` --token-budget ${tokenBudget}`;
	if (maxConcurrency) cmd += ` --max-concurrency ${maxConcurrency}`;
	if (apiTimeout) cmd += ` --api-timeout ${apiTimeout}`;

	onUpdate?.(`Running headless extraction with backend: ${backend ?? "auto-detected"}...`);

	const result = await exec(cmd, { cwd, signal });

	if (result.exitCode !== 0) {
		throw new Error(`Extract failed: ${result.stderr || result.stdout}`);
	}

	onUpdate?.(result.stdout.trim());

	// Parse output to get token counts
	const inputMatch = result.stdout.match(/input_tokens[=:](\d+)/i);
	const outputMatch = result.stdout.match(/output_tokens[=:](\d+)/i);
	const filesMatch = result.stdout.match(/(\d+)\s+files?/i);
	const nodesMatch = result.stdout.match(/(\d+)\s+nodes?/i);
	const edgesMatch = result.stdout.match(/(\d+)\s+edges?/i);

	const extractedRaw = await exec(
		`${python} -c "import json; from pathlib import Path; p=Path('.graphify_extract.json'); print(p.read_text() if p.exists() else '{"nodes":[],"edges":[]}')"`,
		{ cwd, signal },
	);
	const extracted = JSON.parse(extractedRaw.stdout);

	return {
		files: filesMatch ? Number.parseInt(filesMatch[1], 10) : 0,
		inputTokens: inputMatch ? Number.parseInt(inputMatch[1], 10) : (extracted.input_tokens ?? 0),
		outputTokens: outputMatch
			? Number.parseInt(outputMatch[1], 10)
			: (extracted.output_tokens ?? 0),
		nodes: nodesMatch ? Number.parseInt(nodesMatch[1], 10) : (extracted.nodes?.length ?? 0),
		edges: edgesMatch ? Number.parseInt(edgesMatch[1], 10) : (extracted.edges?.length ?? 0),
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
	const escapedGraph = escapeShell(graphPath);
	const escapedOutput = escapeShell(outputPath);

	const result = await exec(
		`${python} -m graphify export callflow-html --graph '${escapedGraph}' --output '${escapedOutput}'`,
		{ cwd, signal },
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
	let cmd = `${python} -m graphify tree --graph '${escapeShell(graphPath)}' --output '${escapeShell(outputPath)}'`;
	if (options?.root) cmd += ` --root '${escapeShell(options.root)}'`;
	if (options?.label) cmd += ` --label '${escapeShell(options.label)}'`;

	const result = await exec(cmd, { cwd, signal });
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
	const result = await exec(`${python} -m graphify hook ${action}`, { cwd, signal });
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
		`NEO4J_URI='${escapeShell(uri)}' NEO4J_USER='${escapeShell(user)}' NEO4J_CREDS='${escapeShell(credentials)}' ${python} -c "
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
		{ cwd, signal },
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
	const q = escapeShell(options.question);
	const a = escapeShell(options.answer);
	const t = escapeShell(options.type);
	const nodes = options.nodes.map((n) => `'${escapeShell(n)}'`).join(" ");

	const result = await exec(
		`${python} -m graphify save-result --question '${q}' --answer '${a}' --type '${t}' --nodes ${nodes}`,
		{ cwd, signal },
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
	const result = await exec(`${python} -m graphify clone '${escapeShell(githubUrl)}'`, {
		cwd,
		signal,
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
	const graphArgs = graphs.map((g) => `'${escapeShell(g)}'`).join(" ");
	let cmd = `${python} -m graphify merge-graphs ${graphArgs}`;
	if (outPath) cmd += ` --out '${escapeShell(outPath)}'`;

	const result = await exec(cmd, { cwd, signal });
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

/** Check the currently installed and latest available version of graphifyy. */
export async function checkUpgrade(
	exec: ExecFn,
	signal?: AbortSignal,
): Promise<UpgradeCheckResult> {
	const installedResult = await exec(
		"graphify --version 2>/dev/null || uv tool list 2>/dev/null | grep graphifyy | awk '{print $2}'",
		{ signal },
	);
	const installedVersion = installedResult.stdout.trim().replace(/^v/, "");

	const latestResult = await exec(
		"uv tool upgrade graphifyy --dry-run 2>&1 | grep -oP 'upgraded from v?\\S+ to v?\\K\\S+' || echo ''",
		{ signal },
	);
	const latestLine = latestResult.stdout.trim();

	// If dry-run shows an upgrade, parse the target version. Otherwise latest = installed.
	let latestVersion = installedVersion;
	let updateAvailable = false;

	if (latestLine) {
		latestVersion = latestLine;
		updateAvailable = true;
	} else {
		// Fallback: check PyPI index
		const pypiResult = await exec(
			"uv pip index versions graphifyy 2>/dev/null | head -1 | grep -oP 'graphifyy v?\\K\\S+'",
			{ signal },
		);
		const pypiVersion = pypiResult.stdout.trim();
		if (pypiVersion && pypiVersion !== installedVersion) {
			latestVersion = pypiVersion;
			updateAvailable = true;
		}
	}

	return { installedVersion, latestVersion, updateAvailable };
}

/** Run uv tool upgrade graphifyy and return the result. */
export async function runUpgrade(exec: ExecFn, signal?: AbortSignal): Promise<UpgradeRunResult> {
	const before = await checkUpgrade(exec, signal);

	if (!before.updateAvailable) {
		return {
			previousVersion: before.installedVersion,
			newVersion: before.installedVersion,
			upgraded: false,
		};
	}

	const result = await exec("uv tool upgrade graphifyy 2>&1", { signal });
	if (result.exitCode !== 0) {
		throw new Error(`Upgrade failed: ${result.stderr || result.stdout}`);
	}

	const after = await exec(
		"graphify --version 2>/dev/null || uv tool list 2>/dev/null | grep graphifyy | awk '{print $2}'",
		{ signal },
	);
	const newVersion = after.stdout.trim().replace(/^v/, "");

	return {
		previousVersion: before.installedVersion,
		newVersion: newVersion || before.latestVersion,
		upgraded: true,
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

function escapeShell(str: string): string {
	return str.replace(/'/g, "'\\''");
}
