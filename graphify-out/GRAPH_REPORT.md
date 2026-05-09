# Graph Report - pi-graphify  (2026-05-09)

## Corpus Check
- 9 files · ~18,202 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 71 nodes · 163 edges · 9 communities (5 shown, 4 thin omitted)
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `02f2594d`
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

## God Nodes (most connected - your core abstractions)
1. `escapeShell()` - 13 edges
2. `handler()` - 11 edges
3. `createAllTools()` - 10 edges
4. `detectPython()` - 10 edges
5. `ensureInstalled()` - 10 edges
6. `createExec()` - 7 edges
7. `buildGraph()` - 6 edges
8. `updateGraph()` - 6 edges
9. `handleBuild()` - 6 edges
10. `handleQuery()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `handlePath()` --calls--> `detectPython()`  [INFERRED]
  commands/index.ts → lib/runner.ts
- `handleHook()` --calls--> `detectPython()`  [INFERRED]
  commands/index.ts → lib/runner.ts
- `handlePath()` --calls--> `ensureInstalled()`  [INFERRED]
  commands/index.ts → lib/runner.ts
- `handleHook()` --calls--> `ensureInstalled()`  [INFERRED]
  commands/index.ts → lib/runner.ts
- `handleQuery()` --calls--> `queryGraph()`  [INFERRED]
  commands/index.ts → lib/runner.ts

## Communities (9 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.24
Nodes (14): addUrl(), buildGraph(), cloneRepo(), detectFiles(), ensureGraphifyGitignore(), escapeShell(), explainNode(), generateTree() (+6 more)

### Community 1 - "Community 1"
Cohesion: 0.24
Nodes (11): ensurePrimeSettings(), loadConfig(), readJsonFile(), resolveConfig(), emitStatusbarEvent(), getDefaultPlacement(), registerGraphifyStatusbar(), resolveStatusbarConfig() (+3 more)

### Community 2 - "Community 2"
Cohesion: 0.33
Nodes (9): createAddTool(), createAllTools(), createBuildTool(), createClusterTool(), createExplainTool(), createPathTool(), createQueryTool(), createUpdateTool() (+1 more)

### Community 3 - "Community 3"
Cohesion: 0.46
Nodes (8): createExec(), handleBuild(), handleCluster(), handleExplain(), handleQuery(), clusterOnly(), detectPython(), ensureInstalled()

### Community 4 - "Community 4"
Cohesion: 0.43
Nodes (7): getArgumentCompletions(), getCompletions(), handleAdd(), handler(), handleUpdate(), handleWatch(), parseArgs()

## Knowledge Gaps
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createAllTools()` connect `Community 2` to `Community 1`?**
  _High betweenness centrality (0.115) - this node is a cross-community bridge._
- **Why does `loadConfig()` connect `Community 1` to `Community 4`?**
  _High betweenness centrality (0.114) - this node is a cross-community bridge._
- **Why does `ensurePrimeSettings()` connect `Community 1` to `Community 4`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `detectPython()` (e.g. with `handleBuild()` and `handleQuery()`) actually correct?**
  _`detectPython()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `ensureInstalled()` (e.g. with `handleBuild()` and `handleQuery()`) actually correct?**
  _`ensureInstalled()` has 6 INFERRED edges - model-reasoned connections that need verification._