import { describe, expect, it, vi } from "vitest";

// We test the buildBoundedShellCommand logic by importing the module
// and verifying the adapter's behavior through a mock pi.exec.

// ---------------------------------------------------------------------------
// Mock pi.exec helper
// ---------------------------------------------------------------------------

function createMockPiExec(
	handler: (
		command: string,
		args: string[],
		opts?: Record<string, unknown>,
	) => {
		stdout: string;
		stderr: string;
		code: number | null;
	},
) {
	return {
		exec: vi.fn(handler),
		registerTool: vi.fn(),
		on: vi.fn(),
		registerCommand: vi.fn(),
		sendUserMessage: vi.fn(),
	} as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("exec-adapter", () => {
	describe("createBoundedExec", () => {
		it("maps null exit code (signal death) to 1", async () => {
			const { createBoundedExec } = await import("./exec-adapter");
			const mockPi = createMockPiExec(() => ({
				stdout: "some output",
				stderr: "",
				code: null, // Signal death
			}));

			const exec = createBoundedExec(mockPi, "/tmp");
			const result = await exec("echo hello");

			expect(result.exitCode).toBe(1);
			expect(result.stdout).toBe("some output");
		});

		it("preserves non-null exit codes", async () => {
			const { createBoundedExec } = await import("./exec-adapter");
			const mockPi = createMockPiExec(() => ({
				stdout: "output",
				stderr: "error msg",
				code: 42,
			}));

			const exec = createBoundedExec(mockPi, "/tmp");
			const result = await exec("some-command");

			expect(result.exitCode).toBe(42);
		});

		it("wraps the command in a bounded shell script", async () => {
			const { createBoundedExec } = await import("./exec-adapter");
			let capturedCommand = "";
			let capturedArgs: string[] = [];

			const mockPi = createMockPiExec((_cmd, args) => {
				capturedCommand = _cmd;
				capturedArgs = args;
				return { stdout: "hello", stderr: "", code: 0 };
			});

			const exec = createBoundedExec(mockPi, "/tmp");
			await exec("echo hello");

			// Should call sh -c with the wrapper
			expect(capturedCommand).toBe("sh");
			expect(capturedArgs[0]).toBe("-c");
			// The wrapper should contain the original command in a subshell
			expect(capturedArgs[1]).toContain("( echo hello )");
			// Should contain the maxOutputBytes check
			expect(capturedArgs[1]).toContain("1048576");
		});

		it("respects custom maxOutputBytes from options", async () => {
			const { createBoundedExec } = await import("./exec-adapter");
			let capturedArgs: string[] = [];

			const mockPi = createMockPiExec((_cmd, args) => {
				capturedArgs = args;
				return { stdout: "", stderr: "", code: 0 };
			});

			const exec = createBoundedExec(mockPi, "/tmp");
			await exec("echo hello", { maxOutputBytes: 512 });

			// The wrapper should use the custom limit
			expect(capturedArgs[1]).toContain("512");
		});

		it("passes cwd from options to pi.exec", async () => {
			const { createBoundedExec } = await import("./exec-adapter");
			let capturedOpts: Record<string, unknown> = {};

			const mockPi = createMockPiExec((_cmd, _args, opts) => {
				capturedOpts = opts ?? {};
				return { stdout: "", stderr: "", code: 0 };
			});

			const exec = createBoundedExec(mockPi, "/default");
			await exec("echo hello", { cwd: "/custom" });

			expect(capturedOpts.cwd).toBe("/custom");
		});

		it("uses default cwd when no option is provided", async () => {
			const { createBoundedExec } = await import("./exec-adapter");
			let capturedOpts: Record<string, unknown> = {};

			const mockPi = createMockPiExec((_cmd, _args, opts) => {
				capturedOpts = opts ?? {};
				return { stdout: "", stderr: "", code: 0 };
			});

			const exec = createBoundedExec(mockPi, "/default");
			await exec("echo hello");

			expect(capturedOpts.cwd).toBe("/default");
		});
	});
});
