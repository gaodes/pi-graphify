import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensurePrimeSettings, loadConfig } from "../config";
import {
	createStatusbarState,
	registerGraphifyStatusbar,
	type StatusbarState,
	unregisterGraphifyStatusbar,
	updateGraphifyStatusbar,
} from "../statusbar.js";
import { createAllTools } from "./graphify-tools";

type ToolsExtensionState = {
	statusbarState: StatusbarState;
};

function createToolsExtensionState(): ToolsExtensionState {
	return {
		statusbarState: createStatusbarState(),
	};
}

export default function (pi: ExtensionAPI) {
	ensurePrimeSettings();

	const config = loadConfig(process.cwd());
	if (!config.enabled) return;

	for (const tool of createAllTools(pi, config)) {
		pi.registerTool(tool);
	}

	const state = createToolsExtensionState();

	pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
		registerGraphifyStatusbar(pi, config);
		await updateGraphifyStatusbar(pi, config, ctx, state.statusbarState);
	});

	pi.on("before_agent_start", async (_event: unknown, ctx: ExtensionContext) => {
		await updateGraphifyStatusbar(pi, config, ctx, state.statusbarState);
	});

	pi.on("session_shutdown", async () => {
		unregisterGraphifyStatusbar(pi);
	});
}
