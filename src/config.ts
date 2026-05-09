import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { StatusbarConfig } from "./statusbar.js";

export const EXTENSION_ID = "pi-graphify";
export const PRIME_SETTINGS_FILE = "prime-settings.json";

export interface RawConfig {
	enabled?: boolean;
	pythonPath?: string;
	outputDir?: string;
	statusbar?: StatusbarConfig;
}

export interface ResolvedConfig {
	enabled: boolean;
	pythonPath: string;
	outputDir: string;
	statusbar?: StatusbarConfig;
}

export const DEFAULT_CONFIG: ResolvedConfig = {
	enabled: true,
	pythonPath: "python3",
	outputDir: "graphify-out",
	statusbar: {
		enabled: true,
		icon: "f035b",
		icon_color: "accent",
		icon_color_uninitialized: "dim",
		text_font_color: "dim",
		text_font_color_uninitialized: "dim",
		show_icon: true,
		show_text: true,
		placement: { line: 2, side: "left", index: 4 },
		separator_before: { icon: "eb8a", icon_color: "dim" },
		separator_after: { icon: "eb8a", icon_color: "dim" },
	},
};

function readJsonFile(path: string): Record<string, unknown> | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

export function resolveConfig(...configs: Array<RawConfig | undefined>): ResolvedConfig {
	const resolved: ResolvedConfig = { ...DEFAULT_CONFIG };
	for (const raw of configs) {
		if (!raw) continue;
		if (raw.enabled !== undefined) resolved.enabled = raw.enabled;
		if (raw.pythonPath !== undefined) resolved.pythonPath = raw.pythonPath;
		if (raw.outputDir !== undefined) resolved.outputDir = raw.outputDir;
		if (raw.statusbar !== undefined) resolved.statusbar = raw.statusbar;
	}
	return resolved;
}

export function loadConfig(cwd: string): ResolvedConfig {
	const globalPath = join(getAgentDir(), PRIME_SETTINGS_FILE);
	const projectPath = join(cwd, ".pi", PRIME_SETTINGS_FILE);
	const globalSettings = existsSync(globalPath) ? readJsonFile(globalPath) : undefined;
	const projectSettings = existsSync(projectPath) ? readJsonFile(projectPath) : undefined;

	return resolveConfig(
		globalSettings?.[EXTENSION_ID] as RawConfig | undefined,
		projectSettings?.[EXTENSION_ID] as RawConfig | undefined,
	);
}

// ---------------------------------------------------------------------------
// Auto-seed defaults into global prime-settings.json
// ---------------------------------------------------------------------------

const DEFAULT_STATUSBAR_CONFIG: StatusbarConfig = {
	enabled: true,
	icon: "f035b",
	icon_color: "accent",
	icon_color_uninitialized: "dim",
	text_font_color: "dim",
	text_font_color_uninitialized: "dim",
	show_icon: true,
	show_text: true,
	placement: { line: 2, side: "left", index: 4 },
	separator_before: { icon: "eb8a", icon_color: "dim" },
	separator_after: { icon: "eb8a", icon_color: "dim" },
};

const DEFAULT_EXTENSION_SETTINGS: Record<string, unknown> = {
	enabled: true,
	pythonPath: "python3",
	outputDir: "graphify-out",
	statusbar: DEFAULT_STATUSBAR_CONFIG,
};

/**
 * Ensure the extension's config exists in prime-settings.json.
 *
 * - If the key "pi-graphify" is missing, seeds full defaults.
 * - If only the legacy key "graphify" exists, migrates it to "pi-graphify".
 * - Expands a minimal statusbar config to the full config.
 * - Only writes when changes are actually needed.
 */
export function ensurePrimeSettings(): void {
	const agentDir = getAgentDir();
	const primeSettingsPath = join(agentDir, PRIME_SETTINGS_FILE);

	// Only operate when prime-settings.json already exists (real Pi install)
	if (!existsSync(primeSettingsPath)) return;

	let settings: Record<string, unknown>;
	try {
		settings = JSON.parse(readFileSync(primeSettingsPath, "utf-8")) as Record<string, unknown>;
	} catch {
		return;
	}

	let changed = false;

	// Migrate legacy "graphify" key → "pi-graphify"
	if ("graphify" in settings && !(EXTENSION_ID in settings)) {
		settings[EXTENSION_ID] = settings.graphify;
		delete settings.graphify;
		changed = true;
	}

	// Seed defaults if key is missing
	if (!(EXTENSION_ID in settings)) {
		settings[EXTENSION_ID] = { ...DEFAULT_EXTENSION_SETTINGS };
		changed = true;
	}

	// Seed or expand statusbar sub-key inside existing pi-graphify config
	const extensionSettings = settings[EXTENSION_ID] as Record<string, unknown>;
	if (!("statusbar" in extensionSettings)) {
		extensionSettings.statusbar = { ...DEFAULT_STATUSBAR_CONFIG };
		changed = true;
	} else {
		const sb = extensionSettings.statusbar as Record<string, unknown>;
		// Expand a minimal statusbar config to the full config
		const needsExpansion =
			!("icon" in sb) &&
			!("placement" in sb) &&
			!("separator_before" in sb) &&
			!("separator_after" in sb);
		if (needsExpansion) {
			extensionSettings.statusbar = { ...DEFAULT_STATUSBAR_CONFIG, ...sb };
			changed = true;
		}
	}

	if (!changed) return;

	try {
		writeFileSync(primeSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
	} catch (error) {
		console.warn("Failed to write prime-settings.json:", error);
	}
}
