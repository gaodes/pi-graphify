import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension from "./index";

const { mockEnsurePrimeSettings, mockLoadConfig, mockCreateAllTools } = vi.hoisted(() => ({
	mockEnsurePrimeSettings: vi.fn(),
	mockLoadConfig: vi.fn(),
	mockCreateAllTools: vi.fn(() => []),
}));

vi.mock("../config", () => ({
	ensurePrimeSettings: mockEnsurePrimeSettings,
	loadConfig: mockLoadConfig,
}));

vi.mock("./graphify-tools", () => ({
	createAllTools: mockCreateAllTools,
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

function createTempGraphProject(outputDir = "graphify-out") {
	const root = mkdtempSync(join(tmpdir(), "pi-graphify-test-"));
	const outDir = join(root, outputDir);
	mkdirSync(outDir, { recursive: true });
	writeFileSync(join(outDir, "graph.json"), "{}\n", "utf-8");
	writeFileSync(join(outDir, "GRAPH_REPORT.md"), "# Graph report\nImportant context\n", "utf-8");
	return { root, outDir };
}

function baseConfig(overrides: Record<string, unknown> = {}) {
	return {
		enabled: true,
		pythonPath: "python3",
		outputDir: "graphify-out",
		autoContext: {
			enabled: true,
			augmentSearchResults: true,
			includeReport: true,
			includeWiki: true,
			reportMaxChars: 500,
			queryBudget: 1200,
			sessionSummary: false,
			intentSuggestions: true,
			maxSessionAugments: 8,
			maxAugmentChars: 1200,
			minToolResultLines: 1,
			triggerTools: ["grep", "ffgrep", "find", "fffind", "read"],
			triggerPatterns: [],
			autoQuery: false,
		},
		...overrides,
	};
}

describe("tools/index auto-context hooks", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("injects Graphify system prompt when graph exists", async () => {
		const { root } = createTempGraphProject();
		mockLoadConfig.mockReturnValue(baseConfig());
		const { pi, handlers } = createPiStub();

		extension(pi as never);

		await handlers.get("session_start")?.({}, { cwd: root });
		const result = await handlers.get("before_agent_start")?.(
			{ systemPrompt: "base system prompt" },
			{ cwd: root },
		);

		expect(result).toBeDefined();
		expect((result as { systemPrompt: string }).systemPrompt).toContain("[Graphify active]");
		expect((result as { systemPrompt: string }).systemPrompt).toContain(
			"graphify-out/GRAPH_REPORT.md",
		);
	});

	it("does not inject system prompt when graph does not exist", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-graphify-test-empty-"));
		mockLoadConfig.mockReturnValue(baseConfig());
		const { pi, handlers } = createPiStub();

		extension(pi as never);

		await handlers.get("session_start")?.({}, { cwd: root });
		const result = await handlers.get("before_agent_start")?.(
			{ systemPrompt: "base system prompt" },
			{ cwd: root },
		);

		expect(result).toBeUndefined();
	});

	it("augments tool results once per cache key and respects disable flag", async () => {
		const { root } = createTempGraphProject();
		mockLoadConfig.mockReturnValue(baseConfig());
		const { pi, handlers } = createPiStub();
		extension(pi as never);

		await handlers.get("session_start")?.({}, { cwd: root });

		const multiLineText = Array.from({ length: 10 }, (_, i) => `match line ${i + 1}`).join("\n");

		const first = await handlers.get("tool_result")?.(
			{
				toolName: "grep",
				input: { pattern: "Main Module" },
				content: [{ type: "text", text: multiLineText }],
			},
			{ cwd: root },
		);
		expect(first).toBeDefined();
		expect((first as { content: Array<{ text?: string }> }).content[1]?.text).toContain(
			"[Graphify]",
		);

		const second = await handlers.get("tool_result")?.(
			{
				toolName: "grep",
				input: { pattern: "Main Module" },
				content: [{ type: "text", text: multiLineText }],
			},
			{ cwd: root },
		);
		expect(second).toBeUndefined();

		mockLoadConfig.mockReturnValue(
			baseConfig({
				autoContext: {
					enabled: true,
					augmentSearchResults: false,
					includeReport: true,
					includeWiki: true,
					reportMaxChars: 500,
					queryBudget: 1200,
					sessionSummary: false,
					intentSuggestions: true,
					maxSessionAugments: 8,
					maxAugmentChars: 1200,
					minToolResultLines: 1,
					triggerTools: ["grep", "ffgrep", "find", "fffind", "read"],
					triggerPatterns: [],
					autoQuery: false,
				},
			}),
		);
		const disabledSession = createPiStub();
		extension(disabledSession.pi as never);
		await disabledSession.handlers.get("session_start")?.({}, { cwd: root });
		const disabledResult = await disabledSession.handlers.get("tool_result")?.(
			{
				toolName: "grep",
				input: { pattern: "Main Module" },
				content: [{ type: "text", text: multiLineText }],
			},
			{ cwd: root },
		);
		expect(disabledResult).toBeUndefined();
	});

	it("does not augment bash tool results", async () => {
		const { root } = createTempGraphProject();
		mockLoadConfig.mockReturnValue(baseConfig());
		const { pi, handlers } = createPiStub();
		extension(pi as never);

		await handlers.get("session_start")?.({}, { cwd: root });

		const result = await handlers.get("tool_result")?.(
			{
				toolName: "bash",
				input: { command: "echo hi" },
				content: [{ type: "text", text: "output" }],
			},
			{ cwd: root },
		);
		expect(result).toBeUndefined();
	});

	it("respects configured outputDir for graph detection", async () => {
		const { root } = createTempGraphProject("custom-out");
		mockLoadConfig.mockReturnValue(baseConfig({ outputDir: "custom-out" }));
		const { pi, handlers } = createPiStub();
		extension(pi as never);

		await handlers.get("session_start")?.({}, { cwd: root });
		const result = await handlers.get("before_agent_start")?.(
			{ systemPrompt: "base system prompt" },
			{ cwd: root },
		);

		expect(result).toBeDefined();
		expect((result as { systemPrompt: string }).systemPrompt).toContain("custom-out/");
	});
});
