import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const EXTENSION_ID = "pi-graphify";
export const PRIME_SETTINGS_FILE = "prime-settings.json";

export interface AutoContextConfig {
	enabled?: boolean;
	augmentSearchResults?: boolean;
	includeReport?: boolean;
	includeWiki?: boolean;
	reportMaxChars?: number;
	queryBudget?: number;
}

export interface ResolvedAutoContextConfig {
	enabled: boolean;
	augmentSearchResults: boolean;
	includeReport: boolean;
	includeWiki: boolean;
	reportMaxChars: number;
	queryBudget: number;
}

export type SemanticBackend =
	| "deepseek"
	| "openai"
	| "claude"
	| "kimi"
	| "gemini"
	| "ollama"
	| "bedrock"
	| "claude-cli";

export interface RawConfig {
	enabled?: boolean;
	pythonPath?: string;
	outputDir?: string;
	semanticBackend?: SemanticBackend;
	autoContext?: AutoContextConfig;
}

export interface ResolvedConfig {
	enabled: boolean;
	pythonPath: string;
	outputDir: string;
	semanticBackend: SemanticBackend;
	autoContext: ResolvedAutoContextConfig;
}

export const DEFAULT_AUTO_CONTEXT_CONFIG: ResolvedAutoContextConfig = {
	enabled: true,
	augmentSearchResults: true,
	includeReport: true,
	includeWiki: true,
	reportMaxChars: 6000,
	queryBudget: 1200,
};

export const DEFAULT_CONFIG: ResolvedConfig = {
	enabled: true,
	pythonPath: "python3",
	outputDir: "graphify-out",
	semanticBackend: "deepseek",
	autoContext: DEFAULT_AUTO_CONTEXT_CONFIG,
};

function readJsonFile(path: string): Record<string, unknown> | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function sanitizePositiveInt(value: number | undefined, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	const rounded = Math.floor(value);
	return rounded > 0 ? rounded : fallback;
}

function resolveAutoContext(raw: AutoContextConfig | undefined): ResolvedAutoContextConfig {
	return {
		enabled: raw?.enabled ?? DEFAULT_AUTO_CONTEXT_CONFIG.enabled,
		augmentSearchResults:
			raw?.augmentSearchResults ?? DEFAULT_AUTO_CONTEXT_CONFIG.augmentSearchResults,
		includeReport: raw?.includeReport ?? DEFAULT_AUTO_CONTEXT_CONFIG.includeReport,
		includeWiki: raw?.includeWiki ?? DEFAULT_AUTO_CONTEXT_CONFIG.includeWiki,
		reportMaxChars: sanitizePositiveInt(
			raw?.reportMaxChars,
			DEFAULT_AUTO_CONTEXT_CONFIG.reportMaxChars,
		),
		queryBudget: sanitizePositiveInt(raw?.queryBudget, DEFAULT_AUTO_CONTEXT_CONFIG.queryBudget),
	};
}

function resolveSemanticBackend(value: unknown): SemanticBackend {
	const allowed: SemanticBackend[] = [
		"deepseek",
		"openai",
		"claude",
		"kimi",
		"gemini",
		"ollama",
		"bedrock",
		"claude-cli",
	];
	if (typeof value === "string" && allowed.includes(value as SemanticBackend)) {
		return value as SemanticBackend;
	}
	return DEFAULT_CONFIG.semanticBackend;
}

export function resolveConfig(...configs: Array<RawConfig | undefined>): ResolvedConfig {
	const resolved: ResolvedConfig = {
		...DEFAULT_CONFIG,
		autoContext: { ...DEFAULT_AUTO_CONTEXT_CONFIG },
	};
	for (const raw of configs) {
		if (!raw) continue;
		if (raw.enabled !== undefined) resolved.enabled = raw.enabled;
		if (raw.pythonPath !== undefined) resolved.pythonPath = raw.pythonPath;
		if (raw.outputDir !== undefined) resolved.outputDir = raw.outputDir;
		if (raw.semanticBackend !== undefined) {
			resolved.semanticBackend = resolveSemanticBackend(raw.semanticBackend);
		}
		if (raw.autoContext !== undefined) {
			resolved.autoContext = resolveAutoContext({ ...resolved.autoContext, ...raw.autoContext });
		}
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

const DEFAULT_EXTENSION_SETTINGS: Record<string, unknown> = {
	enabled: true,
	pythonPath: "python3",
	outputDir: "graphify-out",
	semanticBackend: "deepseek",
	autoContext: DEFAULT_AUTO_CONTEXT_CONFIG,
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

	const extensionSettings = settings[EXTENSION_ID] as Record<string, unknown>;

	if (!("semanticBackend" in extensionSettings)) {
		extensionSettings.semanticBackend = "deepseek";
		changed = true;
	} else {
		extensionSettings.semanticBackend = resolveSemanticBackend(extensionSettings.semanticBackend);
	}

	if (!("autoContext" in extensionSettings)) {
		extensionSettings.autoContext = { ...DEFAULT_AUTO_CONTEXT_CONFIG };
		changed = true;
	} else if (
		typeof extensionSettings.autoContext !== "object" ||
		extensionSettings.autoContext === null
	) {
		extensionSettings.autoContext = { ...DEFAULT_AUTO_CONTEXT_CONFIG };
		changed = true;
	} else {
		const autoContext = extensionSettings.autoContext as Record<string, unknown>;
		const needsExpansion = Object.keys(DEFAULT_AUTO_CONTEXT_CONFIG).some(
			(key) => !(key in autoContext),
		);
		if (needsExpansion) {
			extensionSettings.autoContext = { ...DEFAULT_AUTO_CONTEXT_CONFIG, ...autoContext };
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
