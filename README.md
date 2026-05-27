# @gaodes/pi-graphify

Turn any folder of files (code, docs, papers, images, video) into a queryable knowledge graph with community detection, an honest audit trail, and three outputs: interactive HTML, GraphRAG-ready JSON, and a plain-language GRAPH_REPORT.md.

[**Source**](https://gitlab.elches.dev/agents/primecodex/packages/pi-graphify) · [**npm**](https://www.npmjs.com/package/@gaodes/pi-graphify)

Inspired by [graphify](https://github.com/safishamsi/graphify) — the AI coding assistant skill. This extension wraps graphify's Python CLI for native Pi integration.

It also bundles a `graphify` skill (`skills/graphify/SKILL.md`) for full-pipeline orchestration. Use `/skill:graphify` when you want the guided multi-step workflow; use the tools and `/graphify` command for fast operational calls.

## Tools

| Tool                       | Description                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `graphify_build`           | Build a knowledge graph from a directory (full pipeline: detect → extract → cluster → visualize)                               |
| `graphify_query`           | Query the graph — BFS for broad context, DFS for tracing specific paths                                                        |
| `graphify_path`            | Find the shortest path between two concepts in the graph                                                                       |
| `graphify_explain`         | Plain-language explanation of a node — everything connected to it                                                              |
| `graphify_add`             | Fetch a URL and add it to the corpus, then update the graph                                                                    |
| `graphify_update`          | Incremental update — re-extract only changed files                                                                             |
| `graphify_watch`           | Watch a directory for changes, auto-rebuild graph on code edits                                                                |
| `graphify_cluster`         | Re-run community detection on an existing graph (no re-extraction)                                                             |
| `graphify_extract`         | Headless LLM extraction for CI — defaults to deepseek; also supports claude, kimi, openai, gemini, ollama, bedrock, claude-cli |
| `graphify_export_callflow` | Generate self-contained Mermaid architecture/call-flow HTML from graph.json                                                    |
| `graphify_upgrade`         | Check for and install graphifyy CLI updates via uv                                                                             |

## Commands

| Command     | Description                                                        |
| ----------- | ------------------------------------------------------------------ |
| `/graphify` | Single entry point with autocomplete for all subcommands and flags |

### Subcommands and flags

```
/graphify <path>                              # build graph (full pipeline, semantic backend defaults to deepseek)
/graphify <path> --mode deep                  # thorough extraction, richer INFERRED edges
/graphify <path> --update                     # incremental — re-extract only changed files
/graphify <path> --cluster-only               # rerun clustering on existing graph
/graphify <path> --no-viz                     # skip visualization, just report + JSON
/graphify <path> --obsidian                   # generate Obsidian vault
/graphify <path> --svg                        # export graph.svg
/graphify <path> --graphml                    # export for Gephi / yEd
/graphify <path> --neo4j                      # generate cypher.txt for Neo4j
/graphify <path> --callflow                   # generate callflow architecture HTML

/graphify query "<question>"                  # BFS traversal — broad context
/graphify query "<question>" --dfs            # DFS — trace a specific path
/graphify query "<question>" --budget 1500    # cap answer at N tokens
/graphify path "ConceptA" "ConceptB"          # shortest path between two concepts
/graphify explain "ConceptName"               # plain-language explanation of a node
/graphify add <url>                           # fetch URL, save to ./raw, update graph
/graphify add <url> --author "Name"           # tag who wrote it
/graphify update <path>                       # incremental update
/graphify watch <path>                        # watch folder, auto-rebuild on changes
/graphify cluster                             # rerun clustering on existing graph
/graphify hook install                        # install git hooks for auto-rebuild
/graphify hook uninstall                      # remove git hooks
/graphify hook status                         # check hook status
/graphify extract <path>                      # headless LLM extraction for CI
/graphify extract <path> --backend claude     # specify LLM backend
/graphify extract <path> --backend kimi       # Kimi AI backend
/graphify extract <path> --backend openai     # OpenAI backend
/graphify extract <path> --backend gemini     # Google Gemini backend
/graphify extract <path> --backend ollama     # Ollama (local) backend
/graphify extract <path> --backend bedrock    # AWS Bedrock backend
/graphify extract <path> --max-workers 4      # limit parallel workers
/graphify extract <path> --token-budget 4096  # cap tokens per LLM call
/graphify extract <path> --api-timeout 300    # HTTP timeout in seconds
/graphify extract <path> --backend deepseek   # DeepSeek backend (default)
/graphify extract <path> --backend claude-cli  # route through Claude Code CLI
/graphify extract <path> --resolution 2.0      # Leiden clustering resolution
/graphify extract <path> --exclude-hubs 0.05   # exclude top-P% hub nodes
/graphify extract <path> --exclude '*.min.js'  # runtime exclusion patterns
/graphify upgrade                            # check for graphifyy CLI updates
/graphify upgrade --install                  # install latest graphifyy version
/graphify uninstall                           # remove graphify from all platforms
/graphify uninstall --purge                   # also delete graphify-out/
```

## Prerequisites

- Python 3.10+
- `graphifyy` package (auto-installed on first run): `pip install graphifyy` or `uv tool install graphifyy`

## Install

```bash
pi install @gaodes/pi-graphify
```

## Configuration

Key: `pi-graphify` in `prime-settings.json` (legacy `graphify` key auto-migrates on load).

| Setting                                    | Type       | Default           | Description                                                        |
| ------------------------------------------ | ---------- | ----------------- | ------------------------------------------------------------------ |
| `enabled`                                  | `boolean`  | `true`            | Enable/disable the extension                                       |
| `pythonPath`                               | `string`   | `"python3"`       | Path to Python interpreter                                         |
| `outputDir`                                | `string`   | `"graphify-out"`  | Output directory name                                              |
| `semanticBackend`                          | `string`   | `"deepseek"`      | Default semantic extraction backend for builds/extracts            |
| `autoContext.enabled`                      | `boolean`  | `true`            | Enable Graphify auto-context hooks                                 |
| `autoContext.sessionSummary`               | `boolean`  | `true`            | Inject architecture orientation at session start                   |
| `autoContext.augmentSearchResults`         | `boolean`  | `true`            | Enable Graphify augmentation of tool results (hints + intent-aware suggestions)                       |
| `autoContext.intentSuggestions`            | `boolean`  | `true`            | Generate intent-aware suggested queries in tool-result hints       |
| `autoContext.autoQuery`                    | `boolean`  | `false`           | Run actual graphify queries on high-confidence intents (off by default) |
| `autoContext.includeReport`                | `boolean`  | `true`            | Include GRAPH_REPORT.md content in session orientation             |
| `autoContext.includeWiki`                  | `boolean`  | `true`            | Include wiki/index.md in session orientation                       |
| `autoContext.reportMaxChars`               | `number`   | `6000`            | Max characters read from report/wiki files                         |
| `autoContext.queryBudget`                  | `number`   | `1200`            | Budget hint for `graphify_query` follow-up usage                   |
| `autoContext.maxSessionAugments`           | `number`   | `8`               | Max tool-result augmentations per session                          |
| `autoContext.maxAugmentChars`              | `number`   | `1200`            | Hard bound on appended context characters                          |
| `autoContext.minToolResultLines`           | `number`   | `8`               | Minimum lines in tool result to trigger augmentation               |
| `autoContext.triggerTools`                 | `string[]` | (see defaults)    | Tool names that trigger augmentation                               |
| `autoContext.triggerPatterns`              | `string[]` | (see defaults)    | Input patterns that trigger architecture-level hints               |

### Auto-context behavior

When `graphify-out/graph.json` exists in the current project, pi-graphify provides **architecture-level** context to the agent. This complements GitNexus (which provides symbol-level call-graph intelligence).

- **Session orientation** — injects a concise `[Graphify active]` prompt with suggested queries and report summary when `sessionSummary` is enabled
- **Intent-aware tool hints** — classifies tool results by intent (broad search, high-value file reads, architecture terms) and appends relevant Graphify suggestions
- **Optional auto-query** — when `autoQuery` is enabled, runs bounded `graphify query` on high-confidence intents (disabled by default to avoid cost/noise)
- **Session budgets** — enforces max augmentations per session and hard character limits
- **Deduplication** — caches augmented and empty results to avoid repeated noise

### Settings profiles

**Quiet** — session hint only:
```json
{ "pi-graphify": { "autoContext": { "sessionSummary": true, "augmentSearchResults": false, "autoQuery": false } } }
```

**Balanced** (default) — architecture hints without auto-query:
```json
{ "pi-graphify": { "autoContext": { "sessionSummary": true, "intentSuggestions": true, "augmentSearchResults": true, "autoQuery": false, "maxSessionAugments": 8 } } }
```

**Proactive** — auto-query on high-confidence intents:
```json
{ "pi-graphify": { "autoContext": { "sessionSummary": true, "intentSuggestions": true, "augmentSearchResults": true, "autoQuery": true, "maxSessionAugments": 12, "maxAugmentChars": 1800 } } }
```

### Graphify vs GitNexus

| Aspect          | Graphify                                   | GitNexus                                  |
| --------------- | ------------------------------------------ | ----------------------------------------- |
| Scope           | Architecture, concepts, communities, docs  | Symbols, call graphs, execution flows     |
| Best for        | "What is this system made of?"             | "What calls this, and what breaks?"       |
| Augmentation    | Session orientation + intent-aware hints   | Pre-commit impact analysis + code context |
| Trigger         | Broad search, overview files, architecture | Code edits, symbol lookups                |
| Query tools     | `graphify_query`, `graphify_explain`       | `gitnexus_query`, `gitnexus_impact`       |

Use Graphify when exploring system shape and cross-cutting concepts. Use GitNexus when tracing code paths and assessing change impact.

- This is Pi-native behavior in this extension; the Graphify skill is installed by `graphify install --platform pi` to the global Pi skills directory (`~/.pi/agent/skills/graphify/SKILL.md`). Auto-reinstalled on upgrade via `graphify_upgrade`.
- Auto-context hooks stay idle in projects where `<outputDir>/graph.json` is missing.

## Git tracking policy

The extension's `.gitignore` ignores the entire `graphify-out/` directory. Graph output is regenerated on each build and should not be committed to the repository.

If you want to track graph output for documentation purposes, override in your project's `.gitignore`:

```
!graphify-out/
!graphify-out/graph.json
```

> **Note:** Earlier versions of pi-graphify tracked `graphify-out/` files and selectively ignored cache/temp entries. As of v0.1.6, the entire directory is ignored for cleaner repository state.

## Reliability

All child-process invocations run through a **bounded exec adapter** that caps stdout/stderr at 1 MiB by default. This prevents V8 heap exhaustion when graph operations produce multi-MB output — the root cause of the exit-code 32102 (OOM) crash in earlier versions.

Key safety features:

- **Output budgets**: 256 KiB for queries, 1 MiB for general operations, 2 MiB for JSON parsing
- **Thin CLI layer**: all graph operations delegate directly to the `graphify` CLI, avoiding inline Python script overhead and ensuring automatic upstream compatibility
- **Signal-death handling**: child processes killed by signals are reported as failures (exit code 1), not silent successes
- **LRU cache bounding**: auto-context augmentation caches cap at 256 entries

## Source

- Canonical: `~/agents/primecodex/packages/pi-graphify/`
- GitLab: `agents/primecodex/packages/pi-graphify`
- GitHub: `github.com/gaodes/pi-graphify`
