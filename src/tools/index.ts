import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensurePrimeSettings, loadConfig } from "../config";
import { registerGraphifyAutoContext } from "../auto-context";
import { createAllTools } from "./graphify-tools";

export default function (pi: ExtensionAPI) {
	ensurePrimeSettings();

	const config = loadConfig(process.cwd());
	if (!config.enabled) return;

	for (const tool of createAllTools(pi, config)) {
		pi.registerTool(tool);
	}

	registerGraphifyAutoContext(pi, config);
}
