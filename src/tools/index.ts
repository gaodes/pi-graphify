import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../config";
import { createAllTools } from "./graphify-tools";

export default function (pi: ExtensionAPI) {
	const config = loadConfig(process.cwd());
	if (!config.enabled) return;

	for (const tool of createAllTools(pi, config)) {
		pi.registerTool(tool);
	}
}
