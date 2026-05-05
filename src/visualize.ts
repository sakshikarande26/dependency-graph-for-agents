// Renders data/graph.json as a self-contained dependency explorer at
// data/graph.html: searchable left panel + per-tool subgraph on the right.

import { readFileSync, writeFileSync } from "fs";

export function generateHtml(): void {
  const graph = JSON.parse(readFileSync("data/graph.json", "utf-8"));
  const gs = JSON.parse(readFileSync("data/raw/googlesuper_tools.json", "utf-8"));
  const gh = JSON.parse(readFileSync("data/raw/github_tools.json", "utf-8"));

  // Degrees from the participating-nodes set in graph.json; orphans = 0/0.
  const degree = new Map<string, { inDegree: number; outDegree: number }>();
  for (const n of graph.nodes) {
    degree.set(n.id, { inDegree: n.inDegree, outDegree: n.outDegree });
  }
  const allNodes = [...gs, ...gh].map((t: { slug: string; toolkit: { slug: string }; name: string }) => ({
    id: t.slug,
    toolkit: t.toolkit.slug,
    name: t.name,
    inDegree: degree.get(t.slug)?.inDegree ?? 0,
    outDegree: degree.get(t.slug)?.outDegree ?? 0,
  }));

  const payload = JSON.stringify({ nodes: allNodes, edges: graph.edges })
    .replace(/<\/script>/gi, "<\\/script>");
  writeFileSync("data/graph.html", HTML.replace("__GRAPH_DATA__", payload), "utf-8");
}

// Inline JS uses string concatenation (not template literals) so the outer
// TS template literal doesn't need backtick/${} escaping.
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Dependency Graph · Google Super + GitHub tools</title>
<style>
  :root {
    --bg: #0a0a0a;
    --panel: #0f0f0f;
    --border: #1f1f1f;
    --border-strong: #2a2a2a;
    --text: #fafafa;
    --muted: #71717a;
    --muted-strong: #a1a1aa;
    --hover: #161616;
    --active: #1c1c1c;
    --accent: #4285F4;
    --gs: #4285F4;
    --gh: #e6edf3;
  }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text);
    font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace;
    font-size: 13px; }
  .app { display: flex; height: 100vh; }

  .sidebar { width: 300px; background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
  .brand { padding: 18px 20px 14px; border-bottom: 1px solid var(--border); }
  .brand .title { font-size: 12px; letter-spacing: 0.08em; color: var(--text); }
  .brand .sub { font-size: 10px; letter-spacing: 0.06em; color: var(--muted); margin-top: 4px; text-transform: uppercase; }
  .filter { padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .filter input { width: 100%; padding: 9px 11px; background: #050505; border: 1px solid var(--border-strong); border-radius: 4px; font-size: 12px; color: var(--text); box-sizing: border-box; font-family: inherit; }
  .filter input::placeholder { color: var(--muted); }
  .filter input:focus { outline: none; border-color: var(--accent); }
  .list { overflow-y: auto; flex: 1; }
  .list::-webkit-scrollbar { width: 8px; }
  .list::-webkit-scrollbar-thumb { background: #27272a; border-radius: 4px; }
  .section h3 { font-size: 10px; text-transform: uppercase; color: var(--muted); padding: 14px 16px 6px; margin: 0; letter-spacing: 0.1em; }
  .item { padding: 5px 16px; font-size: 11.5px; cursor: pointer; border-left: 2px solid transparent; user-select: none; line-height: 1.45; color: #d4d4d8; }
  .item:hover { background: var(--hover); color: var(--text); }
  .item.active { background: var(--active); color: var(--text); }
  .item.gs.active { border-left-color: var(--gs); }
  .item.gh.active { border-left-color: var(--gh); }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 9px; vertical-align: middle; }
  .dot.gs { background: var(--gs); }
  .dot.gh { background: var(--gh); }

  .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
  .header { padding: 18px 28px; background: var(--panel); border-bottom: 1px solid var(--border); }
  .header h2 { margin: 0; font-size: 15px; font-weight: 500; letter-spacing: 0.02em; }
  .header .sub { font-size: 11px; color: var(--muted); margin-top: 6px; letter-spacing: 0.03em; }
  .canvas { flex: 1; position: relative; overflow: hidden; }
  svg { width: 100%; height: 100%; display: block; }
  .empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--muted); font-size: 12px; letter-spacing: 0.05em; text-transform: uppercase; }

  .node { cursor: pointer; }
  .node circle { stroke: var(--bg); stroke-width: 2px; }
  .node.center circle { stroke: #fbbf24; stroke-width: 3px; }
  .node text { font-size: 11px; pointer-events: none; fill: var(--text); }
  .link { fill: none; }
  .link.high { stroke: var(--text); stroke-dasharray: none; }
  .link.medium { stroke: var(--muted-strong); stroke-dasharray: 5,3; opacity: 0.7; }
  .link.low { stroke: var(--muted); stroke-dasharray: 1,3; opacity: 0.5; }
  .link-label { font-size: 10px; fill: var(--muted-strong); pointer-events: none; }
  .col-label { font-size: 10px; text-transform: uppercase; fill: var(--muted); letter-spacing: 0.1em; }

  .legend { position: absolute; right: 18px; bottom: 16px; background: rgba(15,15,15,0.92); padding: 10px 14px; border: 1px solid var(--border-strong); border-radius: 4px; font-size: 10.5px; color: var(--muted-strong); letter-spacing: 0.04em; }
  .legend .row { display: flex; align-items: center; gap: 10px; margin: 3px 0; }
  .legend .swatch { width: 28px; height: 0; border-top: 2px solid var(--text); }
  .legend .swatch.medium { border-top: 2px dashed var(--muted-strong); }
  .legend .swatch.low { border-top: 2px dotted var(--muted); }
</style>
</head>
<body>
<div class="app">
  <div class="sidebar">
    <div class="brand">
      <div class="title">DEPENDENCY GRAPH</div>
      <div class="sub">Google Super + GitHub tools</div>
    </div>
    <div class="filter"><input id="q" placeholder="filter by slug..." autofocus></div>
    <div class="list" id="list"></div>
  </div>
  <div class="main">
    <div class="header">
      <h2 id="title">Select a tool</h2>
      <div class="sub" id="subtitle">Pick from the left to see its predecessors and successors.</div>
    </div>
    <div class="canvas" id="canvas">
      <div class="empty">No tool selected</div>
      <div class="legend">
        <div class="row"><div class="swatch"></div>high · description-named</div>
        <div class="row"><div class="swatch medium"></div>medium · token taxonomy</div>
        <div class="row"><div class="swatch low"></div>low · soft dep</div>
      </div>
    </div>
  </div>
</div>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
const data = __GRAPH_DATA__;
const COLORS = { googlesuper: "#4285F4", github: "#24292e" };
function strip(s) { return s.replace(/^GOOGLESUPER_/, "").replace(/^GITHUB_/, ""); }

const byId = new Map(data.nodes.map(function (n) { return [n.id, n]; }));
const incoming = new Map(), outgoing = new Map();
for (var i = 0; i < data.edges.length; i++) {
  var e = data.edges[i];
  if (!incoming.has(e.to)) incoming.set(e.to, []);
  if (!outgoing.has(e.from)) outgoing.set(e.from, []);
  incoming.get(e.to).push(e);
  outgoing.get(e.from).push(e);
}

var sorted = data.nodes.slice().sort(function (a, b) { return a.id.localeCompare(b.id); });
var gs = sorted.filter(function (n) { return n.toolkit === "googlesuper"; });
var gh = sorted.filter(function (n) { return n.toolkit === "github"; });

var listEl = document.getElementById("list");
var qEl = document.getElementById("q");
var selected = null;

function renderList(filter) {
  var f = (filter || "").trim().toUpperCase();
  listEl.innerHTML = "";
  var sections = [["GoogleSuper", gs, "gs"], ["GitHub", gh, "gh"]];
  for (var s = 0; s < sections.length; s++) {
    var label = sections[s][0], items = sections[s][1], kind = sections[s][2];
    var matched = items.filter(function (n) { return !f || strip(n.id).indexOf(f) >= 0 || n.id.indexOf(f) >= 0; });
    if (matched.length === 0) continue;
    var sec = document.createElement("div");
    sec.className = "section";
    var h = document.createElement("h3");
    h.textContent = label + " (" + matched.length + ")";
    sec.appendChild(h);
    for (var j = 0; j < matched.length; j++) {
      var n = matched[j];
      var div = document.createElement("div");
      div.className = "item " + kind + (n.id === selected ? " active" : "");
      div.innerHTML = '<span class="dot ' + kind + '"></span>' + escapeHtml(strip(n.id));
      div.title = n.name;
      (function (id) { div.onclick = function () { select(id); }; })(n.id);
      sec.appendChild(div);
    }
    listEl.appendChild(sec);
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function select(id) {
  selected = id;
  renderList(qEl.value);
  renderSubgraph(id);
}

qEl.addEventListener("input", function () { renderList(qEl.value); });
renderList("");

function renderSubgraph(id) {
  var node = byId.get(id);
  document.getElementById("title").textContent = strip(id);
  document.getElementById("subtitle").textContent =
    node.toolkit + " · " + node.name + " · in: " + node.inDegree + ", out: " + node.outDegree;

  var inc = incoming.get(id) || [];
  var out = outgoing.get(id) || [];

  var canvas = document.getElementById("canvas");
  var legend = canvas.querySelector(".legend");
  // Clear previous svg/empty without removing legend
  Array.prototype.slice.call(canvas.children).forEach(function (c) {
    if (c !== legend) canvas.removeChild(c);
  });

  var w = canvas.clientWidth, h = canvas.clientHeight;
  var svg = d3.select(canvas).insert("svg", ".legend").attr("viewBox", [0, 0, w, h]);

  // Truly orphan: render center node with an explanatory message.
  if (inc.length === 0 && out.length === 0) {
    var nodeOnly = svg.append("g");
    drawNode(nodeOnly, { id: id, x: w / 2, y: h / 2, isCenter: true });
    svg.append("text")
      .attr("class", "col-label")
      .attr("x", w / 2).attr("y", h / 2 + 64)
      .attr("text-anchor", "middle")
      .text("NO DEPENDENCIES FOUND");
    return;
  }

  var colLeft = w * 0.18, colCenter = w * 0.5, colRight = w * 0.82;
  var top = 50, bot = h - 30;

  svg.append("text").attr("class", "col-label").attr("x", colLeft).attr("y", 24).attr("text-anchor", "middle").text("PREDECESSORS (" + inc.length + ")");
  svg.append("text").attr("class", "col-label").attr("x", colCenter).attr("y", 24).attr("text-anchor", "middle").text("SELECTED");
  svg.append("text").attr("class", "col-label").attr("x", colRight).attr("y", 24).attr("text-anchor", "middle").text("SUCCESSORS (" + out.length + ")");

  function place(items, x) {
    var n = items.length;
    if (n === 0) return [];
    if (n === 1) return [{ x: x, y: (top + bot) / 2, edge: items[0].edge, id: items[0].id }];
    return items.map(function (it, i) {
      return { x: x, y: top + (i * (bot - top)) / (n - 1), edge: it.edge, id: it.id };
    });
  }

  var leftItems = inc.map(function (e) { return { id: e.from, edge: e }; });
  var rightItems = out.map(function (e) { return { id: e.to, edge: e }; });
  var leftPos = place(leftItems, colLeft);
  var rightPos = place(rightItems, colRight);
  var center = { id: id, x: colCenter, y: h / 2, isCenter: true };

  var edgeG = svg.append("g");
  for (var li = 0; li < leftPos.length; li++) drawEdge(edgeG, leftPos[li].x, leftPos[li].y, center.x, center.y, leftPos[li].edge);
  for (var ri = 0; ri < rightPos.length; ri++) drawEdge(edgeG, center.x, center.y, rightPos[ri].x, rightPos[ri].y, rightPos[ri].edge);

  var nodeG = svg.append("g");
  drawNode(nodeG, center);
  for (var li2 = 0; li2 < leftPos.length; li2++) drawNode(nodeG, leftPos[li2]);
  for (var ri2 = 0; ri2 < rightPos.length; ri2++) drawNode(nodeG, rightPos[ri2]);
}

function drawNode(parent, p) {
  var n = byId.get(p.id);
  if (!n) return;
  var g = parent.append("g")
    .attr("class", "node" + (p.isCenter ? " center" : ""))
    .attr("transform", "translate(" + p.x + "," + p.y + ")");
  g.append("circle").attr("r", p.isCenter ? 14 : 10)
    .attr("fill", COLORS[n.toolkit] || "#888");
  g.append("text").attr("dy", p.isCenter ? 30 : 24).attr("text-anchor", "middle")
    .text(strip(p.id));
  g.append("title").text(p.id + "\\n" + n.name);
  if (!p.isCenter) g.on("click", function () { select(p.id); });
}

function drawEdge(parent, x1, y1, x2, y2, edge) {
  var g = parent.append("g");
  g.append("path")
    .attr("class", "link " + edge.confidence)
    .attr("d", "M" + x1 + "," + y1 + " L" + x2 + "," + y2)
    .attr("stroke-width", edge.confidence === "high" ? 2 : 1.4);
  var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  g.append("text").attr("class", "link-label")
    .attr("x", mx).attr("y", my - 4)
    .attr("text-anchor", "middle")
    .text(edge.via);
}
</script>
</body>
</html>
`;
