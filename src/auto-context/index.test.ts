import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerGraphifyAutoContext } from "./index";

const { mockLoadConfig } = vi.hoisted(() => ({
	mockLoadConfig: vi.fn(),
}));

vi.mock("../config", () => ({
	loadConfig: mockLoadConfig,
}));

type HookHandler = (event: unknown, ctx: { cwd: string }) => Promise<unknown>;

function createPiStub() {
	const handlers = new Map<string, HookHandler>();
	const pi = {
		registerTool: vi.fn(),
		on: vi.fn((event: string, handler: HookHandler) => {
			handlers.set(event, handler);
		}),
	};
	return { pi, handlers };
}

function createGraphProject(overrides: { reportContent?: string; wikiContent?: string } = {}) {
	const root = mkdtempSync(join(tmpdir(), "auto-ctx-phase2-"));
	const outDir = join(root, "graphify-out");
	mkdirSync(outDir, { recursive: true });
	writeFileSync(join(outDir, "graph.json"), '{"nodes":[]}', "utf-8");
	if (overrides.reportContent !== undefined) {
		writeFileSync(join(outDir, "GRAPH_REPORT.md"), overrides.reportContent, "utf-8");
	}
	if (overrides.wikiContent !== undefined) {
		mkdirSync(join(outDir, "wiki"), { recursive: true });
		writeFileSync(join(outDir, "wiki", "index.md"), overrides.wikiContent, "utf-8");
	}
	return root;
}

function fullAutoContext(overrides: Record<string, unknown> = {}) {
	return {
		enabled: true,
		augmentSearchResults: true,
		includeReport: true,
		includeWiki: true,
		reportMaxChars: 6000,
		queryBudget: 1200,
		sessionSummary: true,
		intentSuggestions: true,
		maxSessionAugments: 8,
		maxAugmentChars: 1200,
		minToolResultLines: 1,
		triggerTools: ["grep", "ffgrep", "find", "fffind", "read"],
		triggerPatterns: [],
		autoQuery: false,
		...overrides,
	};
}

function configWith(autoContextOverrides: Record<string, unknown> = {}) {
	return {
		enabled: true,
		pythonPath: "python3",
		outputDir: "graphify-out",
		semanticBackend: "deepseek",
		autoContext: fullAutoContext(autoContextOverrides),
	};
}

describe("auto-context/index session-start orientation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("injects session orientation with suggested queries when graph exists", async () => {
		const root = createGraphProject({
			reportContent: "# Communities\nCore and tools clusters.\n\n# Hooks\nLifecycle events.\n",
		});
		mockLoadConfig.mockReturnValue(configWith());
		const { pi, handlers } = createPiStub();

		registerGraphifyAutoContext(pi as never, mockLoadConfig());

		await handlers.get("session_start")?.({}, { cwd: root });
		const result = await handlers.get("before_agent_start")?.(
			{ systemPrompt: "base prompt" },
			{ cwd: root },
		);

		expect(result).toBeDefined();
		const prompt = (result as { systemPrompt: string }).systemPrompt;
		expect(prompt).toContain("[Graphify active]");
		expect(prompt).toContain("graphify_query");
		expect(prompt).toContain("graphify_explain");
		expect(prompt).toContain("Communities");
	});

	it("injects orientation without report when includeReport is false", async () => {
		const root = createGraphProject({
			reportContent: "# Communities\nShould not appear.\n",
		});
		mockLoadConfig.mockReturnValue(configWith({ includeReport: false }));
		const { pi, handlers } = createPiStub();

		registerGraphifyAutoContext(pi as never, mockLoadConfig());

		await handlers.get("session_start")?.({}, { cwd: root });
		const result = await handlers.get("before_agent_start")?.(
			{ systemPrompt: "base prompt" },
			{ cwd: root },
		);

		expect(result).toBeDefined();
		const prompt = (result as { systemPrompt: string }).systemPrompt;
		expect(prompt).not.toContain("Should not appear");
		expect(prompt).toContain("[Graphify active]");
	});

	it("falls back to basic prompt when sessionSummary is false", async () => {
		const root = createGraphProject({
			reportContent: "# Communities\nShould not appear in basic mode.\n",
		});
		mockLoadConfig.mockReturnValue(configWith({ sessionSummary: false }));
		const { pi, handlers } = createPiStub();

		registerGraphifyAutoContext(pi as never, mockLoadConfig());

		await handlers.get("session_start")?.({}, { cwd: root });
		const result = await handlers.get("before_agent_start")?.(
			{ systemPrompt: "base prompt" },
			{ cwd: root },
		);

		expect(result).toBeDefined();
		const prompt = (result as { systemPrompt: string }).systemPrompt;
		expect(prompt).toContain("[Graphify active]");
		expect(prompt).toContain("graphify-out/GRAPH_REPORT.md");
		// Basic prompt doesn't include suggested queries
		expect(prompt).not.toContain("Good follow-ups:");
	});

	it("does not inject when graph does not exist", async () => {
		const root = mkdtempSync(join(tmpdir(), "auto-ctx-no-graph-"));
		mockLoadConfig.mockReturnValue(configWith());
		const { pi, handlers } = createPiStub();

		registerGraphifyAutoContext(pi as never, mockLoadConfig());

		await handlers.get("session_start")?.({}, { cwd: root });
		const result = await handlers.get("before_agent_start")?.(
			{ systemPrompt: "base prompt" },
			{ cwd: root },
		);

		expect(result).toBeUndefined();
	});

	it("respects maxAugmentChars bound on orientation", async () => {
		const root = createGraphProject({
			reportContent: "# Section\n" + "A".repeat(2000) + "\n",
		});
		mockLoadConfig.mockReturnValue(configWith({ maxAugmentChars: 300 }));
		const { pi, handlers } = createPiStub();

		registerGraphifyAutoContext(pi as never, mockLoadConfig());

		await handlers.get("session_start")?.({}, { cwd: root });
		const result = await handlers.get("before_agent_start")?.(
			{ systemPrompt: "base prompt" },
			{ cwd: root },
		);

		expect(result).toBeDefined();
		const prompt = (result as { systemPrompt: string }).systemPrompt;
		// The orientation part should be bounded
		const orientationStart = prompt.indexOf("[Graphify active]");
		const orientationText = prompt.slice(orientationStart);
		expect(orientationText.length).toBeLessThanOrEqual(303); // 300 + "…"
	});

	it("injects orientation only once per session", async () => {
		const root = createGraphProject();
		mockLoadConfig.mockReturnValue(configWith());
		const { pi, handlers } = createPiStub();

		registerGraphifyAutoContext(pi as never, mockLoadConfig());

		await handlers.get("session_start")?.({}, { cwd: root });
		const first = await handlers.get("before_agent_start")?.(
			{ systemPrompt: "base prompt" },
			{ cwd: root },
		);
		const second = await handlers.get("before_agent_start")?.(
			{ systemPrompt: "base prompt" },
			{ cwd: root },
		);

		expect(first).toBeDefined();
		expect(second).toBeUndefined();
	});

	it("does not augment tool results when augmentSearchResults is false", async () => {
		const root = createGraphProject();
		mockLoadConfig.mockReturnValue(configWith({ augmentSearchResults: false }));
		const { pi, handlers } = createPiStub();

		registerGraphifyAutoContext(pi as never, mockLoadConfig());

		await handlers.get("session_start")?.({}, { cwd: root });

		const toolResult = await handlers.get("tool_result")?.(
			{
				toolName: "grep",
				input: { pattern: "architecture" },
				content: [{ type: "text", text: Array(20).fill("src/module.ts").join("\n") }],
			},
			{ cwd: root },
		);

		expect(toolResult).toBeUndefined();
	});

	it("clears caches on session_shutdown", async () => {
		const root = createGraphProject();
		mockLoadConfig.mockReturnValue(configWith());
		const { pi, handlers } = createPiStub();

		const reg = registerGraphifyAutoContext(pi as never, mockLoadConfig());

		await handlers.get("session_start")?.({}, { cwd: root });

		// Manually populate caches
		reg.graphContextState.augmentedCache.add("test:key");
		reg.graphContextState.emptyCache.add("test:empty");
		expect(reg.graphContextState.augmentedCache.size).toBe(1);
		expect(reg.graphContextState.emptyCache.size).toBe(1);

		await handlers.get("session_shutdown")?.({}, { cwd: root });

		expect(reg.graphContextState.augmentedCache.size).toBe(0);
		expect(reg.graphContextState.emptyCache.size).toBe(0);
	});

	it("includes wiki in orientation when includeWiki is true and wiki exists", async () => {
		const root = createGraphProject({ wikiContent: "# Project Wiki\nThis is the wiki intro.\n" });
		mockLoadConfig.mockReturnValue(configWith());
		const { pi, handlers } = createPiStub();

		registerGraphifyAutoContext(pi as never, mockLoadConfig());

		await handlers.get("session_start")?.({}, { cwd: root });
		const result = await handlers.get("before_agent_start")?.(
			{ systemPrompt: "base prompt" },
			{ cwd: root },
		);

		expect(result).toBeDefined();
		const prompt = (result as { systemPrompt: string }).systemPrompt;
		expect(prompt).toContain("Wiki");
		expect(prompt).toContain("wiki/index.md");
	});

	it("excludes wiki when includeWiki is false", async () => {
		const root = createGraphProject({ wikiContent: "# Wiki Content\nShould not appear.\n" });
		mockLoadConfig.mockReturnValue(configWith({ includeWiki: false }));
		const { pi, handlers } = createPiStub();

		registerGraphifyAutoContext(pi as never, mockLoadConfig());

		await handlers.get("session_start")?.({}, { cwd: root });
		const result = await handlers.get("before_agent_start")?.(
			{ systemPrompt: "base prompt" },
			{ cwd: root },
		);

		expect(result).toBeDefined();
		const prompt = (result as { systemPrompt: string }).systemPrompt;
		expect(prompt).not.toContain("Should not appear");
	});
});
