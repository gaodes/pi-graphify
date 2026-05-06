import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { detectFiles, detectPython, ensureGraphifyGitignore, ensureInstalled } from "./runner";

// ---------------------------------------------------------------------------
// Mock exec function
// ---------------------------------------------------------------------------

function createMockExec(
	responses: Record<string, { stdout: string; stderr: string; exitCode: number }>,
) {
	return vi.fn(async (cmd: string, _opts?: unknown) => {
		for (const [pattern, response] of Object.entries(responses)) {
			if (cmd.includes(pattern)) return response;
		}
		return { stdout: "", stderr: "unknown command", exitCode: 1 };
	});
}

// ---------------------------------------------------------------------------
// detectPython
// ---------------------------------------------------------------------------

describe("detectPython", () => {
	it("returns cached python from graphify-out/.graphify_python", async () => {
		const mockExec = createMockExec({
			"cat graphify-out/.graphify_python": {
				stdout: "/usr/bin/python3\n",
				stderr: "",
				exitCode: 0,
			},
		});

		const result = await detectPython(mockExec, "python3", "/tmp/test");
		expect(result).toBe("/usr/bin/python3");
	});

	it("detects python from graphify shebang when no cache", async () => {
		const mockExec = createMockExec({
			"cat graphify-out": { stdout: "", stderr: "", exitCode: 1 },
			"which graphify": { stdout: "/usr/local/bin/graphify\n", stderr: "", exitCode: 0 },
			"head -1": { stdout: "#!/usr/local/bin/python3.11\n", stderr: "", exitCode: 0 },
		});

		const result = await detectPython(mockExec, "python3", "/tmp/test");
		expect(result).toBe("/usr/local/bin/python3.11");
	});

	it("falls back to config python when graphify not found", async () => {
		const mockExec = createMockExec({
			"cat graphify-out": { stdout: "", stderr: "", exitCode: 1 },
			"which graphify": { stdout: "", stderr: "", exitCode: 1 },
		});

		const result = await detectPython(mockExec, "python3.12", "/tmp/test");
		expect(result).toBe("python3.12");
	});
});

// ---------------------------------------------------------------------------
// ensureInstalled
// ---------------------------------------------------------------------------

describe("ensureInstalled", () => {
	it("skips install when graphify is importable", async () => {
		const mockExec = vi.fn(async (cmd: string, _opts?: unknown) => {
			// All calls return success
			if (cmd.includes("import graphify")) {
				return { stdout: "0", stderr: "", exitCode: 0 };
			}
			return { stdout: "", stderr: "", exitCode: 0 };
		});

		await ensureInstalled(mockExec, "python3", "/tmp/test");
		// Only called once (the initial check), no pip install
		expect(mockExec).toHaveBeenCalledTimes(1);
		expect(mockExec).not.toHaveBeenCalledWith(
			expect.stringContaining("pip install"),
			expect.anything(),
		);
	});

	it("installs graphifyy when not importable", async () => {
		let callIdx = 0;
		const mockExec = vi.fn(async (cmd: string, _opts?: unknown) => {
			callIdx++;
			// First call: check import → fails
			if (callIdx === 1 && cmd.includes("import graphify")) {
				return { stdout: "1", stderr: "", exitCode: 0 };
			}
			// Second call: pip install → succeeds
			if (cmd.includes("pip install")) {
				return { stdout: "", stderr: "", exitCode: 0 };
			}
			// Third call: verify → succeeds
			if (callIdx === 3 && cmd.includes("import graphify")) {
				return { stdout: "0", stderr: "", exitCode: 0 };
			}
			return { stdout: "", stderr: "", exitCode: 0 };
		});

		await ensureInstalled(mockExec, "python3", "/tmp/test");
		expect(mockExec).toHaveBeenCalledWith(
			expect.stringContaining("pip install graphifyy"),
			expect.anything(),
		);
	});
});

// ---------------------------------------------------------------------------
// detectFiles
// ---------------------------------------------------------------------------

describe("detectFiles", () => {
	it("parses detection output correctly", async () => {
		const detectionResult = {
			total_files: 5,
			total_words: 1200,
			files: {
				code: ["/tmp/test/main.ts", "/tmp/test/util.ts"],
				document: ["/tmp/test/README.md"],
				paper: [],
				image: [],
				video: [],
			},
		};

		const mockExec = createMockExec({
			"from graphify.detect import detect": {
				stdout: JSON.stringify(detectionResult),
				stderr: "",
				exitCode: 0,
			},
		});

		const result = await detectFiles(mockExec, "python3", "/tmp/test", "/tmp/test");
		expect(result.total_files).toBe(5);
		expect(result.total_words).toBe(1200);
		expect(result.files.code).toHaveLength(2);
		expect(result.files.document).toHaveLength(1);
	});

	it("throws on detection failure", async () => {
		const mockExec = createMockExec({
			"from graphify.detect import detect": {
				stdout: "",
				stderr: "ModuleNotFoundError: No module named 'graphify'",
				exitCode: 1,
			},
		});

		await expect(detectFiles(mockExec, "python3", "/tmp/test", "/tmp/test")).rejects.toThrow(
			"graphify detect failed",
		);
	});
});

// ---------------------------------------------------------------------------
// ensureGraphifyGitignore
// ---------------------------------------------------------------------------

describe("ensureGraphifyGitignore", () => {
	it("creates .gitignore with graphify cache exclusions when missing", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-graphify-test-"));

		try {
			const result = await ensureGraphifyGitignore(dir);
			expect(result.updated).toBe(true);

			const content = await readFile(join(dir, ".gitignore"), "utf-8");
			expect(content).toContain("graphify-out/cache/");
			expect(content).toContain("graphify-out/.graphify_python");
			expect(content).toContain("graphify-out/.graphify_root");
			expect(content).toContain("graphify-out/cost.json");
			expect(content).not.toContain("graphify-out/\n");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("removes legacy graphify-out/ ignore and preserves other entries", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-graphify-test-"));

		try {
			await writeFile(
				join(dir, ".gitignore"),
				"node_modules/\ngraphify-out/\ncustom-file.txt\n",
				"utf-8",
			);

			const result = await ensureGraphifyGitignore(dir);
			expect(result.updated).toBe(true);

			const content = await readFile(join(dir, ".gitignore"), "utf-8");
			expect(content).toContain("node_modules/");
			expect(content).toContain("custom-file.txt");
			expect(content).toContain("graphify-out/cache/");
			expect(content).toContain("graphify-out/.graphify_python");
			expect(content).toContain("graphify-out/.graphify_root");
			expect(content).toContain("graphify-out/cost.json");
			expect(content).not.toContain("\ngraphify-out/\n");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("is idempotent when required entries already exist", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-graphify-test-"));

		try {
			const expected =
				"node_modules/\ngraphify-out/cache/\ngraphify-out/.graphify_python\ngraphify-out/.graphify_root\ngraphify-out/cost.json\n";
			await writeFile(join(dir, ".gitignore"), expected, "utf-8");

			const result = await ensureGraphifyGitignore(dir);
			expect(result.updated).toBe(false);

			const content = await readFile(join(dir, ".gitignore"), "utf-8");
			expect(content).toBe(expected);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
