import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestSession, says, type TestSession, when } from "@gaodes/pi-test-harness";
import { afterEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const COMMANDS_ENTRY = path.resolve(PROJECT_ROOT, "src/commands/index.ts");

function createBashMock() {
	return (params: Record<string, unknown>) => {
		const cmd = String(params.command ?? "");
		if (cmd.includes("cat graphify-out/.graphify_python")) {
			return `$ ${cmd}\n/usr/bin/python3`;
		}
		if (cmd.includes("import graphify") && cmd.includes("echo $?")) {
			return `$ ${cmd}\n0`;
		}
		return `$ ${cmd}\n`;
	};
}

function textOfContent(content: unknown): string {
	if (!Array.isArray(content)) return String(content ?? "");
	return content
		.map((c) => (typeof c === "object" && c !== null && "text" in c ? String(c.text ?? "") : ""))
		.join("");
}

describe("/graphify command integration", () => {
	let t: TestSession;

	afterEach(() => t?.dispose());

	async function createSession() {
		const session = await createTestSession({
			extensions: [COMMANDS_ENTRY],
			mockTools: {
				bash: createBashMock(),
			},
		});

		// Polyfill setTools for pi-agent-core compatibility
		// biome-ignore lint/suspicious/noExplicitAny: compatibility shim accessing untyped internals
		const agent = (session.session as any).agent;
		if (agent && !agent.setTools) {
			agent.setTools = (tools: unknown[]) => {
				agent.state.tools = tools;
			};
		}

		return session;
	}

	it("forwards build flags into graphify_build params contract", async () => {
		t = await createSession();

		await t.run(
			when("/graphify . --mode deep --no-viz --obsidian --svg --graphml --neo4j", [says("ok")]),
		);

		const userMessages = t.events.messages.filter((m) => m.role === "user");
		expect(userMessages.length).toBeGreaterThan(0);

		const promptText = textOfContent(userMessages[0].content);
		expect(promptText).toContain("Use the graphify_build tool with these exact params");
		expect(promptText).toContain('"path":"."');
		expect(promptText).toContain('"mode":"deep"');
		expect(promptText).toContain('"no_viz":true');
		expect(promptText).toContain('"obsidian":true');
		expect(promptText).toContain('"svg":true');
		expect(promptText).toContain('"graphml":true');
		expect(promptText).toContain('"neo4j":true');
	});

	it("parses --debounce for watch subcommand", async () => {
		t = await createSession();

		await t.run(when("/graphify watch . --debounce 7", [says("ok")]));

		const userMessages = t.events.messages.filter((m) => m.role === "user");
		expect(userMessages.length).toBeGreaterThan(0);

		const promptText = textOfContent(userMessages[0].content);
		expect(promptText).toContain("Use the graphify_watch tool");
		expect(promptText).toContain('watch "." for changes with debounce 7s');
	});
});
