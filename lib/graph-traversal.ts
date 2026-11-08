// Deterministic traversal over the Guardian evidence graph (pure; client- and server-safe).
// Uses ONLY the nodes/edges returned by GET /api/sites/:id/graph. No edges are inferred.
//
// The backend stores each edge in its natural grammatical direction ("task raised_by revision", "release pins revision").
// For impact analysis we read every edge type in ONE consistent "information flow" direction:
//   source evidence → requirement → document → revision → finding → review → decision / package → release.
// FLOW lists, per edge type, whether that flow runs from→to ("forward") or to→from ("reverse").
import type { EdgeType, EvidenceGraph, GraphEdge, GraphNode, NodeType } from "./guardian/types";

export const FLOW: Record<EdgeType, "forward" | "reverse"> = {
  mentions: "forward", // communication → revision it mentions
  proposes: "forward", // communication → memory item
  requires_document: "forward", // requirement → document family
  applies_to: "forward", // memory item → package; release → package (see special case below)
  revision_of: "forward", // revision → its document family
  states: "forward", // revision → fact
  supersedes: "reverse", // older approved revision → newer one
  raised_by: "reverse", // source revision → engineering task
  targets: "forward", // engineering task → dependent document
  decided_by: "forward", // revision → decision
  resolved_by: "forward", // task → decision
  pins: "reverse", // revision → release that pins it
  satisfied_by: "reverse", // revision → requirement it satisfies
  compares: "reverse", // revision → finding that compares it
  gated_by: "forward", // finding → review task
  reviews: "forward",
  requires: "reverse", // document family → package that requires it
};

export interface FlowEdge { edge: GraphEdge; src: string; dst: string }

export function flowEdges(g: EvidenceGraph): FlowEdge[] {
  const type = new Map(g.nodes.map((n) => [n.id, n.type]));
  return g.edges.map((e) => {
    let dir = FLOW[e.type] ?? "forward";
    // A release is an OUTPUT of its package: package → release.
    if (e.type === "applies_to" && type.get(e.from) === "release") dir = "reverse";
    return dir === "forward" ? { edge: e, src: e.from, dst: e.to } : { edge: e, src: e.to, dst: e.from };
  });
}

export interface Reach { id: string; depth: number; via: GraphEdge; parent: string }
export interface Traversal { focus: string; upstream: Reach[]; downstream: Reach[]; edgeIds: Set<string>; nodeIds: Set<string> }

/** Breadth-first search in both directions from `focus`. Neighbours are visited in sorted id order, so results are deterministic. */
export function traverse(g: EvidenceGraph, focus: string, opts: { maxDepth?: number; skip?: (n: GraphNode) => boolean } = {}): Traversal {
  const maxDepth = opts.maxDepth ?? 6;
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const fe = flowEdges(g);
  const out = new Map<string, FlowEdge[]>(), inc = new Map<string, FlowEdge[]>();
  for (const f of fe) {
    (out.get(f.src) ?? out.set(f.src, []).get(f.src)!).push(f);
    (inc.get(f.dst) ?? inc.set(f.dst, []).get(f.dst)!).push(f);
  }
  const sortBy = (k: (f: FlowEdge) => string) => (a: FlowEdge, b: FlowEdge) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : a.edge.id < b.edge.id ? -1 : 1);
  const edgeIds = new Set<string>();
  const bfs = (adj: Map<string, FlowEdge[]>, next: (f: FlowEdge) => string) => {
    const seen = new Set([focus]);
    const res: Reach[] = [];
    let frontier = [focus];
    for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
      const nf: string[] = [];
      for (const id of frontier) {
        for (const f of (adj.get(id) ?? []).slice().sort(sortBy(next))) {
          const n = next(f);
          const node = nodes.get(n);
          if (!node || (opts.skip && opts.skip(node))) continue;
          edgeIds.add(f.edge.id);
          if (seen.has(n)) continue;
          seen.add(n);
          res.push({ id: n, depth, via: f.edge, parent: id });
          nf.push(n);
        }
      }
      frontier = nf;
    }
    return res;
  };
  const downstream = bfs(out, (f) => f.dst);
  const upstream = bfs(inc, (f) => f.src);
  return { focus, upstream, downstream, edgeIds, nodeIds: new Set([focus, ...upstream.map((r) => r.id), ...downstream.map((r) => r.id)]) };
}

/** Path from the focus to `target` following BFS parents (for "why is this connected?"). */
export function pathTo(t: Traversal, target: string): Reach[] {
  const all = new Map([...t.upstream, ...t.downstream].map((r) => [r.id, r]));
  const path: Reach[] = [];
  let cur = all.get(target);
  while (cur) { path.unshift(cur); cur = cur.parent === t.focus ? undefined : all.get(cur.parent); }
  return path;
}

/** Visual lanes, left → right, following the information-flow direction. */
export const LANES: { id: string; label: string; types: NodeType[] }[] = [
  { id: "sources", label: "Communications", types: ["communication"] },
  { id: "memory", label: "Requirements", types: ["memory_item"] },
  { id: "docs", label: "Documents", types: ["document_family"] },
  { id: "revs", label: "Revisions", types: ["revision"] },
  { id: "facts", label: "Facts", types: ["fact", "observation"] },
  { id: "findings", label: "Findings", types: ["finding"] },
  { id: "reviews", label: "Reviews", types: ["engineering_task", "review_task"] },
  { id: "decisions", label: "Decisions", types: ["decision"] },
  { id: "packages", label: "Packages", types: ["template"] },
  { id: "releases", label: "Releases", types: ["release"] },
];
export const laneOf = (t: NodeType) => LANES.findIndex((l) => l.types.includes(t));
