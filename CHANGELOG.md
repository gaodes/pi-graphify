# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.6] - 2026-05-20

### Fixed

- **OOM crash prevention**: Pi process (exit code 32102) crashed during graph operations due to unbounded child-process output accumulation in Node.js memory. All exec calls now cap stdout/stderr at 1 MiB by default, preventing multi-MB graph data from exhausting V8 heap.
- **Signal death handling**: Child process signal deaths (null exit code) now map to exit code 1 instead of 0, preventing silent success on crashes.
- **Large-graph update guard**: `graphify_update` now checks if `graph.json` exceeds 10 MiB before running the memory-heavy inline Python rebuild pipeline. Large graphs fall back to the `graphify update` CLI command directly.
- **Safe shell/Python quoting**: Replaced the incomplete `escapeShell()` function with `pythonLiteral()` (JSON.stringify) for Python inline strings and `shellQuote()` for shell arguments. Handles backslashes, newlines, and special characters correctly.
- **Bounded auto-context caches**: Tool-result augmentation caches (`augmentedCache`, `emptyCache`) now cap at 256 entries with LRU eviction, preventing unbounded Set growth in long sessions.
- **Shared bounded exec adapter**: Consolidated duplicated `createExec()` implementations into a single `createBoundedExec()` adapter with output size limits and signal-death handling.

### Changed

- Added `maxOutputBytes` to `ExecOptions` interface in runner.ts.
- Added output budget constants: `DEFAULT_EXEC_OUTPUT_BYTES` (1 MiB), `JSON_EXEC_OUTPUT_BYTES` (2 MiB), `QUERY_EXEC_OUTPUT_BYTES` (256 KiB), `LARGE_GRAPH_JSON_BYTES` (10 MiB).

## [0.1.5] - 2026-05-12

### Changed

- Updated README auto-context documentation to reflect v0.1.4 scope reduction.

## [0.1.4] - 2026-05-12

### Changed

- Auto-context tool-result augmentation now only targets `grep`, `ffgrep`, `find`, `fffind` (removed `bash` and `read`).
- Augmentation context reduced to a short hint line instead of the full GRAPH_REPORT.md excerpt.

## [0.1.3] - 2026-05-12

### Added

- `graphify_extract` tool: headless LLM extraction for CI with backend selection (claude, kimi, openai, gemini, ollama, bedrock). Supports `--max-workers`, `--token-budget`, `--api-timeout` for concurrency and cost control.
- `graphify_export_callflow` tool: generate self-contained Mermaid architecture/call-flow HTML from an existing graph.
- `/graphify extract <path>` command with autocomplete for `--backend`, `--max-workers`, `--token-budget`, `--api-timeout`.
- `/graphify uninstall` command with optional `--purge` to also delete `graphify-out/`.
- `--callflow` build flag to generate callflow HTML during a full build.
- `runExtract` and `exportCallflowHtml` runner functions.
- `graphify_upgrade` tool: check for and install graphifyy Python CLI updates via `uv`. Supports `check` (see current/latest versions) and `install` (upgrade) actions.
- `checkUpgrade` and `runUpgrade` runner functions.
- Pi-native Graphify auto-context hooks:
  - `before_agent_start` prompt injection when `<outputDir>/graph.json` exists
  - optional tool-result augmentation for `grep`, `ffgrep`, `find`, `fffind`, `read`, and `bash`
- Configurable `autoContext` settings under `pi-graphify` in `prime-settings.json`.
- New `src/tools/index.test.ts` coverage for Graphify auto-context hooks and output-dir detection.

### Changed

- Updated `.upstream.json` to track graphify v0.7.13 (was v0.7.5).
- `pi-graphify` session state now tracks graph presence, report injection, hook fires, augmentation hits, and per-session augmentation caches.

## [0.1.2] - 2026-05-09

### Changed

- Added `.pi/gateway/` to `.gitignore`.
- Clarified README configuration table formatting and `statusbar` option description.
- Synced tracked `graphify-out` artifacts after regeneration.

## [0.1.1] - 2026-05-09

### Added

- `graphify_watch` tool: watch a directory for file changes, auto-rebuild graph on code edits.
- `graphify_cluster` tool: re-run community detection on an existing graph without re-extraction.
- `/graphify watch <path>` command with autocomplete.
- `/graphify cluster` command.
- `/graphify hook <install|uninstall|status>` command to manage git hooks.
- Optional `pi-statusbar` widget integration with auto-refresh on session start and agent start.
- Runner functions for `watch`, `clusterOnly`, `hookAction`, `pushNeo4j`, `saveResult`, `cloneRepo`, `mergeGraphs`, `generateTree`.
- Unit tests for runner module (10 passing).
- Integration tests using @gaodes/pi-test-harness (12 passing): all 8 tools exercised via playbook DSL with mocked bash, plus command-level forwarding coverage.
- `@gaodes/pi-test-harness` as dev dependency.
- Bundled `graphify` skill: full-pipeline orchestration guide (semantic extraction, community labeling, export formats, video transcription, guided exploration). Replaces the standalone skill in `~/.pi/agent/skills/graphify/`.
- Config key standardized to `pi-graphify` with automatic migration from legacy `graphify`.

### Fixed

- npm package metadata now includes `publishConfig.access=public` plus GitHub `bugs`/`homepage` fields for clean scoped-package publishing.
- Added `@biomejs/biome` as a dev dependency so `npm run lint` works in clean environments.
- Relaxed local typecheck strictness that was pulling in `@gaodes/pi-utils-ui` source-level unused-variable diagnostics from `node_modules`.
- Graphify build initialization now auto-manages `.gitignore`: creates the file if missing, removes legacy `graphify-out/` ignore entries, and keeps only `graphify-out/cache/`, `graphify-out/.graphify_python`, and `graphify-out/cost.json` ignored so `graphify-out/` stays tracked.
- Lint script scoped to `src/` instead of `.`.
- Removed leaked `graphify-out/cache` from `src/`.
- Bundled `graphify` skill command snippets now use consistent temporary-file paths (`.graphify_python`, `.graphify_detect.json`, `.graphify_chunk_*.json`, `.graphify_semantic_new.json`).
- Corrected GraphML export snippet in bundled `graphify` skill.
- `/graphify` command now forwards build flags (`--mode deep`, `--no-viz`, `--obsidian`, `--svg`, `--graphml`, `--neo4j`) to `graphify_build` explicitly.
- Removed misleading `--watch` build-flag autocomplete (watching is via `/graphify watch <path>`).
- `--debounce <seconds>` is now parsed for `/graphify watch` and forwarded in the watch tool prompt.
- Added command integration tests to lock behavior for `/graphify` build-flag forwarding and watch debounce parsing.

## [0.1.0] - 2025-05-06

### Added

- Initial release: knowledge graph tools and `/graphify` command for Pi.
- Tools: `graphify_build`, `graphify_query`, `graphify_path`, `graphify_explain`, `graphify_add`, `graphify_update`, `graphify_watch`, `graphify_cluster`.
- Single `/graphify` command with autocomplete for subcommands and flags (build, query, path, explain, add, update, watch, cluster, hook).

[Unreleased]: https://gitlab.elches.dev/agents/primecodex/packages/pi-graphify/-/compare/v0.1.6...main
[0.1.6]: https://gitlab.elches.dev/agents/primecodex/packages/pi-graphify/-/compare/v0.1.5...v0.1.6
[0.1.5]: https://gitlab.elches.dev/agents/primecodex/packages/pi-graphify/-/compare/v0.1.4...v0.1.5
[0.1.4]: https://gitlab.elches.dev/agents/primecodex/packages/pi-graphify/-/compare/v0.1.3...v0.1.4
[0.1.3]: https://gitlab.elches.dev/agents/primecodex/packages/pi-graphify/-/compare/v0.1.2...v0.1.3
[0.1.2]: https://gitlab.elches.dev/agents/primecodex/packages/pi-graphify/-/compare/v0.1.1...v0.1.2
[0.1.1]: https://gitlab.elches.dev/agents/primecodex/packages/pi-graphify/-/compare/v0.1.0...v0.1.1
[0.1.0]: https://gitlab.elches.dev/agents/primecodex/packages/pi-graphify/-/tags/v0.1.0
