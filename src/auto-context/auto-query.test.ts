import { describe, expect, it, vi } from "vitest";
import { runAutoQuery } from "./auto-query";
import type { GraphifyIntent } from "./intent";

function makeIntent(overrides: Partial<GraphifyIntent> = {}): GraphifyIntent {
	return {
		kind: "broad-search",
		confidence: 0.8,
		reason: "Broad grep result",
		suggestedQuestion: "How do these files relate?",
		cacheKey: "grep:test",
		...overrides,
	};
}

function makeExec(result: { stdout?: string; stderr?: string; exitCode?: number }) {
	return vi.fn().mockResolvedValue({
		exitCode: result.exitCode ?? 0,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	});
}

describe("auto-context/auto-query", () => {
	it("returns undefined when intent has no suggested question", async () => {
		const exec = makeExec({ stdout: "result" });
		const intent = makeIntent({ suggestedQuestion: undefined });
		const result = await runAutoQuery(exec, "python3", "/tmp", intent, 1200, 500);
		expect(result).toBeUndefined();
		expect(exec).not.toHaveBeenCalled();
	});

	it("returns bounded query result on success", async () => {
		const exec = makeExec({ stdout: "Communities: core, tools, and hooks." });
		const intent = makeIntent();
		const result = await runAutoQuery(exec, "python3", "/tmp", intent, 1200, 500);
		expect(result).toBeDefined();
		expect(result).toContain("Communities");
	});

	it("truncates long results to maxChars", async () => {
		const exec = makeExec({ stdout: "A".repeat(1000) });
		const intent = makeIntent();
		const result = await runAutoQuery(exec, "python3", "/tmp", intent, 1200, 50);
		expect(result!.length).toBeLessThanOrEqual(51); // 50 + "…"
	});

	it("returns undefined when query fails", async () => {
		const exec = makeExec({ exitCode: 1, stderr: "error" });
		const intent = makeIntent();
		const result = await runAutoQuery(exec, "python3", "/tmp", intent, 1200, 500);
		expect(result).toBeUndefined();
	});

	it("returns undefined when result is empty", async () => {
		const exec = makeExec({ stdout: "   " });
		const intent = makeIntent();
		const result = await runAutoQuery(exec, "python3", "/tmp", intent, 1200, 500);
		expect(result).toBeUndefined();
	});

	it("returns undefined on abort signal", async () => {
		const exec = vi.fn().mockImplementation((_cmd: string, opts: { signal?: AbortSignal }) => {
			return new Promise((_resolve, reject) => {
				if (opts?.signal) {
					opts.signal.addEventListener("abort", () => {
						reject(new DOMException("Aborted", "AbortError"));
					});
				}
			});
		});
		const intent = makeIntent();
		const result = await runAutoQuery(exec, "python3", "/tmp", intent, 1200, 500);
		expect(result).toBeUndefined();
	}, 15000);

	it("swallows exceptions silently", async () => {
		const exec = vi.fn().mockRejectedValue(new Error("unexpected"));
		const intent = makeIntent();
		const result = await runAutoQuery(exec, "python3", "/tmp", intent, 1200, 500);
		expect(result).toBeUndefined();
	});
});
