import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type ExecFn,
	type ExecOptions,
	type ExecResult,
	OUTPUT_LIMIT_EXIT_CODE,
} from "../lib/runner";

/**
 * Default maximum bytes captured from child stdout/stderr.
 * 1 MiB — enough for normal graphify output, prevents OOM from multi-MB graph dumps.
 */
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;

/**
 * Build a shell wrapper that captures stdout/stderr to temp files, checks
 * their sizes, and reads back bounded output. This prevents Pi's child
 * process handler from accumulating multi-MB strings in Node.js memory.
 *
 * The inner command is NOT tokenized — it runs inside a subshell `( ... )`.
 */
function buildBoundedShellCommand(
	command: string,
	maxOutputBytes: number,
): { shellCommand: string } {
	const stdoutFile = join(
		tmpdir(),
		`pi-graphify-stdout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	const stderrFile = join(
		tmpdir(),
		`pi-graphify-stderr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);

	// The wrapper:
	// 1. Runs the command in a subshell, redirecting to temp files
	// 2. Captures the exit code
	// 3. Checks stdout size — if over limit, truncates and sets exit code
	// 4. Prints the (possibly truncated) output
	// 5. Cleans up temp files
	const shellCommand = `__out="${stdoutFile}" __err="${stderrFile}"
( ${command} ) > "$__out" 2> "$__err"
__ec=$?
__sz=0
if [ -f "$__out" ]; then __sz=$(wc -c < "$__out"); fi
if [ "$__sz" -gt ${maxOutputBytes} ]; then
  echo "pi-graphify: command output exceeded maxOutputBytes (${maxOutputBytes} bytes)" >&2
  tail -c ${maxOutputBytes} "$__out"
  __ec=${OUTPUT_LIMIT_EXIT_CODE}
else
  cat "$__out"
fi
if [ -f "$__err" ]; then
  __esz=$(wc -c < "$__err")
  if [ "$__esz" -gt ${maxOutputBytes} ]; then
    tail -c ${maxOutputBytes} "$__err" >&2
  else
    cat "$__err" >&2
  fi
fi
rm -f "$__out" "$__err"
exit $__ec`;

	return { shellCommand };
}

/**
 * Create a bounded exec adapter that wraps pi.exec() with output size limits.
 *
 * - Maps null exit codes (signal deaths) to 1 instead of 0
 * - Caps stdout/stderr at maxOutputBytes (default 1 MiB)
 * - Returns exit code 125 when output is truncated
 */
export function createBoundedExec(pi: ExtensionAPI, cwd: string): ExecFn {
	return async (command, options?: ExecOptions): Promise<ExecResult> => {
		const maxBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
		const { shellCommand } = buildBoundedShellCommand(command, maxBytes);

		const result = await pi.exec("sh", ["-c", shellCommand], {
			cwd: options?.cwd ?? cwd,
			signal: options?.signal,
		});

		// Map null exit code (signal death) to 1
		const exitCode = result.code ?? 1;

		return {
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode,
		};
	};
}
