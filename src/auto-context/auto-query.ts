import type { ExecFn } from "../lib/runner";
import { queryGraph } from "../lib/runner";
import type { GraphifyIntent } from "./intent";

export interface AutoQueryResult {
	text: string;
	fromCache: boolean;
}

const AUTO_QUERY_TIMEOUT_MS = 8000;

/**
 * Run a bounded graphify query for auto-context augmentation.
 *
 * - Uses the existing queryGraph runner with a strict timeout.
 * - Catches and silences all errors (never fails the original tool result).
 * - Returns undefined if query fails, times out, or output is empty/noisy.
 */
export async function runAutoQuery(
	exec: ExecFn,
	pythonPath: string,
	cwd: string,
	intent: GraphifyIntent,
	budget: number,
	maxChars: number,
): Promise<string | undefined> {
	if (!intent.suggestedQuestion) return undefined;

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), AUTO_QUERY_TIMEOUT_MS);

		let result: string | undefined;
		try {
			result = await queryGraph(
				exec,
				pythonPath,
				cwd,
				{
					question: intent.suggestedQuestion,
					mode: "bfs",
					budget,
				},
				controller.signal,
			);
		} finally {
			clearTimeout(timeoutId);
		}

		if (!result || result.trim().length === 0) return undefined;

		// Truncate to maxChars
		return result.length > maxChars ? result.slice(0, maxChars) + "\u2026" : result;
	} catch {
		// Silently swallow errors \u2014 auto-query must never break the tool result
		return undefined;
	}
}
