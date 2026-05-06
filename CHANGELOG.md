# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `graphify_watch` tool: watch a directory for file changes, auto-rebuild graph on code edits.
- `graphify_cluster` tool: re-run community detection on an existing graph without re-extraction.
- `/graphify watch <path>` command with autocomplete.
- `/graphify cluster` command.
- `/graphify hook <install|uninstall|status>` command to manage git hooks.
- Runner functions for `watch`, `clusterOnly`, `hookAction`, `pushNeo4j`, `saveResult`, `cloneRepo`, `mergeGraphs`, `generateTree`.
- Unit tests for runner module (10 passing).
- Integration tests using @gaodes/pi-test-harness (12 passing): all 8 tools exercised via playbook DSL with mocked bash, plus command-level forwarding coverage.
- `@gaodes/pi-test-harness` as dev dependency.
- Bundled `graphify` skill: full-pipeline orchestration guide (semantic extraction, community labeling, export formats, video transcription, guided exploration). Replaces the standalone skill in `~/.pi/agent/skills/graphify/`.

### Fixed

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

[Unreleased]: https://gitlab.elches.dev/agents/primecodex/packages/pi-graphify/-/compare/v0.1.0...main
[0.1.0]: https://gitlab.elches.dev/agents/primecodex/packages/pi-graphify/-/tags/v0.1.0
