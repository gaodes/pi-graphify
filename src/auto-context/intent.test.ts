import { describe, expect, it } from "vitest";
import {
	classifyGraphifyIntent,
	type GraphifyIntentKind,
} from "./intent";

function makeEvent(overrides: {
	toolName?: string;
	input?: Record<string, unknown>;
	content?: Array<{ type: string; text?: string }>;
}) {
	return {
		toolName: overrides.toolName ?? "grep",
		input: overrides.input,
		content: overrides.content ?? [{ type: "text", text: "result" }],
	};
}

function multiLineText(lines: number): string {
	return Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join("\n");
}

describe("auto-context/intent", () => {
	describe("classifyGraphifyIntent", () => {
		it("returns none for small single-line results", () => {
			const intent = classifyGraphifyIntent(
				makeEvent({
					toolName: "grep",
					input: { pattern: "test" },
					content: [{ type: "text", text: "single line" }],
				}),
				[],
			);
			expect(intent.kind).toBe("none");
		});

		it("returns broad-search for grep with many lines", () => {
			const intent = classifyGraphifyIntent(
				makeEvent({
					toolName: "grep",
					input: { pattern: "architecture" },
					content: [{ type: "text", text: multiLineText(10) }],
				}),
				[],
			);
			expect(intent.kind).toBe("broad-search");
			expect(intent.confidence).toBeGreaterThanOrEqual(0.8);
			expect(intent.suggestedQuestion).toBeDefined();
		});

		it("returns broad-search for find with many lines", () => {
			const intent = classifyGraphifyIntent(
				makeEvent({
					toolName: "find",
					input: { path: "src/" },
					content: [{ type: "text", text: multiLineText(8) }],
				}),
				[],
			);
			expect(intent.kind).toBe("broad-search");
		});

		it("returns overview-file for README.md read", () => {
			const intent = classifyGraphifyIntent(
				makeEvent({
					toolName: "read",
					input: { path: "/project/README.md" },
					content: [{ type: "text", text: "# README\nContent here" }],
				}),
				[],
			);
			expect(intent.kind).toBe("overview-file");
			expect(intent.confidence).toBeGreaterThanOrEqual(0.7);
		});

		it("returns overview-file for AGENTS.md read", () => {
			const intent = classifyGraphifyIntent(
				makeEvent({
					toolName: "read",
					input: { path: "/project/AGENTS.md" },
					content: [{ type: "text", text: "# Agents" }],
				}),
				[],
			);
			expect(intent.kind).toBe("overview-file");
		});

		it("returns overview-file for package.json read", () => {
			const intent = classifyGraphifyIntent(
				makeEvent({
					toolName: "read",
					input: { path: "/project/package.json" },
					content: [{ type: "text", text: '{"name":"test"}' }],
				}),
				[],
			);
			expect(intent.kind).toBe("overview-file");
		});

		it("returns none for ordinary source file read", () => {
			const intent = classifyGraphifyIntent(
				makeEvent({
					toolName: "read",
					input: { path: "/project/src/index.ts" },
					content: [{ type: "text", text: "export default {}" }],
				}),
				[],
			);
			expect(intent.kind).toBe("none");
		});

		it("returns docs-or-plan for docs directory read", () => {
			const intent = classifyGraphifyIntent(
				makeEvent({
					toolName: "read",
					input: { path: "/project/docs/api.md" },
					content: [{ type: "text", text: "# API Docs" }],
				}),
				[],
			);
			expect(intent.kind).toBe("docs-or-plan");
		});

		it("returns docs-or-plan for plans directory read", () => {
			const intent = classifyGraphifyIntent(
				makeEvent({
					toolName: "read",
					input: { path: "/project/plans/feature.md" },
					content: [{ type: "text", text: "# Plan" }],
				}),
				[],
			);
			expect(intent.kind).toBe("docs-or-plan");
		});

		it("returns architecture-question when input contains trigger term", () => {
			const intent = classifyGraphifyIntent(
				makeEvent({
					toolName: "bash",
					input: { command: "explain the architecture of this system" },
					content: [{ type: "text", text: "some output" }],
				}),
				["architecture"],
			);
			expect(intent.kind).toBe("architecture-question");
		});

		it("returns settings-or-surface when input mentions settings", () => {
			const intent = classifyGraphifyIntent(
				makeEvent({
					toolName: "grep",
					input: { pattern: "prime-settings.json" },
					content: [{ type: "text", text: "settings found" }],
				}),
				[],
			);
			expect(intent.kind).toBe("settings-or-surface");
		});

		it("returns multi-file-result for very large results", () => {
			const intent = classifyGraphifyIntent(
				makeEvent({
					toolName: "bash",
					input: { command: "ls" },
					content: [{ type: "text", text: multiLineText(25) }],
				}),
				[],
			);
			expect(intent.kind).toBe("multi-file-result");
		});

		it("returns none for bash with small output and no trigger terms", () => {
			const intent = classifyGraphifyIntent(
				makeEvent({
					toolName: "bash",
					input: { command: "echo hi" },
					content: [{ type: "text", text: "hi" }],
				}),
				[],
			);
			expect(intent.kind).toBe("none");
		});

		it("prioritizes broad-search over multi-file-result", () => {
			const intent = classifyGraphifyIntent(
				makeEvent({
					toolName: "grep",
					input: { pattern: "test" },
					content: [{ type: "text", text: multiLineText(30) }],
				}),
				[],
			);
			expect(intent.kind).toBe("broad-search");
		});
	});
});
