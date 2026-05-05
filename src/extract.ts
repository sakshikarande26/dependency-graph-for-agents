// Extracts tool-to-tool dependency edges from raw Composio JSON using three
// signals: description-based slug mentions (high), a structural token
// taxonomy (medium), and hand-authored soft dependencies (low).

import { writeFileSync } from "fs";
import type { DependencyEdge, Tool } from "./types.ts";

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export function extractDependencies(tools: Tool[]): DependencyEdge[] {
  const slugs = new Set(tools.map((t) => t.slug));

  // Run Signal 1 first so its results can inform the structural pass.
  const high = extractDescriptionHints(tools, slugs);

  // Consumers whose `owner` or `repo` parameter already has a high-confidence
  // producer attached (Signal 1) — we won't add the broad medium edge for
  // those, since the description already explains the source.
  const ownerRepoExplained = new Set<string>();
  for (const e of high) {
    if (e.via === "owner" || e.via === "repo") ownerRepoExplained.add(e.to);
  }

  const medium = extractStructuralHints(tools, slugs, ownerRepoExplained);
  const low = extractSoftHints(tools, slugs);

  return sortEdges(dedupeEdges([...high, ...medium, ...low]));
}

export function writeEdges(edges: DependencyEdge[], path: string): void {
  writeFileSync(path, JSON.stringify(edges, null, 2), "utf-8");
}

// ------------------------------------------------------------
// SIGNAL 1: description-based hints (high confidence, hard)
// ------------------------------------------------------------

const TRIGGER_RE =
  /\b(use|see|via|from|returned\s+by|call)\s+([A-Z][A-Z0-9]+(?:_[A-Z0-9]+){2,})\b/gi;

export function extractDescriptionHints(
  tools: Tool[],
  slugs: Set<string>
): DependencyEdge[] {
  const out: DependencyEdge[] = [];
  for (const tool of tools) {
    scanProse(tool.description, (mention) => {
      const from = normalizeSlug(mention, slugs);
      if (!from || from === tool.slug) return;
      out.push({
        from,
        to: tool.slug,
        via: "description",
        confidence: "high",
        dependencyType: "hard",
        reason: `${tool.slug} description names ${mention} as a precursor`,
      });
    });

    for (const [paramName, schema] of Object.entries(
      tool.inputParameters.properties
    )) {
      scanProse(schema.description, (mention) => {
        const from = normalizeSlug(mention, slugs);
        if (!from || from === tool.slug) return;
        out.push({
          from,
          to: tool.slug,
          via: paramName,
          confidence: "high",
          dependencyType: "hard",
          reason: `${tool.slug}.${paramName} description names ${mention} as the producer`,
        });
      });
    }
  }
  return out;
}

function scanProse(prose: string | undefined, onMention: (slug: string) => void): void {
  if (!prose) return;
  const re = new RegExp(TRIGGER_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(prose))) {
    const slug = m[2];
    if (slug) onMention(slug);
  }
}

// "GMAIL_FOO" → "GOOGLESUPER_FOO" if that exists. Otherwise the mention itself
// only if it is a real slug. Else null.
function normalizeSlug(mention: string, slugs: Set<string>): string | null {
  if (slugs.has(mention)) return mention;
  if (mention.startsWith("GMAIL_")) {
    const alt = "GOOGLESUPER_" + mention.slice("GMAIL_".length);
    if (slugs.has(alt)) return alt;
  }
  return null;
}

// ------------------------------------------------------------
// SIGNAL 2: structural / semantic heuristics (medium confidence, hard)
// ------------------------------------------------------------

type TokenFamily = {
  token: string;
  producers: string[];
  consumerCheck: (tool: Tool) => boolean;
};

const TOKEN_FAMILIES: TokenFamily[] = [
  {
    token: "issue_number",
    producers: [
      "GITHUB_LIST_REPOSITORY_ISSUES",
      "GITHUB_CREATE_AN_ISSUE",
      "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
    ],
    consumerCheck: (t) => hasParam(t, "issue_number"),
  },
  {
    token: "pull_number",
    producers: [
      "GITHUB_LIST_PULL_REQUESTS",
      "GITHUB_CREATE_A_PULL_REQUEST",
      "GITHUB_FIND_PULL_REQUESTS",
    ],
    consumerCheck: (t) => hasParam(t, "pull_number"),
  },
  {
    token: "release_id",
    producers: [
      "GITHUB_LIST_RELEASES",
      "GITHUB_CREATE_A_RELEASE",
      "GITHUB_GET_THE_LATEST_RELEASE",
    ],
    consumerCheck: (t) => hasParam(t, "release_id"),
  },
  {
    token: "workflow_id|run_id",
    producers: [
      "GITHUB_LIST_REPOSITORY_WORKFLOWS",
      "GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY",
    ],
    consumerCheck: (t) => hasParam(t, "workflow_id") || hasParam(t, "run_id"),
  },
  {
    token: "comment_id",
    producers: [
      "GITHUB_LIST_ISSUE_COMMENTS",
      "GITHUB_CREATE_AN_ISSUE_COMMENT",
    ],
    consumerCheck: (t) => hasParam(t, "comment_id"),
  },
  {
    token: "branch|ref",
    producers: ["GITHUB_LIST_BRANCHES", "GITHUB_CREATE_A_REFERENCE"],
    consumerCheck: (t) => hasParam(t, "branch") || hasParam(t, "ref"),
  },
  {
    token: "thread_id",
    producers: [
      "GOOGLESUPER_LIST_THREADS",
      "GOOGLESUPER_FETCH_EMAILS",
      "GOOGLESUPER_FETCH_MESSAGE_BY_THREAD_ID",
    ],
    consumerCheck: (t) => hasParam(t, "thread_id"),
  },
  {
    token: "message_id",
    producers: [
      "GOOGLESUPER_SEND_EMAIL",
      "GOOGLESUPER_LIST_THREADS",
      "GOOGLESUPER_FETCH_EMAILS",
    ],
    consumerCheck: (t) => hasParam(t, "message_id"),
  },
  {
    token: "file_id",
    producers: [
      "GOOGLESUPER_CREATE_FILE",
      "GOOGLESUPER_FIND_FILE",
      "GOOGLESUPER_UPLOAD_FILE",
      "GOOGLESUPER_LIST_FILES",
    ],
    consumerCheck: (t) => hasParam(t, "file_id"),
  },
  {
    token: "calendar_id",
    producers: [
      "GOOGLESUPER_LIST_CALENDARS",
      "GOOGLESUPER_DUPLICATE_CALENDAR",
    ],
    consumerCheck: (t) => hasParam(t, "calendar_id"),
  },
  {
    token: "event_id",
    producers: [
      "GOOGLESUPER_CREATE_EVENT",
      "GOOGLESUPER_EVENTS_LIST",
      "GOOGLESUPER_FIND_EVENT",
    ],
    consumerCheck: (t) => hasParam(t, "event_id"),
  },
  {
    token: "spreadsheet_id",
    producers: [
      "GOOGLESUPER_CREATE_GOOGLE_SHEET1",
      "GOOGLESUPER_SEARCH_SPREADSHEETS",
    ],
    consumerCheck: (t) => hasParam(t, "spreadsheet_id"),
  },
  {
    token: "document_id",
    producers: [
      "GOOGLESUPER_CREATE_DOCUMENT",
      "GOOGLESUPER_SEARCH_DOCUMENTS",
      "GOOGLESUPER_COPY_DOCUMENT",
    ],
    consumerCheck: (t) => hasParam(t, "document_id"),
  },
  {
    token: "task_id",
    producers: [
      "GOOGLESUPER_LIST_TASKS",
      "GOOGLESUPER_LIST_ALL_TASKS",
      "GOOGLESUPER_INSERT_TASK",
    ],
    consumerCheck: (t) => hasParam(t, "task_id"),
  },
  {
    token: "deployment_id",
    producers: [
      "GITHUB_LIST_DEPLOYMENTS",
      "GITHUB_CREATE_A_DEPLOYMENT",
    ],
    consumerCheck: (t) => hasParam(t, "deployment_id"),
  },
  {
    token: "runner_id",
    producers: [
      "GITHUB_LIST_SELF_HOSTED_RUNNERS_FOR_A_REPOSITORY",
      "GITHUB_LIST_SELF_HOSTED_RUNNERS_FOR_AN_ORGANIZATION",
      "GITHUB_CREATE_JIT_RUNNER_CONFIG",
    ],
    consumerCheck: (t) => hasParam(t, "runner_id"),
  },
  {
    token: "check_run_id",
    producers: [
      "GITHUB_LIST_CHECK_RUNS_FOR_A_REF",
      "GITHUB_LIST_CHECK_RUNS_IN_A_CHECK_SUITE",
      "GITHUB_CREATE_A_CHECK_RUN",
    ],
    consumerCheck: (t) => hasParam(t, "check_run_id"),
  },
  {
    token: "delivery_id",
    producers: [
      "GITHUB_LIST_DELIVERIES_FOR_A_REPOSITORY_WEBHOOK",
      "GITHUB_LIST_DELIVERIES_FOR_AN_ORGANIZATION_WEBHOOK",
    ],
    consumerCheck: (t) => hasParam(t, "delivery_id"),
  },
  {
    token: "label_id",
    producers: [
      "GOOGLESUPER_LIST_LABELS",
      "GOOGLESUPER_CREATE_LABEL",
      "GOOGLESUPER_LIST_FILE_LABELS",
    ],
    consumerCheck: (t) => hasParam(t, "label_id"),
  },
  {
    token: "draft_id",
    producers: [
      "GOOGLESUPER_LIST_DRAFTS",
      "GOOGLESUPER_CREATE_EMAIL_DRAFT",
    ],
    consumerCheck: (t) => hasParam(t, "draft_id"),
  },
];

export function extractStructuralHints(
  tools: Tool[],
  slugs: Set<string>,
  ownerRepoExplained: Set<string> = new Set()
): DependencyEdge[] {
  const out: DependencyEdge[] = [];
  for (const family of TOKEN_FAMILIES) {
    const producers = family.producers.filter((p) => slugs.has(p));
    if (producers.length === 0) continue;
    const producerSet = new Set(producers);
    for (const consumer of tools) {
      if (!family.consumerCheck(consumer)) continue;
      // Fix 2: a tool that itself produces this token shouldn't be a
      // consumer of any sibling producer in the same family.
      if (producerSet.has(consumer.slug)) continue;
      // Fix 1: skip owner+repo medium edges when Signal 1 already
      // explained where owner or repo comes from for this consumer.
      if (family.token === "owner+repo" && ownerRepoExplained.has(consumer.slug)) {
        continue;
      }
      for (const producer of producers) {
        if (producer === consumer.slug) continue;
        out.push({
          from: producer,
          to: consumer.slug,
          via: family.token,
          confidence: "medium",
          dependencyType: "hard",
          reason: `${producer} produces ${family.token}, which ${consumer.slug} requires`,
        });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------
// SIGNAL 3: hand-authored soft dependencies (low confidence, soft)
// ------------------------------------------------------------

type SoftRule = {
  consumer: string;          // exact slug, or "*" for wildcard with appliesTo
  producers: string[];
  via: string;
  reason: string;
  appliesTo?: (tool: Tool) => boolean;
};

const SOFT_RULES: SoftRule[] = [
  {
    consumer: "GOOGLESUPER_SEND_EMAIL",
    producers: ["GOOGLESUPER_GET_CONTACTS", "GOOGLESUPER_SEARCH_PEOPLE"],
    via: "name->email lookup",
    reason: "may need to resolve a recipient name to an email before sending",
  },
  {
    consumer: "GOOGLESUPER_REPLY_TO_THREAD",
    producers: ["GOOGLESUPER_FETCH_EMAILS", "GOOGLESUPER_LIST_THREADS"],
    via: "thread discovery",
    reason: "may need to locate the right thread before replying",
  },
  {
    consumer: "GOOGLESUPER_CREATE_EVENT",
    producers: ["GOOGLESUPER_GET_CONTACTS"],
    via: "attendee resolution",
    reason: "may need to resolve attendee names to email addresses",
  },
  {
    consumer: "GITHUB_CREATE_AN_ISSUE_COMMENT",
    producers: ["GITHUB_LIST_REPOSITORY_ISSUES"],
    via: "issue discovery",
    reason: "may need to find the right issue before commenting",
  },
  {
    consumer: "GITHUB_CREATE_A_REVIEW_FOR_A_PULL_REQUEST",
    producers: ["GITHUB_LIST_PULL_REQUESTS"],
    via: "pull request discovery",
    reason: "may need to find the right PR before reviewing",
  },
  {
    consumer: "GITHUB_MERGE_A_PULL_REQUEST",
    producers: ["GITHUB_LIST_REVIEWS_FOR_A_PULL_REQUEST"],
    via: "review status check",
    reason: "may want to verify reviews before merging",
  },
  {
    consumer: "*",
    producers: ["GOOGLESUPER_UPLOAD_FILE", "GOOGLESUPER_DOWNLOAD_FILE"],
    via: "attachment upload",
    reason: "tool has a file_uploadable parameter; the file must be uploaded first",
    appliesTo: (t) => hasUploadableParam(t.inputParameters),
  },
];

export function extractSoftHints(
  tools: Tool[],
  slugs: Set<string>
): DependencyEdge[] {
  const bySlug = new Map(tools.map((t) => [t.slug, t]));
  const out: DependencyEdge[] = [];
  for (const rule of SOFT_RULES) {
    const producers = rule.producers.filter((p) => slugs.has(p));
    if (producers.length === 0) continue;

    const consumers: Tool[] =
      rule.consumer === "*"
        ? tools
        : bySlug.has(rule.consumer)
        ? [bySlug.get(rule.consumer)!]
        : [];

    for (const consumer of consumers) {
      if (rule.appliesTo && !rule.appliesTo(consumer)) continue;
      for (const producer of producers) {
        if (producer === consumer.slug) continue;
        out.push({
          from: producer,
          to: consumer.slug,
          via: rule.via,
          confidence: "low",
          dependencyType: "soft",
          reason: rule.reason,
        });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------

function hasParam(tool: Tool, name: string): boolean {
  return Boolean(tool.inputParameters?.properties?.[name]);
}

function hasUploadableParam(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const obj = schema as Record<string, unknown>;
  if (obj.file_uploadable === true) return true;
  for (const v of Object.values(obj)) {
    if (hasUploadableParam(v)) return true;
  }
  return false;
}

const RANK: Record<DependencyEdge["confidence"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

// Same (from, to, via) → keep highest confidence (per spec).
function dedupeEdges(edges: DependencyEdge[]): DependencyEdge[] {
  const best = new Map<string, DependencyEdge>();
  for (const e of edges) {
    const key = `${e.from}${e.to}${e.via}`;
    const prev = best.get(key);
    if (!prev || RANK[e.confidence] > RANK[prev.confidence]) {
      best.set(key, e);
    }
  }
  return [...best.values()];
}

function sortEdges(edges: DependencyEdge[]): DependencyEdge[] {
  return edges.sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    if (a.to !== b.to) return a.to < b.to ? -1 : 1;
    if (a.via !== b.via) return a.via < b.via ? -1 : 1;
    return RANK[b.confidence] - RANK[a.confidence];
  });
}
