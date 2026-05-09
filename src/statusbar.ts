import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ResolvedConfig } from "./config.js";

const MODULE_ID = "pi-graphify";

// ── Config Interface ───────────────────────────────────────────────────────

export interface StatusbarConfig {
	enabled?: boolean;
	placement?: {
		line?: number; // 1-based line number
		side?: "left" | "right";
		index?: number; // Position within side (0 = first)
	};
	show_icon?: boolean;
	show_text?: boolean;
	icon?: string; // Hex code
	icon_color?: string; // "accent", "dim", "success", "warning", "error"
	icon_color_uninitialized?: string;
	text_font_color?: string;
	text_font_color_uninitialized?: string;
	separator_before?: { icon?: string; text?: string; icon_color?: string };
	separator_after?: { icon?: string; text?: string; icon_color?: string };
	auto_heal?: {
		enabled?: boolean;
		max_retries?: number;
		retry_interval_ms?: number;
	};
}

// ── State ──────────────────────────────────────────────────────────────────

export interface StatusbarState {
	consecutiveFailures: number;
	lastErrorAt: number;
	healedAt: number;
	isDegraded: boolean;
}

function makeStatusbarState(): StatusbarState {
	return { consecutiveFailures: 0, lastErrorAt: 0, healedAt: 0, isDegraded: false };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function emitStatusbarEvent(
	pi: ExtensionAPI,
	event: string,
	data: Record<string, unknown>,
): boolean {
	try {
		pi.events.emit(event, data);
		return true;
	} catch {
		return false;
	}
}

function getDefaultPlacement(): NonNullable<StatusbarConfig["placement"]> {
	return { line: 2, side: "left", index: 4 };
}

function resolveStatusbarConfig(config: ResolvedConfig): StatusbarConfig {
	const sb = config.statusbar ?? {};
	return {
		enabled: sb.enabled !== false,
		placement: { ...getDefaultPlacement(), ...sb.placement },
		show_icon: sb.show_icon !== false,
		show_text: sb.show_text !== false,
		icon: sb.icon ?? "f035b",
		icon_color: sb.icon_color ?? "accent",
		icon_color_uninitialized: sb.icon_color_uninitialized ?? "dim",
		text_font_color: sb.text_font_color ?? "dim",
		text_font_color_uninitialized: sb.text_font_color_uninitialized ?? "dim",
		separator_before: sb.separator_before,
		separator_after: sb.separator_after,
		auto_heal: {
			enabled: sb.auto_heal?.enabled !== false,
			max_retries: sb.auto_heal?.max_retries ?? 3,
			retry_interval_ms: sb.auto_heal?.retry_interval_ms ?? 5000,
		},
	};
}

function shouldAttemptUpdate(
	state: StatusbarState,
	autoHeal: StatusbarConfig["auto_heal"],
): boolean {
	if (!state.isDegraded) return true;
	if (!autoHeal?.enabled) return false;

	const now = Date.now();
	const retryInterval = autoHeal.retry_interval_ms ?? 5000;
	const maxRetries = autoHeal.max_retries ?? 3;

	if (state.consecutiveFailures >= maxRetries) {
		return now - state.lastErrorAt > retryInterval * 2;
	}

	return now - state.lastErrorAt > retryInterval;
}

// ── Public API ─────────────────────────────────────────────────────────────

export function registerGraphifyStatusbar(pi: ExtensionAPI, config: ResolvedConfig): void {
	const sbConfig = resolveStatusbarConfig(config);
	if (!sbConfig.enabled) return;

	const contributePayload: Record<string, unknown> = {
		id: MODULE_ID,
		label: "Graphify",
		description: "Knowledge graph status",
		default_placement: sbConfig.placement,
		default_style: {
			show_icon: sbConfig.show_icon,
			icon: sbConfig.icon,
			icon_color: sbConfig.icon_color,
			show_text: sbConfig.show_text,
			text_font_color: sbConfig.text_font_color,
			text_font_caps: "small",
			text_font_style: "regular",
		},
		priority: 0,
	};
	if (sbConfig.separator_before) contributePayload.separator_before = sbConfig.separator_before;
	if (sbConfig.separator_after) contributePayload.separator_after = sbConfig.separator_after;

	emitStatusbarEvent(pi, "statusbar:widget:contribute", contributePayload);

	emitStatusbarEvent(pi, "statusbar:module:register", {
		id: MODULE_ID,
		text: "initializing...",
		visible: true,
		placement: sbConfig.placement,
		style: {
			show_icon: sbConfig.show_icon,
			icon: sbConfig.icon,
			icon_color: sbConfig.icon_color,
			show_text: sbConfig.show_text,
			text_font_color: sbConfig.text_font_color,
			text_font_caps: "small",
			text_font_style: "regular",
		},
	});
}

export function unregisterGraphifyStatusbar(pi: ExtensionAPI): void {
	emitStatusbarEvent(pi, "statusbar:module:unregister", { id: MODULE_ID });
}

export async function updateGraphifyStatusbar(
	pi: ExtensionAPI,
	config: ResolvedConfig,
	ctx: ExtensionContext,
	state: StatusbarState,
): Promise<void> {
	const sbConfig = resolveStatusbarConfig(config);
	if (!sbConfig.enabled) return;
	if (!shouldAttemptUpdate(state, sbConfig.auto_heal)) return;

	try {
		const checkResult = await pi.exec(
			"sh",
			["-c", "test -f graphify-out/graph.json && echo 'yes' || echo 'no'"],
			{ cwd: ctx.cwd },
		);

		let text: string;
		let iconColor = sbConfig.icon_color ?? "accent";
		let textColor = sbConfig.text_font_color ?? "dim";

		if (checkResult.stdout.trim() === "yes") {
			const statsResult = await pi.exec(
				"sh",
				[
					"-c",
					`python3 -c "
import json
from pathlib import Path
try:
    data = json.loads(Path('graphify-out/graph.json').read_text())
    nodes = len(data.get('nodes', []))
    edges = len(data.get('links', []))
    print(f'{nodes}n {edges}e')
except Exception:
    print('graph ready')
" 2>/dev/null || echo "graph ready"`,
				],
				{ cwd: ctx.cwd },
			);
			text = statsResult.stdout.trim() || "graph ready";
		} else {
			text = "no graph";
			iconColor = sbConfig.icon_color_uninitialized ?? "dim";
			textColor = sbConfig.text_font_color_uninitialized ?? "dim";
		}

		emitStatusbarEvent(pi, "statusbar:module:register", {
			id: MODULE_ID,
			text,
			visible: true,
			placement: sbConfig.placement,
			style: {
				show_icon: sbConfig.show_icon,
				icon: sbConfig.icon,
				icon_color: iconColor,
				show_text: sbConfig.show_text,
				text_font_color: textColor,
				text_font_caps: "small",
				text_font_style: "regular",
			},
		});

		if (state.isDegraded) {
			state.healedAt = Date.now();
		}
		state.consecutiveFailures = 0;
		state.isDegraded = false;
	} catch (_error) {
		state.consecutiveFailures += 1;
		state.lastErrorAt = Date.now();
		state.isDegraded = true;

		emitStatusbarEvent(pi, "statusbar:module:register", {
			id: MODULE_ID,
			text: "error",
			visible: true,
			placement: sbConfig.placement,
			style: {
				show_icon: sbConfig.show_icon,
				icon: sbConfig.icon,
				icon_color: "error",
				show_text: sbConfig.show_text,
				text_font_color: "error",
				text_font_caps: "small",
				text_font_style: "regular",
			},
		});
	}
}

export { makeStatusbarState as createStatusbarState };
