# Pi Graphify

Pi extension wrapping the [graphify](https://github.com/safishamsi/graphify) Python CLI for knowledge graph generation and exploration.

## Architecture

- `src/config.ts` — Raw/resolved config loader
- `src/lib/runner.ts` — Graphify CLI execution logic (no Pi imports). All functions accept an injected `exec` callback for testability. Includes `getInstalledVersion`, `getLatestVersion`, `syncSkillFromUpstream`, `updateUpstreamVersion` for upgrade/skill-sync.
- `src/lib/runner.test.ts` — Unit tests for runner (20 passing)
- `src/tools/` — LLM-callable tools (thin wrappers around runner)
  - All tools in `graphify-tools.ts`: build, query, path, explain, add, update, watch, cluster, upgrade
  - Integration tests in `graphify.integration.test.ts` (10 passing)
- `src/commands/` — `/graphify` slash command with autocomplete for all subcommands
- `skills/graphify/` — Bundled skill synced from upstream `graphify/skill-pi.md` at the installed CLI version. Auto-synced on upgrade via `graphify_upgrade`, manual sync via `graphify_upgrade action='sync-skill'`.

## Tools (11)

| Tool                       | Description                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `graphify_build`           | Full pipeline: detect → extract → cluster → visualize                                                |
| `graphify_query`           | BFS/DFS graph traversal                                                                              |
| `graphify_path`            | Shortest path between two concepts                                                                   |
| `graphify_explain`         | Plain-language node explanation                                                                      |
| `graphify_add`             | Fetch URL and add to corpus                                                                          |
| `graphify_update`          | Incremental update (changed files only)                                                              |
| `graphify_watch`           | Watch directory for changes                                                                          |
| `graphify_cluster`         | Re-run clustering on existing graph                                                                  |
| `graphify_extract`         | Headless LLM extraction for CI (defaults to deepseek; also supports claude, kimi, openai, gemini, ollama, bedrock, claude-cli) |
| `graphify_export_callflow` | Generate self-contained Mermaid architecture/call-flow HTML                                          |
| `graphify_upgrade`         | Check for and install graphifyy CLI updates via uv                                                   |

## Commands

Subcommands: build, query, path, explain, add, update, watch, cluster, hook, extract, uninstall, upgrade

Build flags: `--mode deep`, `--no-viz`, `--obsidian`, `--svg`, `--graphml`, `--neo4j`, `--callflow`, `--update`, `--cluster-only`
Extract flags: `--backend <claude|kimi|openai|gemini|ollama|bedrock|claude-cli|deepseek>`, `--max-workers N`, `--max-concurrency N`, `--token-budget N`, `--api-timeout N`, `--resolution N`, `--exclude-hubs P`, `--exclude <pattern>`

## Runner Functions (not yet exposed as tools)

These are implemented in `runner.ts` but not yet wired as dedicated tools or command handlers:

- `pushNeo4j` — push graph to Neo4j instance
- `saveResult` — save Q&A feedback loop to graph memory
- `cloneRepo` — clone a GitHub repo for graphing
- `mergeGraphs` — merge multiple graph.json files
- `generateTree` — collapsible tree HTML visualization

## CLI Coverage Gaps

The following graphify CLI commands are **not** exposed as tools through the extension (available via the graphify skill or direct CLI):

- `graphify tree` — D3 collapsible tree HTML
- `graphify clone` — clone GitHub repos
- `graphify merge-graphs` — cross-repo graph merging
- `graphify check-update` — cron-safe update check
- `graphify save-result` — Q&A feedback loop
- `graphify global` — cross-project global graph
- IDE integrations (`claude install`, `cursor install`, etc.) — use `graphify pi install` instead

The `graphify extract` and `graphify export callflow-html` commands are now exposed as dedicated tools (`graphify_extract`, `graphify_export_callflow`) and `/graphify` subcommands.

## Deviation Notes

- No `enabled` toggle: extension is always active; graphify CLI is the gate (auto-installs on first use).
- Uses `pi.exec()` for all shell commands — no `child_process`.
- The runner module (`src/lib/runner.ts`) contains pure domain logic with no Pi imports for testability.

## Dependencies

- `@gaodes/pi-utils-ui` — TUI components (ToolCallHeader, ToolBody, ToolFooter)
- `graphifyy` (Python) — installed at runtime via pip/uv

## Config

Key: `pi-graphify` in `prime-settings.json` (legacy `graphify` key auto-migrates)

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **pi-graphify** (488 symbols, 732 relationships, 19 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/pi-graphify/context` | Codebase overview, check index freshness |
| `gitnexus://repo/pi-graphify/clusters` | All functional areas |
| `gitnexus://repo/pi-graphify/processes` | All execution flows |
| `gitnexus://repo/pi-graphify/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
