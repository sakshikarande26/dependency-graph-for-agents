import { Composio } from "@composio/core";
import { writeFile } from "fs/promises";
import { extractDependencies, writeEdges } from "./extract.ts";
import { buildGraph } from "./graph.ts";
import { generateHtml } from "./visualize.ts";
import type { Tool } from "./types.ts";

if (!process.env.COMPOSIO_API_KEY) {
  throw new Error("COMPOSIO_API_KEY missing — did you create .env?");
}

const composio = new Composio();

console.log("[1/4] fetching tools...");
const googleTools = await composio.tools.getRawComposioTools({
  toolkits: ["googlesuper"],
  limit: 1000,
});
await writeFile(
  "data/raw/googlesuper_tools.json",
  JSON.stringify(googleTools, null, 2),
  "utf-8"
);
console.log(`  googlesuper: ${googleTools.length} tools`);

const githubTools = await composio.tools.getRawComposioTools({
  toolkits: ["github"],
  limit: 1000,
});
await writeFile(
  "data/raw/github_tools.json",
  JSON.stringify(githubTools, null, 2),
  "utf-8"
);
console.log(`  github: ${githubTools.length} tools`);

console.log("[2/4] extracting dependencies...");
const edges = extractDependencies([...googleTools, ...githubTools] as Tool[]);
writeEdges(edges, "data/edges.json");
console.log(`  edges: ${edges.length}`);

console.log("[3/4] building graph...");
const graph = buildGraph();
console.log(`  nodes: ${graph.stats.totalNodes}, edges: ${graph.stats.totalEdges}`);

console.log("[4/4] generating HTML...");
generateHtml();
console.log("  data/graph.html written");

console.log("done.");
