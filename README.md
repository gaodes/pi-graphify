# @gaodes/pi-graphify

Turn any folder of files (code, docs, papers, images, video) into a queryable knowledge graph with community detection, an honest audit trail, and three outputs: interactive HTML, GraphRAG-ready JSON, and a plain-language GRAPH_REPORT.md.

[**Source**](https://gitlab.elches.dev/agents/primecodex/extensions/pi-graphify) · [**npm**](https://www.npmjs.com/package/@gaodes/pi-graphify)

Inspired by [graphify](https://github.com/safishamsi/graphify) — the AI coding assistant skill. This extension wraps graphify's Python CLI for native Pi integration.

## Tools

| Tool | Description |
| --- | --- |
| `graphify_build` | Build a knowledge graph from a directory (full pipeline: detect → extract → cluster → visualize) |
| `graphify_query` | Query the graph — BFS for broad context, DFS for tracing specific paths |
| `graphify_path` | Find the shortest path between two concepts in the graph |
| `graphify_explain` | Plain-language explanation of a node — everything connected to it |
| `graphify_add` | Fetch a URL and add it to the corpus, then update the graph |
| `graphify_update` | Incremental update — re-extract only changed files |

## Commands

| Command | Description |
| --- | --- |
| `/graphify` | Single entry point with autocomplete for all subcommands and flags |

### Subcommands and flags

```
/graphify <path>                              # build graph (full pipeline)
/graphify <path> --mode deep                  # thorough extraction, richer INFERRED edges
/graphify <path> --update                     # incremental — re-extract only changed files
/graphify <path> --cluster-only               # rerun clustering on existing graph
/graphify <path> --no-viz                     # skip visualization, just report + JSON
/graphify <path> --obsidian                   # generate Obsidian vault
/graphify <path> --svg                        # export graph.svg
/graphify <path> --graphml                    # export for Gephi / yEd
/graphify <path> --neo4j                      # generate cypher.txt for Neo4j
/graphify <path> --watch                      # watch folder, auto-rebuild on changes

/graphify query "<question>"                  # BFS traversal — broad context
/graphify query "<question>" --dfs            # DFS — trace a specific path
/graphify query "<question>" --budget 1500    # cap answer at N tokens
/graphify path "ConceptA" "ConceptB"          # shortest path between two concepts
/graphify explain "ConceptName"               # plain-language explanation of a node
/graphify add <url>                           # fetch URL, save to ./raw, update graph
/graphify add <url> --author "Name"           # tag who wrote it
```

## Prerequisites

- Python 3.10+
- `graphifyy` package (auto-installed on first run): `pip install graphifyy` or `uv tool install graphifyy`

## Install

```bash
pi install @gaodes/pi-graphify
```

## Configuration

Key: `graphify` in `prime-settings.json`.

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | Enable/disable the extension |
| `pythonPath` | `string` | `"python3"` | Path to Python interpreter |
| `outputDir` | `string` | `"graphify-out"` | Output directory name |

## Source

- Canonical: `~/agents/primecodex/extensions/pi-graphify/`
- GitLab: `agents/primecodex/extensions/pi-graphify`
- GitHub: `github.com/gaodes/pi-graphify`
