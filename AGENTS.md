# Pi Graphify

Pi extension wrapping the [graphify](https://github.com/safishamsi/graphify) Python CLI for knowledge graph generation and exploration.

## Architecture

- `src/config.ts` — Raw/resolved config loader
- `src/lib/runner.ts` — Graphify CLI execution logic (no Pi imports)
- `src/tools/` — LLM-callable tools (thin wrappers around runner)
  - `build.ts`, `query.ts`, `path.ts`, `explain.ts`, `add.ts`, `update.ts`
- `src/commands/` — `/graphify` slash command with autocomplete

## Deviation Notes

- No `enabled` toggle: extension is always active; graphify CLI is the gate (auto-installs on first use).
- Uses `pi.exec()` for all shell commands — no `child_process`.
- The runner module (`src/lib/runner.ts`) contains pure domain logic with no Pi imports for testability.

## Dependencies

- `@gaodes/pi-utils-ui` — TUI components (ToolCallHeader, ToolBody, ToolFooter)
- `graphifyy` (Python) — installed at runtime via pip/uv

## Config

Key: `graphify` in `prime-settings.json`
