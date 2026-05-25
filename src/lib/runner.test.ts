import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	detectPython,
	ensureGraphifyGitignore,
	ensureInstalled,
	getInstalledVersion,
	getLatestVersion,
	syncSkillFromUpstream,
	updateUpstreamVersion,
} from "./runner";

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
// detectFiles — removed (now handled by graphify CLI)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ensureGraphifyGitignore
// ---------------------------------------------------------------------------

describe("ensureGraphifyGitignore", () => {
	it("creates .gitignore with graphify-out/ when missing", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-graphify-test-"));

		try {
			const result = await ensureGraphifyGitignore(dir);
			expect(result.updated).toBe(true);

			const content = await readFile(join(dir, ".gitignore"), "utf-8");
			expect(content).toContain("graphify-out/");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("removes legacy selective entries and replaces with graphify-out/", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-graphify-test-"));

		try {
			await writeFile(
				join(dir, ".gitignore"),
				"node_modules/\ngraphify-out/cache/\ngraphify-out/.graphify_python\ngraphify-out/.graphify_root\ngraphify-out/cost.json\ncustom-file.txt\n",
				"utf-8",
			);

			const result = await ensureGraphifyGitignore(dir);
			expect(result.updated).toBe(true);

			const content = await readFile(join(dir, ".gitignore"), "utf-8");
			expect(content).toContain("node_modules/");
			expect(content).toContain("custom-file.txt");
			expect(content).toContain("graphify-out/");
			expect(content).not.toContain("graphify-out/cache/");
			expect(content).not.toContain("graphify-out/.graphify_python");
			expect(content).not.toContain("graphify-out/.graphify_root");
			expect(content).not.toContain("graphify-out/cost.json");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("is idempotent when graphify-out/ already exists", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-graphify-test-"));

		try {
			const expected = "node_modules/\ngraphify-out/\n";
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

// ---------------------------------------------------------------------------
// syncSkillFromUpstream
// ---------------------------------------------------------------------------

describe("syncSkillFromUpstream", () => {
	it("writes skill file when fetched successfully", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-graphify-test-"));
		const skillDir = join(dir, "skills", "graphify");
		const { mkdir } = await import("node:fs/promises");
		await mkdir(skillDir, { recursive: true });

		try {
			const result = await syncSkillFromUpstream("0.8.14", dir);

			// This test hits the real GitHub URL — it may fail without network
			if (result.error) {
				console.warn(`Skipping: ${result.error}`);
				return;
			}

			expect(result.synced).toBe(true);
			expect(result.toVersion).toBe("0.8.14");

			const content = await readFile(join(skillDir, "SKILL.md"), "utf-8");
			expect(content).toContain("name: graphify");
			expect(content.length).toBeGreaterThan(1000);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("returns error on HTTP failure (bad version tag)", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-graphify-test-"));

		try {
			const result = await syncSkillFromUpstream("99.99.99", dir);

			expect(result.synced).toBe(false);
			expect(result.error).toBeDefined();
			expect(result.error).toContain("HTTP 404");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("skips write when content is identical", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-graphify-test-"));
		const skillDir = join(dir, "skills", "graphify");
		const { mkdir } = await import("node:fs/promises");
		await mkdir(skillDir, { recursive: true });

		try {
			// First sync to populate the file
			const first = await syncSkillFromUpstream("0.8.14", dir);
			if (first.error) {
				console.warn(`Skipping: ${first.error}`);
				return;
			}

			// Second sync should detect identical content
			const second = await syncSkillFromUpstream("0.8.14", dir);
			expect(second.synced).toBe(false);
			expect(second.error).toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// updateUpstreamVersion
// ---------------------------------------------------------------------------

describe("updateUpstreamVersion", () => {
	it("updates upstreamVersion in .upstream.json", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-graphify-test-"));

		try {
			const upstream = {
				version: 1,
				primary: {
					name: "graphify",
					upstreamVersion: "0.8.13",
					relationship: "inspiration",
				},
			};
			await writeFile(join(dir, ".upstream.json"), JSON.stringify(upstream, null, "\t"), "utf-8");

			await updateUpstreamVersion(dir, "0.8.16");

			const updated = JSON.parse(await readFile(join(dir, ".upstream.json"), "utf-8"));
			expect(updated.primary.upstreamVersion).toBe("0.8.16");
			// Other fields preserved
			expect(updated.primary.name).toBe("graphify");
			expect(updated.version).toBe(1);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("is a no-op when .upstream.json does not exist", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-graphify-test-"));

		try {
			// Should not throw
			await updateUpstreamVersion(dir, "0.8.16");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// getInstalledVersion / getLatestVersion
// ---------------------------------------------------------------------------

describe("getInstalledVersion", () => {
	it("extracts version from graphify --version output", async () => {
		const mockExec = createMockExec({
			"graphify --version": { stdout: "graphify 0.8.16\n", stderr: "", exitCode: 0 },
		});
		const version = await getInstalledVersion(mockExec);
		expect(version).toBe("0.8.16");
	});

	it("strips leading v from version", async () => {
		const mockExec = createMockExec({
			"graphify --version": { stdout: "v0.8.13\n", stderr: "", exitCode: 0 },
		});
		const version = await getInstalledVersion(mockExec);
		expect(version).toBe("0.8.13");
	});
});

describe("getLatestVersion", () => {
	it("extracts version from pip3 index versions output", async () => {
		const mockExec = createMockExec({
			"pip3 index versions graphifyy": {
				stdout: "0.8.16\n",
				stderr: "",
				exitCode: 0,
			},
		});
		const version = await getLatestVersion(mockExec);
		expect(version).toBe("0.8.16");
	});

	it("falls back to uv pip index if pip3 fails", async () => {
		const mockExec = (cmd: string) => {
			if (cmd.includes("pip3")) {
				return Promise.resolve({ stdout: "", stderr: "", exitCode: 1 });
			}
			return Promise.resolve({
				stdout: "0.8.15\n",
				stderr: "",
				exitCode: 0,
			});
		};
		const version = await getLatestVersion(mockExec);
		expect(version).toBe("0.8.15");
	});

	it("returns null when both methods fail", async () => {
		const mockExec = () => Promise.resolve({ stdout: "", stderr: "", exitCode: 1 });
		const version = await getLatestVersion(mockExec);
		expect(version).toBeNull();
	});
});
