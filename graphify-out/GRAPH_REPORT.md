# Graph Report - pi-graphify  (2026-05-12)

## Corpus Check
- 15 files · ~22,708 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 280 nodes · 483 edges · 13 communities (12 shown, 1 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `18a0b731`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]

## God Nodes (most connected - your core abstractions)
1. `escapeShell()` - 16 edges
2. `createAllTools()` - 15 edges
3. `detectPython()` - 14 edges
4. `ensureInstalled()` - 14 edges
5. `handler()` - 14 edges
6. `Full pipeline → follow these steps` - 11 edges
7. `updateGraph()` - 9 edges
8. `createExec()` - 9 edges
9. `Pi Graphify` - 9 edges
10. `/graphify` - 9 edges

## Surprising Connections (you probably didn't know these)
- `handleBuild()` --calls--> `updateGraph()`  [INFERRED]
  src/commands/index.ts → src/lib/runner.ts
- `handleBuild()` --calls--> `detectPython()`  [INFERRED]
  src/commands/index.ts → src/lib/runner.ts
- `handleQuery()` --calls--> `detectPython()`  [INFERRED]
  src/commands/index.ts → src/lib/runner.ts
- `handlePath()` --calls--> `detectPython()`  [INFERRED]
  src/commands/index.ts → src/lib/runner.ts
- `handleExplain()` --calls--> `detectPython()`  [INFERRED]
  src/commands/index.ts → src/lib/runner.ts

## Communities (13 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (41): AutoContextConfig, DEFAULT_AUTO_CONTEXT_CONFIG, DEFAULT_CONFIG, DEFAULT_EXTENSION_SETTINGS, DEFAULT_STATUSBAR_CONFIG, ensurePrimeSettings(), loadConfig(), RawConfig (+33 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (46): AddDetails, addParameters, AddParams, BuildDetails, buildParameters, BuildParams, ClusterDetails, clusterParameters (+38 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (30): AddOptions, addUrl(), buildGraph(), BuildOptions, checkUpgrade(), cloneRepo(), detectFiles(), DetectResult (+22 more)

### Community 3 - "Community 3"
Cohesion: 0.2
Nodes (28): BUILD_FLAGS, config, createExec(), getArgumentCompletions(), getCompletions(), handleAdd(), handleBuild(), handleCluster() (+20 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (30): code:bash ($(cat .graphify_python) -c "), code:bash ($(cat .graphify_python) -c "), code:bash (mkdir -p graphify-out), code:bash ($(cat .graphify_python) -c "), code:bash ($(cat .graphify_python) -c "), code:bash ($(cat .graphify_python) -c "), code:bash (# Detect the correct Python interpreter (handles pipx, venv,), code:bash ($(cat .graphify_python) -c ") (+22 more)

### Community 5 - "Community 5"
Cohesion: 0.11
Nodes (17): Advanced orchestration options (skill-level, not `/graphify` flags), code:block1 (/graphify                                             # full), code:bash ($(cat .graphify_python) -c "), code:bash ($(cat .graphify_python) -c "), code:bash ($(cat .graphify_python) -c "), code:bash ($(cat .graphify_python) -c "), Extension Tools vs. This Skill, For --cluster-only (+9 more)

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (14): Always Do, Architecture, CLI, CLI Coverage Gaps, Commands, Config, Dependencies, Deviation Notes (+6 more)

### Community 7 - "Community 7"
Cohesion: 0.15
Nodes (12): Auto-context behavior, code:block1 (/graphify <path>                              # build graph ), code:bash (pi install @gaodes/pi-graphify), Commands, Configuration, @gaodes/pi-graphify, Git tracking policy, Install (+4 more)

### Community 8 - "Community 8"
Cohesion: 0.17
Nodes (11): [0.1.0] - 2025-05-06, [0.1.1] - 2026-05-09, [0.1.2] - 2026-05-09, Added, Added, Added, Changed, Changed (+3 more)

### Community 9 - "Community 9"
Cohesion: 0.18
Nodes (11): code:bash ($(cat .graphify_python) -c "), code:bash ($(cat .graphify_python) -c "), code:bash ($(cat .graphify_python) -c "), code:bash ($(cat .graphify_python) -c "), code:bash (python3 -m graphify.serve graphify-out/graph.json), code:json ({), GraphML export (only if --graphml flag), MCP server (only if --mcp flag) (+3 more)

### Community 10 - "Community 10"
Cohesion: 0.33
Nodes (5): Always Do, CLI, GitNexus — Code Intelligence, Never Do, Resources

### Community 11 - "Community 11"
Cohesion: 0.7
Nodes (3): createBashMock(), createSession(), textOfContent()

## Knowledge Gaps
- **137 isolated node(s):** `AutoContextConfig`, `ResolvedAutoContextConfig`, `RawConfig`, `DEFAULT_AUTO_CONTEXT_CONFIG`, `DEFAULT_CONFIG` (+132 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Full pipeline → follow these steps` connect `Community 4` to `Community 9`, `Community 5`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `What You Must Do When Invoked` connect `Community 5` to `Community 4`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `detectPython()` (e.g. with `handleBuild()` and `handleQuery()`) actually correct?**
  _`detectPython()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `ensureInstalled()` (e.g. with `handleBuild()` and `handleQuery()`) actually correct?**
  _`ensureInstalled()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `AutoContextConfig`, `ResolvedAutoContextConfig`, `RawConfig` to the rest of the system?**
  _137 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._