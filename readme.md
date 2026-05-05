# Tool Dependency Graph — Composio (Google Super + GitHub)

## What this is

This project derives a tool-to-tool dependency graph from the Composio API catalog for the Google Super (438 tools) and GitHub (867 tools) toolkits — 1,305 tools in total. Each edge represents a *produces a value that another tool consumes* relationship: `GOOGLESUPER_LIST_THREADS` produces a `thread_id` that `GOOGLESUPER_REPLY_TO_THREAD` requires. An LLM agent that wants to chain multi-step actions needs this map; without it the agent is guessing at parameter values or asking the user for IDs they shouldn't have to know. The extraction is harder than it looks because the catalog ships rich input schemas but the output schemas are unusable — every `outputParameters.data` field is a `$ref` pointing at a `#/$defs/SomeType` block that does not exist on the tool object — so we cannot structurally verify what a tool returns. The dependency signal lives in three places: the prose of parameter descriptions, the parameter names themselves, and product knowledge that isn't in the schema at all.

## The extraction approach

Three signals, in descending order of trust.

### Description hints (49 edges, high confidence)

Parameter descriptions sometimes name the producing tool by hand. The `thread_id` parameter on `GOOGLESUPER_REPLY_TO_THREAD` literally reads *"Use GMAIL_LIST_THREADS or GMAIL_FETCH_EMAILS to retrieve valid thread IDs."* A regex over every tool description and every parameter description matches `(use|see|via|from|returned\s+by|call)\s+(SLUG_LIKE)` and records the producer/consumer pair.

There is one wrinkle that costs more code than it should: the prose still uses the old `GMAIL_*` prefix even though the toolkit shipped under `GOOGLESUPER_*`. So `GMAIL_LIST_THREADS` doesn't exist as a slug — `GOOGLESUPER_LIST_THREADS` does. Before recording an edge, every `GMAIL_*` mention is rewritten to `GOOGLESUPER_*` and the edge is only emitted when the rewritten slug actually exists in the catalog. The same readme that ships with the assignment uses the `GMAIL_*` form in its examples, so this is a real source of confusion, not a private quirk.

This signal is small but it is the only one with explicit author intent. When a Composio engineer wrote the description, they meant for the reader to chain those tools.

### Token taxonomy (862 edges, medium confidence)

When prose is silent, parameter names carry the signal. A tool with an `issue_number` parameter must come after a tool that returns issue numbers; a tool with a `runner_id` must come after a tool that creates or lists runners. Nineteen ID families are curated by hand, each with a list of producer slugs and a predicate that tests whether a given tool is a consumer (usually `hasParam(tool, "issue_number")`). For each family, the cross product of producers and consumers becomes edges.

Two design decisions matter here.

**`owner+repo` is excluded.** Almost every GitHub tool requires both `owner` and `repo`, and four tools produce them. A naive expansion produced 1,708 edges saying *"every repo-scoped tool depends on a repository lookup"*. Technically true and useless in practice — `owner+repo` is ambient context the agent receives from the user's request, not a dependency it needs to resolve at runtime. Modeling it inflated the graph from ~840 to ~2,500 edges with no information gain. The family was deleted from the taxonomy entirely.

**Producer-as-consumer is suppressed.** `GITHUB_CREATE_AN_ISSUE` produces an `issue_number` (the new issue gets one), so it should not receive incoming edges from the other tools in the `issue_number` family — those are alternative producers, not predecessors. The check is simple: if the consumer's slug appears anywhere in the family's producer list, skip the edge.

### Soft dependencies (29 edges, low confidence)

The third signal is the smallest and the most editorial. Some dependencies don't show up in either prose or parameter shape but still matter to a real agent. `GOOGLESUPER_SEND_EMAIL` may need a contact lookup to translate a name to an email address. `GITHUB_MERGE_A_PULL_REQUEST` may want to verify reviews first. Any tool with a `file_uploadable: true` parameter needs the file uploaded before it can be referenced.

Six rules cover these by hand. They are explicitly not exhaustive — this is the layer where an LLM-assisted extraction would help most, since the relationships are real but the signal is purely linguistic.

### What we cannot verify

There is no way to check the graph against ground truth from output schemas. Every tool's `outputParameters.data` is a `$ref` to a `#/$defs/...` block that does not exist anywhere on the tool object. We have type *names* (`CreateAnIssueCommentResponse`, `GmailMessageResponse`) but not type *shapes*. So when we say `GOOGLESUPER_LIST_THREADS` produces a `thread_id`, that's an inference from the slug and the description — not a guarantee from the schema. A future version could verify by making real API calls and inspecting responses; for now, the graph trusts Composio's authoring.

## Data findings

| Confidence | Edges | Source |
|------------|------:|--------|
| high       | 49    | description hints |
| medium     | 862   | token taxonomy |
| low        | 29    | soft dependencies |
| **total**  | **940** | |

By dependency type: 911 hard, 29 soft. By participation: 400 of 1,305 tools appear in at least one edge; 905 are orphans. Per toolkit, 278 of 438 Google Super tools (63%) and 627 of 867 GitHub tools (72%) have no edges at all.

The orphan rate is high but mostly expected, and reading it as a failure mode would be wrong. Two patterns dominate.

Entry-point tools legitimately have no upstream. `LIST_*`, `SEARCH_*`, `FETCH_*`, and `*_AUTHENTICATED_USER` tools take only a query and the user's auth — there is no producer for them by definition, and they are correctly orphan as in-degree zero.

Second-tier resource IDs have no producer in the curated taxonomy. The first cut of the taxonomy missed several ID families that appear in the catalog: `task_id`, `deployment_id`, `runner_id`, `check_run_id`, `delivery_id`, `label_id`, `draft_id`. Adding seven of them connected ~100 more tools. There are still families absent from the taxonomy — repository rulesets, codespaces, environments, secret keys, organization webhooks — and each is a small extension. The ceiling on this approach is curation effort, not algorithmic difficulty.

## Project structure

```
src/
  index.ts        Pipeline orchestrator. Fetches both toolkits, runs extract,
                  builds graph, writes HTML. About 50 lines.
  extract.ts      Three-signal dependency extractor. Owns the regex, the
                  token taxonomy, and the soft-rule list.
  graph.ts        Reads edges.json, computes node degrees, writes graph.json
                  (full graph + stats) and graph.dot (Graphviz format).
  visualize.ts    Reads graph.json plus the raw tool files, inlines them
                  into a self-contained HTML explorer with D3 from CDN.
  types.ts        Shared types: Tool, InputParameters, DependencyEdge.

data/
  raw/            Raw Composio JSON, one file per toolkit.
  edges.json      940 dependency edges in flat-list form.
  graph.json      Nodes (with degrees), edges, and a stats block.
  graph.dot       Same graph rendered as Graphviz; high+medium edges only.
  graph.html      Self-contained explorer; opens directly in a browser.
```

Data flows in one direction: `index.ts` → `extract.ts` → `graph.ts` → `visualize.ts`. Each stage reads from disk and writes to disk; there is no shared in-memory state between stages, which makes any one stage independently runnable for debugging.

## How to run

Prerequisites: [Bun](https://bun.sh) and a Composio API key.

```sh
COMPOSIO_API_KEY=ak_...   sh scaffold.sh   # writes .env (also pulls an OpenRouter key, currently unused)
bun install
bun src/index.ts
open data/graph.html
```

End-to-end runtime is roughly 60 seconds, dominated by the two `getRawComposioTools` API calls. All outputs land under `data/`.

## How to extend

### Adding a token family

The taxonomy lives in `TOKEN_FAMILIES` in `src/extract.ts`. Each entry names a producer set and a predicate. To add `milestone_id`:

```ts
{
  token: "milestone_id",
  producers: [
    "GITHUB_LIST_MILESTONES",
    "GITHUB_CREATE_A_MILESTONE",
  ],
  consumerCheck: (t) => hasParam(t, "milestone_id"),
},
```

Verify the producer slugs exist in `data/raw/github_tools.json` before committing — the extractor silently skips families whose producers are absent, so a typo will quietly produce zero edges instead of a loud failure.

### Adding a soft dependency

Soft rules live in `SOFT_RULES` in the same file. Each rule names a consumer (or `"*"` with an `appliesTo` predicate), one or more producers, and a short `via` label that ends up on the edge.

```ts
{
  consumer: "GITHUB_REVIEW_DEPLOYMENT_PROTECTION_RULES",
  producers: ["GITHUB_GET_PENDING_DEPLOYMENTS_FOR_A_WORKFLOW_RUN"],
  via: "pending deployment discovery",
  reason: "may need to find which deployments are pending review before approving",
},
```

Soft rules produce low-confidence edges and are exempt from the producer-as-consumer suppression because they describe UX-level dependencies, not schema-level ones.

### Adding a new toolkit

Two changes. First, fetch it in `src/index.ts`:

```ts
const slackTools = await composio.tools.getRawComposioTools({
  toolkits: ["slack"],
  limit: 1000,
});
await writeFile("data/raw/slack_tools.json", JSON.stringify(slackTools, null, 2), "utf-8");
```

Then pass `[...googleTools, ...githubTools, ...slackTools]` into `extractDependencies`. Second, add token families and soft rules for the new toolkit's ID types (`channel_id`, `user_id`, `ts`, etc.) following the patterns above. The visualization picks up new toolkits automatically as long as a toolkit color is defined in the `COLORS` map at the top of the inline script in `visualize.ts`.

## The visualization

`data/graph.html` is a per-tool dependency explorer, not a force-directed view of all 1,305 tools. A force layout of that many nodes is unreadable; the explorer renders one tool at a time with its direct neighbours, which is closer to how someone debugging an agent would actually use it.

The left panel lists every tool, grouped by toolkit, with a filter input at the top. Type any substring of a slug to narrow the list. Click a tool and the right panel renders three columns: predecessors (tools that must run first), the selected tool in the middle, and successors (tools this enables). Edges are labelled with the parameter or token that flows along them, and styled by confidence — solid white for description-derived edges, dashed gray for taxonomy-derived edges, dotted for soft rules. Clicking any predecessor or successor recenters the graph on it; you can walk the chain from any starting point. Tools with no edges render `NO DEPENDENCIES FOUND` in the center, which is informative — it usually means a missing token family in the taxonomy rather than a tool that genuinely has no dependencies.

A typical use: search `REPLY_TO_THREAD`, click `GOOGLESUPER_REPLY_TO_THREAD`. The left column shows `LIST_THREADS`, `FETCH_EMAILS`, and `FETCH_MESSAGE_BY_THREAD_ID` as predecessors — three different ways to obtain a `thread_id`. The right column is empty; replying to a thread is a terminal action. Click `LIST_THREADS` to recenter and see what produces it (nothing — it's an entry-point tool).
