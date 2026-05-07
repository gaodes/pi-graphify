import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const EXTENSION_ID = "graphify";
export const PRIME_SETTINGS_FILE = "prime-settings.json";

export interface RawConfig {
	enabled?: boolean;
	pythonPath?: string;
	outputDir?: string;
}

export interface ResolvedConfig {
	enabled: boolean;
	pythonPath: string;
	outputDir: string;
}

export const DEFAULT_CONFIG: ResolvedConfig = {
	enabled: true,
	pythonPath: "python3",
	outputDir: "graphify-out",
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
