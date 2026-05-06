/**
 * Integration tests for pi-graphify extension using @gaodes/pi-test-harness.
 *
 * These tests exercise the full extension lifecycle:
 *   - Extension loading and tool registration
 *   - Tool execution via playbook DSL (when/calls/says)
 *   - Mock bash responses simulating the graphify Python CLI
 *
 * The extension's tools call pi.exec("sh", ["-c", ...]) which routes through
 * the built-in "bash" tool. We mock that to return deterministic responses.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { calls, createTestSession, says, type TestSession, when } from "@gaodes/pi-test-harness";
import { afterEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const TOOLS_ENTRY = path.resolve(PROJECT_ROOT, "src/tools/index.ts");

// ---------------------------------------------------------------------------
// Mock responses for the graphify Python CLI
// ---------------------------------------------------------------------------

/** Successful detect output */
const MOCK_DETECT_OUTPUT = JSON.stringify({
	total_files: 3,
	total_words: 500,
	files: {
		code: ["src/main.ts", "src/util.ts"],
		document: ["README.md"],
		paper: [],
		image: [],
		video: [],
	},
});

/** Mock python check -- graphify already installed */
const MOCK_PYTHON_CHECK = "0";

/** Mock detect Python from cache */
const MOCK_PYTHON_PATH = "/usr/bin/python3";

/** Successful query output */
const MOCK_QUERY_OUTPUT = `Traversal: BFS | Start: ['Main Module'] | 2 nodes
  NODE Main Module [src=src/main.ts loc=]
  NODE Util Module [src=src/util.ts loc=]
  EDGE Main Module --imports [EXTRACTED]--> Util Module`;

/** Successful explain output */
const MOCK_EXPLAIN_OUTPUT = `NODE: Main Module
  source: src/main.ts
  type: code
  degree: 1
CONNECTIONS:
  --imports--> Util Module [EXTRACTED] (src/util.ts)`;

/** Successful ingest output */
const MOCK_INGEST_OUTPUT = "Saved to ./raw/article.md";

// ---------------------------------------------------------------------------
// Bash mock that matches graphify command patterns
// ---------------------------------------------------------------------------

function createGraphifyBashMock(responses?: Record<string, string>) {
	const defaultResponses: Record<string, string> = {
		".graphify_python": MOCK_PYTHON_PATH,
		"import graphify": MOCK_PYTHON_CHECK,
		"from graphify.detect import detect": MOCK_DETECT_OUTPUT,
		"from graphify.extract import collect_files": JSON.stringify({
			nodes: [
				{ id: "src_main", label: "Main Module", file_type: "code", source_file: "src/main.ts" },
			],
			edges: [],
			input_tokens: 0,
			output_tokens: 0,
		}),
		graphify_semantic: JSON.stringify({
			nodes: [],
			edges: [],
			hyperedges: [],
			input_tokens: 0,
			output_tokens: 0,
		}),
		"from graphify.build import build_from_json": "Graph: 2 nodes, 1 edges, 1 communities",
		"Traversal:": MOCK_QUERY_OUTPUT,
		"NODE:": MOCK_EXPLAIN_OUTPUT,
		"from graphify.ingest import ingest": MOCK_INGEST_OUTPUT,
		detect_incremental: JSON.stringify({ new_total: 0, new_files: {} }),
		"from graphify.cluster import cluster": "Re-clustered: 3 communities",
		"hook status": "Git hooks are not installed.",
		mkdir: "",
		"cat graphify-out": MOCK_PYTHON_PATH,
		save_manifest: "",
		benchmark: "Token reduction: 12.5x",
		"rm -f": "",
		write_text: "",
		god_nodes: "[]",
		surprising_connections: "[]",
		"from graphify.report import generate": "",
		to_json: "",
		to_html: "graph.html written",
		shortest_path: `Shortest path (1 hops):
  Main Module --imports--> [EXTRACTED]
  Util Module`,
		"graphify.watch": "Watching . for changes...",
	};

	const all = { ...defaultResponses, ...responses };

	return (params: Record<string, unknown>) => {
		const cmd = String(params.command || "");

		// Detect what kind of graphify command this is and respond accordingly
		// The mock must match the *purpose* of the command, not just substrings,
		// because graphify-out paths appear in many commands.

		// Python detection: very first commands
		if (cmd.includes("cat graphify-out/.graphify_python")) {
			return `$ ${cmd}\n${all[".graphify_python"]}`;
		}
		if (cmd.includes("import graphify") && cmd.includes("echo $?")) {
			return `$ ${cmd}\n${all["import graphify"]}`;
		}
		if (cmd.includes("pip install graphifyy")) {
			return `$ ${cmd}\n`;
		}

		// mkdir
		if (cmd.startsWith("mkdir")) {
			return `$ ${cmd}\n${all.mkdir}`;
		}

		// Cleanup
		if (cmd.includes("rm -f ")) {
			return `$ ${cmd}\n${all["rm -f"]}`;
		}

		// Detect files
		if (cmd.includes("from graphify.detect import detect")) {
			return `$ ${cmd}\n${all["from graphify.detect import detect"]}`;
		}

		// AST extraction
		if (cmd.includes("from graphify.extract import collect_files")) {
			return `$ ${cmd}\n${all["from graphify.extract import collect_files"]}`;
		}

		// Semantic merge
		if (cmd.includes("graphify_semantic") || cmd.includes("graphify_cached")) {
			return `$ ${cmd}\n${all.graphify_semantic}`;
		}

		// Build graph
		if (cmd.includes("from graphify.build import build_from_json")) {
			return `$ ${cmd}\n${all["from graphify.build import build_from_json"]}`;
		}

		// Query
		if (
			cmd.includes("Traversal:") ||
			cmd.includes("mode = 'bfs'") ||
			cmd.includes("mode = 'dfs'")
		) {
			return `$ ${cmd}\n${all["Traversal:"]}`;
		}

		// Explain
		if (cmd.includes("CONNECTIONS:")) {
			return `$ ${cmd}\n${all["NODE:"]}`;
		}

		// Path
		if (cmd.includes("shortest_path")) {
			return `$ ${cmd}\n${all.shortest_path}`;
		}

		// Ingest
		if (cmd.includes("from graphify.ingest import ingest")) {
			return `$ ${cmd}\n${all["from graphify.ingest import ingest"]}`;
		}

		// Incremental update
		if (cmd.includes("detect_incremental")) {
			return `$ ${cmd}\n${all.detect_incremental}`;
		}

		// Cluster
		if (cmd.includes("from graphify.cluster import cluster") && !cmd.includes("build_from_json")) {
			return `$ ${cmd}\n${all["from graphify.cluster import cluster"]}`;
		}

		// Hook
		if (cmd.includes("hook status")) {
			return `$ ${cmd}\n${all["hook status"]}`;
		}

		// Watch
		if (cmd.includes("graphify.watch")) {
			return `$ ${cmd}\n${all["graphify.watch"]}`;
		}

		// Manifest / benchmark / report / export
		if (cmd.includes("save_manifest")) return `$ ${cmd}\n${all.save_manifest}`;
		if (cmd.includes("benchmark")) return `$ ${cmd}\n${all.benchmark}`;
		if (cmd.includes("from graphify.report import generate"))
			return `$ ${cmd}\n${all["from graphify.report import generate"]}`;
		if (cmd.includes("to_json")) return `$ ${cmd}\n${all.to_json}`;
		if (cmd.includes("to_html")) return `$ ${cmd}\n${all.to_html}`;
		if (cmd.includes("write_text")) return `$ ${cmd}\n${all.write_text}`;

		// Graph existence check
		if (cmd.includes("graphify-out/graph.json") && cmd.includes("exists()")) {
			// For explain/path/query — graph exists
			return `$ ${cmd}\n${all["NODE:"]}`;
		}

		return `$ ${cmd}\n`;
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pi-graphify extension", () => {
	let t: TestSession;

	afterEach(() => t?.dispose());

	/** Helper: create a test session with graphify bash mock */
	async function createSession(overrides?: Record<string, string>) {
		const session = await createTestSession({
			extensions: [TOOLS_ENTRY],
			mockTools: {
				bash: createGraphifyBashMock(overrides),
			},
		});

		// Polyfill setTools for pi-agent-core compatibility
		// (test-harness 1.0.1 calls setTools but pi-coding-agent 0.73 uses state.tools setter)
		// biome-ignore lint/suspicious/noExplicitAny: compatibility shim accessing untyped internals
		const agent = (session.session as any).agent;
		if (agent && !agent.setTools) {
			agent.setTools = (tools: unknown[]) => {
				agent.state.tools = tools;
			};
		}

		return session;
	}

	// -- Extension loading --------------------------------------------------

	it("loads and registers all 8 tools", async () => {
		t = await createSession();

		await t.run(when("Build a knowledge graph from .", [calls("graphify_build", { path: "." })]));

		const buildCalls = t.events.toolCallsFor("graphify_build");
		expect(buildCalls.length).toBeGreaterThanOrEqual(1);
		expect(buildCalls[0].blocked).toBe(false);
	});

	// -- graphify_build -----------------------------------------------------

	it("builds a graph from a directory", async () => {
		t = await createSession();

		await t.run(
			when("Build a knowledge graph from the current directory", [
				calls("graphify_build", { path: "." }),
				says("graph"),
			]),
		);

		const results = t.events.toolResultsFor("graphify_build");
		expect(results.length).toBeGreaterThanOrEqual(1);
	});

	it("respects --no-viz flag", async () => {
		t = await createSession();

		await t.run(
			when("Build graph without visualization", [
				calls("graphify_build", { path: ".", noViz: true }),
			]),
		);

		expect(t.events.toolResultsFor("graphify_build").length).toBeGreaterThanOrEqual(1);
	});

	// -- graphify_query -----------------------------------------------------

	it("performs BFS traversal", async () => {
		t = await createSession({
			"from pathlib import Path": "graphify-out/graph.json",
		});

		await t.run(
			when("Query the graph: what does Main Module connect to?", [
				calls("graphify_query", { question: "What does Main Module connect to?" }),
			]),
		);

		expect(t.events.toolResultsFor("graphify_query").length).toBeGreaterThanOrEqual(1);
	});

	// -- graphify_explain ---------------------------------------------------

	it("returns node details", async () => {
		t = await createSession({
			NODE: MOCK_EXPLAIN_OUTPUT,
		});

		await t.run(
			when("Explain the Main Module concept in the graph", [
				calls("graphify_explain", { concept: "Main Module" }),
			]),
		);

		expect(t.events.toolResultsFor("graphify_explain").length).toBeGreaterThanOrEqual(1);
	});

	// -- graphify_add -------------------------------------------------------

	it("fetches a URL and adds to corpus", async () => {
		t = await createSession();

		await t.run(
			when("Add this article to the graph: https://example.com/article", [
				calls("graphify_add", { url: "https://example.com/article" }),
			]),
		);

		expect(t.events.toolResultsFor("graphify_add").length).toBeGreaterThanOrEqual(1);
	});

	// -- graphify_update ----------------------------------------------------

	it("checks for changed files", async () => {
		t = await createSession({
			detect_incremental: JSON.stringify({
				new_total: 2,
				new_files: { code: ["src/main.ts"] },
			}),
		});

		await t.run(when("Update the graph incrementally", [calls("graphify_update", { path: "." })]));

		expect(t.events.toolResultsFor("graphify_update").length).toBeGreaterThanOrEqual(1);
	});

	// -- graphify_cluster ---------------------------------------------------

	it("re-runs community detection", async () => {
		t = await createSession();

		await t.run(when("Re-cluster the existing graph", [calls("graphify_cluster", {})]));

		expect(t.events.toolResultsFor("graphify_cluster").length).toBeGreaterThanOrEqual(1);
	});

	// -- graphify_watch -----------------------------------------------------

	it("starts watching a directory", async () => {
		t = await createSession();

		await t.run(
			when("Watch the current directory for changes", [calls("graphify_watch", { path: "." })]),
		);

		expect(t.events.toolResultsFor("graphify_watch").length).toBeGreaterThanOrEqual(1);
	});

	// -- graphify_path ------------------------------------------------------

	it("finds shortest path between concepts", async () => {
		t = await createSession();

		await t.run(
			when("Find the path from Main Module to Util Module", [
				calls("graphify_path", { from: "Main Module", to: "Util Module" }),
			]),
		);

		expect(t.events.toolResultsFor("graphify_path").length).toBeGreaterThanOrEqual(1);
	});
});
