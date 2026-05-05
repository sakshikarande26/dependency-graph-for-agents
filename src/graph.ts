// Builds the tool-to-tool dependency graph from data/edges.json + raw tool
// metadata, then emits data/graph.json and data/graph.dot.

import { readFileSync, writeFileSync } from "fs";
import type {
  DependencyConfidence,
  DependencyEdge,
  Tool,
} from "./types.ts";

interface GraphNode {
  id: string;
  toolkit: string;
  name: string;
  inDegree: number;
  outDegree: number;
}

interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  byConfidence: Record<DependencyConfidence, number>;
  byDependencyType: Record<"hard" | "soft", number>;
  topProducers: { slug: string; outDegree: number }[];
  topConsumers: { slug: string; inDegree: number }[];
}

interface Graph {
  nodes: GraphNode[];
  edges: DependencyEdge[];
  stats: GraphStats;
}

const TOOLKIT_COLOR: Record<string, string> = {
  googlesuper: "#4285F4",
  github: "#24292e",
};

const EDGE_STYLE: Record<DependencyConfidence, string> = {
  high: "solid",
  medium: "dashed",
  low: "dotted",
};

export function buildGraph(): Graph {
  const edges: DependencyEdge[] = JSON.parse(
    readFileSync("data/edges.json", "utf-8")
  );

  const tools: Tool[] = [
    ...JSON.parse(readFileSync("data/raw/googlesuper_tools.json", "utf-8")),
    ...JSON.parse(readFileSync("data/raw/github_tools.json", "utf-8")),
  ];
  const meta = new Map<string, { toolkit: string; name: string }>();
  for (const t of tools) {
    meta.set(t.slug, { toolkit: t.toolkit.slug, name: t.name });
  }

  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const slugSet = new Set<string>();
  for (const e of edges) {
    slugSet.add(e.from);
    slugSet.add(e.to);
    outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  const nodes: GraphNode[] = [...slugSet].sort().map((id) => {
    const m = meta.get(id);
    return {
      id,
      toolkit: m?.toolkit ?? "unknown",
      name: m?.name ?? id,
      inDegree: inDegree.get(id) ?? 0,
      outDegree: outDegree.get(id) ?? 0,
    };
  });

  const byConfidence: Record<DependencyConfidence, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };
  const byDependencyType: Record<"hard" | "soft", number> = {
    hard: 0,
    soft: 0,
  };
  for (const e of edges) {
    byConfidence[e.confidence]++;
    byDependencyType[e.dependencyType]++;
  }

  const topProducers = [...outDegree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([slug, n]) => ({ slug, outDegree: n }));

  const topConsumers = [...inDegree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([slug, n]) => ({ slug, inDegree: n }));

  const graph: Graph = {
    nodes,
    edges,
    stats: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      byConfidence,
      byDependencyType,
      topProducers,
      topConsumers,
    },
  };

  writeFileSync("data/graph.json", JSON.stringify(graph, null, 2), "utf-8");
  writeFileSync("data/graph.dot", renderDot(nodes, edges), "utf-8");

  return graph;
}

function renderDot(nodes: GraphNode[], edges: DependencyEdge[]): string {
  // Low confidence edges make the rendering unreadable; drop them.
  const visibleEdges = edges.filter((e) => e.confidence !== "low");
  const visibleSlugs = new Set<string>();
  for (const e of visibleEdges) {
    visibleSlugs.add(e.from);
    visibleSlugs.add(e.to);
  }
  const visibleNodes = nodes.filter((n) => visibleSlugs.has(n.id));

  const lines: string[] = [];
  lines.push("digraph dep_graph {");
  lines.push("  rankdir=LR;");
  lines.push(
    '  node [shape=box, style="rounded,filled", fontname="Helvetica", fontcolor=white];'
  );
  lines.push('  edge [fontname="Helvetica", fontsize=9];');

  for (const n of visibleNodes) {
    const fill = TOOLKIT_COLOR[n.toolkit] ?? "#888888";
    lines.push(
      `  "${n.id}" [label="${escapeDot(stripPrefix(n.id))}", fillcolor="${fill}"];`
    );
  }
  for (const e of visibleEdges) {
    lines.push(
      `  "${e.from}" -> "${e.to}" [style=${EDGE_STYLE[e.confidence]}, label="${escapeDot(e.via)}"];`
    );
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

function stripPrefix(slug: string): string {
  if (slug.startsWith("GOOGLESUPER_")) return slug.slice("GOOGLESUPER_".length);
  if (slug.startsWith("GITHUB_")) return slug.slice("GITHUB_".length);
  return slug;
}

function escapeDot(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
