"use client";
// Interactive evidence graph over GET /api/sites/:id/graph (Ashish's Project Guardian).
// Layout is a deterministic honeycomb per lane; traversal is BFS over the returned edges (lib/graph-traversal.ts).
// Nothing is inferred from position — every highlighted connection is a backend edge with its reason and evidence.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EvidenceButton } from "@/components/evidence/EvidenceProvider";
import { fetchGraph, type ApiResult } from "@/lib/api/client";
import { LANES, laneOf, pathTo, traverse, type Reach } from "@/lib/graph-traversal";
import type { EvidenceGraph as Graph, GraphNode, PreflightReport } from "@/lib/guardian/types";
import type { EvidenceRef } from "@/lib/workspace";
import type { RevisionEvidence } from "./evidence";

const R = 17; // hex radius
const ROW = 50;
const SUB = 64; // sub-column spacing inside a lane
const MAX_ROWS = 10;
const TOP = 46;

const TYPE_STYLE: Record<string, { fill: string; stroke: string; glyph: (n: GraphNode) => string; name: string }> = {
  communication: { fill: "#0e2a3a", stroke: "#22d3ee", glyph: () => "✉", name: "Communication" },
  memory_item: { fill: "#2a2410", stroke: "#fbbf24", glyph: () => "◆", name: "Requirement / decision" },
  document_family: { fill: "#131d31", stroke: "#64748f", glyph: () => "▭", name: "Document" },
  revision: { fill: "#0f2a2a", stroke: "#2dd4bf", glyph: (n) => n.label.match(/Rev (\w+)$/)?.[1] ?? "R", name: "Revision" },
  fact: { fill: "#161c33", stroke: "#818cf8", glyph: () => "ƒ", name: "Fact" },
  observation: { fill: "#161c33", stroke: "#818cf8", glyph: () => "ƒ", name: "Observation" },
  finding: { fill: "#2c1418", stroke: "#f87171", glyph: () => "!", name: "Finding" },
  engineering_task: { fill: "#24182f", stroke: "#a78bfa", glyph: () => "✎", name: "Engineer review" },
  review_task: { fill: "#24182f", stroke: "#a78bfa", glyph: () => "✎", name: "Review task" },
  decision: { fill: "#10241c", stroke: "#34d399", glyph: () => "✓", name: "Decision" },
  template: { fill: "#0f1c3a", stroke: "#60a5fa", glyph: () => "▤", name: "Package" },
  release: { fill: "#0f2433", stroke: "#38bdf8", glyph: () => "⛁", name: "Release" },
  site_change: { fill: "#2a1c10", stroke: "#fb923c", glyph: () => "Δ", name: "Site change" },
  impact: { fill: "#2a1c10", stroke: "#fb923c", glyph: () => "↻", name: "Lifecycle re-review" },
  obligation: { fill: "#1a1f2e", stroke: "#94a3b8", glyph: () => "◷", name: "Lifecycle obligation" },
};
const statusRing = (n: GraphNode) => {
  const s = String(n.data?.status ?? n.data?.class ?? "");
  if (/in_review|uploaded|suggested/.test(s)) return "#a78bfa";
  if (/open|confirmed|potential/.test(s)) return "#fbbf24";
  if (/rejected|verified_discrepancy/.test(s)) return "#f87171";
  return undefined;
};
const hexPath = (cx: number, cy: number, r: number) => Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i + Math.PI / 6; return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(" ");
const short = (s: string, n = 16) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default function EvidenceGraph({ site, byRev, report, focusId, onFocus }: { site: { id: string; name: string }; byRev: RevisionEvidence; report?: PreflightReport; focusId?: string; onFocus: (id?: string) => void }) {
  const [res, setRes] = useState<ApiResult<Graph>>();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"chain" | "graph" | "list">("chain");
  const [q, setQ] = useState("");
  const [zoom, setZoom] = useState(1);

  useEffect(() => { let live = true; setRes(undefined); fetchGraph(site.id).then((r) => live && setRes(r)); return () => { live = false; }; }, [site.id]);
  const g = res?.state === "ok" ? res.data : undefined;

  const visible = useMemo(() => (g ? g.nodes.filter((n) => !hidden.has(LANES[laneOf(n.type)]?.id ?? "")) : []), [g, hidden]);
  const layout = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    const laneX: { x: number; w: number; label: string; id: string; count: number }[] = [];
    let x = 30;
    for (const lane of LANES) {
      if (hidden.has(lane.id)) continue;
      const ns = visible.filter((n) => lane.types.includes(n.type)).sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : a.id < b.id ? -1 : 1));
      if (!ns.length) continue;
      const cols = Math.ceil(ns.length / MAX_ROWS);
      ns.forEach((n, i) => {
        const c = Math.floor(i / MAX_ROWS), r = i % MAX_ROWS;
        pos.set(n.id, { x: x + R + c * SUB, y: TOP + R + r * ROW + (c % 2 ? ROW / 2 : 0) });
      });
      const w = Math.max(170, (cols - 1) * SUB + 2 * R + 110);
      laneX.push({ x, w, label: lane.label, id: lane.id, count: ns.length });
      x += w;
    }
    const height = TOP + R * 2 + MAX_ROWS * ROW + ROW / 2;
    return { pos, laneX, width: x + 20, height };
  }, [visible, hidden]);

  const tr = useMemo(() => (g && focusId && g.nodes.some((n) => n.id === focusId) ? traverse(g, focusId, { skip: (n) => hidden.has(LANES[laneOf(n.type)]?.id ?? "") }) : undefined), [g, focusId, hidden]);
  const nodeById = useMemo(() => new Map((g?.nodes ?? []).map((n) => [n.id, n])), [g]);
  const up = new Set(tr?.upstream.map((r) => r.id)), down = new Set(tr?.downstream.map((r) => r.id));
  const matches = q ? new Set(visible.filter((n) => n.label.toLowerCase().includes(q.toLowerCase())).map((n) => n.id)) : undefined;

  if (!res) return <div className="card grid h-72 place-items-center text-sm text-slate-500"><span className="flex items-center gap-2"><span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />Loading evidence graph from the server…</span></div>;
  if (res.state !== "ok") return <div className="card p-6 text-sm"><div className="font-semibold text-slate-900">Evidence graph unavailable</div><div className="mt-1 text-slate-600">{res.state === "forbidden" ? "The graph contains internal EQORE records — sign in as an EQORE user." : res.error}. No graph is drawn because the server returned none.</div></div>;
  if (!g || g.nodes.length === 0) return <div className="card p-6 text-sm text-slate-500">The server returned an empty graph for this project.</div>;

  const focus = focusId ? nodeById.get(focusId) : undefined;
  const actions = focus ? (report?.findings ?? []).filter((f) => f.chain.some((c) => c.nodeId === focus.id) || f.affectedFiles.some((a) => `rev:${a.revisionId}` === focus.id)) : [];
  const nodeEvidence = (n: GraphNode, quote?: string): EvidenceRef | undefined => {
    if (n.type === "revision") { const b = byRev[n.id.slice(4)]; return b && (quote ? { ...b, key: `${b.key}|${quote}`, quote } : b); }
    if (n.type === "fact") { const revId = n.id.split(":")[1]; const b = byRev[revId]; const page = typeof n.data?.page === "number" ? n.data.page : undefined; return b && { ...b, key: `${n.id}`, page: page ?? b.page, quote: quote ?? b.quote, factLabel: n.label }; }
    if (n.type === "communication") return { key: n.id + (quote ?? ""), projectId: site.id, projectName: site.name, docName: "Communication", fileName: n.label, mediaType: "text/plain", quote, provenance: "Stored original communication", communication: { siteId: site.id, id: n.id.slice(4) } };
    return undefined;
  };
  const focusEvidence = focus ? nodeEvidence(focus, tr?.upstream.find((r) => r.via.evidence)?.via.evidence) : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs">
          {(["chain", "graph", "list"] as const).map((v) => <button key={v} type="button" onClick={() => setView(v)} data-testid={`graph-view-${v}`} className={`px-3 py-1.5 ${view === v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{v === "chain" ? "Focused chain" : v === "graph" ? "Full graph" : "Plain-language list"}</button>)}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a node…" className="min-w-[160px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm sm:flex-none" aria-label="Search graph nodes" />
        <div className="flex flex-wrap gap-1">
          {LANES.map((l) => {
            const n = g.nodes.filter((x) => l.types.includes(x.type)).length;
            if (!n) return null;
            const off = hidden.has(l.id);
            return <button key={l.id} type="button" onClick={() => setHidden((h) => { const s = new Set(h); if (off) s.delete(l.id); else s.add(l.id); return s; })} aria-pressed={!off} className={`rounded-full px-2.5 py-1 text-[11px] ring-1 ring-inset ${off ? "text-slate-400 ring-slate-200 line-through" : "bg-slate-100 text-slate-700 ring-slate-300"}`}>{l.label} {n}</button>;
          })}
        </div>
        {view === "graph" && <div className="ml-auto flex items-center gap-1 text-xs"><button type="button" className="btn-ghost !px-2 !py-1" onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))} aria-label="Zoom out">−</button><span className="w-10 text-center tabular-nums text-slate-500">{Math.round(zoom * 100)}%</span><button type="button" className="btn-ghost !px-2 !py-1" onClick={() => setZoom((z) => Math.min(1.8, z + 0.15))} aria-label="Zoom in">+</button></div>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {view === "chain" ? (
          <ChainView g={g} focusId={focusId} onFocus={onFocus} />
        ) : view === "graph" ? (
          <div className="card relative overflow-auto bg-night-900/80" style={{ maxHeight: 640 }}>
            <svg width={layout.width * zoom} height={layout.height * zoom} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={`Evidence graph for ${site.name}: ${g.nodes.length} records, ${g.edges.length} connections`} onClick={() => onFocus(undefined)}>
              <defs>
                <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#64748f" /></marker>
              </defs>
              {layout.laneX.map((l) => (
                <g key={l.id}>
                  <rect x={l.x - 8} y={8} width={l.w - 8} height={layout.height - 16} rx={14} fill="rgba(255,255,255,0.018)" stroke="rgba(148,163,184,0.07)" />
                  <text x={l.x} y={28} fill="#8b98b3" fontSize={10} fontWeight={600} letterSpacing="0.08em">{l.label.toUpperCase()} · {l.count}</text>
                </g>
              ))}
              {g.edges.map((e) => {
                const a = layout.pos.get(e.from), b = layout.pos.get(e.to);
                if (!a || !b) return null;
                const on = tr?.edgeIds.has(e.id);
                const isUp = on && (up.has(e.from) || up.has(e.to)) && !(down.has(e.from) || down.has(e.to));
                const color = on ? (isUp ? "#22d3ee" : "#fbbf24") : "#94a3b8";
                const mx = (a.x + b.x) / 2;
                return <path key={e.id} d={`M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`} fill="none" stroke={color} strokeOpacity={tr ? (on ? 0.9 : 0.04) : 0.16} strokeWidth={on ? 1.6 : 1} />;
              })}
              {visible.map((n) => {
                const p = layout.pos.get(n.id);
                if (!p) return null;
                const st = TYPE_STYLE[n.type] ?? TYPE_STYLE.document_family;
                const isFocus = n.id === focusId;
                const lit = !tr || tr.nodeIds.has(n.id);
                const hit = matches?.has(n.id);
                const ring = statusRing(n);
                return (
                  <g key={n.id} role="button" tabIndex={0} aria-label={`${st.name}: ${n.label}`} aria-pressed={isFocus}
                    onClick={(ev) => { ev.stopPropagation(); onFocus(isFocus ? undefined : n.id); }}
                    onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onFocus(isFocus ? undefined : n.id); } }}
                    style={{ cursor: "pointer", opacity: lit ? 1 : 0.14, transition: "opacity .25s" }}>
                    <title>{`${st.name}: ${n.label}${n.data?.status ? ` (${n.data.status})` : ""}`}</title>
                    {(isFocus || hit) && <polygon points={hexPath(p.x, p.y, R + 6)} fill="none" stroke={isFocus ? "#22d3ee" : "#fbbf24"} strokeWidth={1.5} strokeOpacity={0.8} />}
                    <polygon points={hexPath(p.x, p.y, R)} fill={st.fill} stroke={ring ?? st.stroke} strokeWidth={ring ? 2 : 1.3} strokeDasharray={n.data?.status === "suggested" ? "3 2" : undefined} />
                    <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={n.type === "revision" ? 11 : 12} fontWeight={700} fill={st.stroke}>{st.glyph(n)}</text>
                    <text x={p.x + R + 5} y={p.y + 3} fontSize={9.5} fill={lit && tr ? "#f1f4f9" : "#a8b3c8"}>{short(n.label.replace(/^(requirement|decision|action item|question): /i, ""), n.type === "revision" ? 17 : 18)}</text>
                  </g>
                );
              })}
            </svg>
            <div className="sticky bottom-0 left-0 flex flex-wrap gap-3 border-t border-slate-200 bg-night-900/95 px-3 py-2 text-[10px] text-slate-500">
              <span><span className="text-[#22d3ee]">━</span> upstream source</span><span><span className="text-[#fbbf24]">━</span> downstream impact</span>
              <span>Ring: <span className="text-[#a78bfa]">pending</span> · <span className="text-[#fbbf24]">open</span> · <span className="text-[#f87171]">rejected / discrepancy</span> · dashed = AI suggestion</span>
              <span>{g.nodes.length} records · {g.edges.length} connections · built {new Date(g.builtAt).toLocaleTimeString()}</span>
            </div>
          </div>
        ) : (
          <PlainList g={g} focusId={focusId} onFocus={onFocus} q={q} />
        )}

        <aside className="card flex max-h-[640px] min-h-[320px] flex-col overflow-hidden">
          {!focus ? (
            <div className="space-y-3 p-4 text-sm">
              <div className="font-semibold text-slate-900">Select any record</div>
              <p className="text-xs text-slate-500">Guardian highlights where it came from (<span className="text-[#22d3ee]">upstream</span>) and everything it affects (<span className="text-[#fbbf24]">downstream</span>) using breadth-first search over the server&apos;s connections. Unrelated records are dimmed.</p>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Good starting points</div>
              <ul className="space-y-1">
                {g.nodes.filter((n) => ["finding", "engineering_task", "memory_item", "communication"].includes(n.type) || (n.type === "revision" && n.data?.status === "in_review")).slice(0, 12).map((n) => (
                  <li key={n.id}><button type="button" onClick={() => onFocus(n.id)} className="w-full truncate rounded-md px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"><span style={{ color: TYPE_STYLE[n.type]?.stroke }}>{TYPE_STYLE[n.type]?.glyph(n)}</span> {n.label}</button></li>
                ))}
              </ul>
              <p className="text-[10px] text-slate-400">Direction rule: each edge type is read in one information-flow direction (source → requirement → document → revision → finding → review → package → release). See lib/graph-traversal.ts.</p>
            </div>
          ) : (
            <>
              <div className="border-b border-slate-200 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: TYPE_STYLE[focus.type]?.stroke }}>{TYPE_STYLE[focus.type]?.name}</div>
                <div className="mt-0.5 text-sm font-semibold text-slate-900">{focus.label}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                  {focus.data?.status ? <span>Status: {String(focus.data.status).replace(/_/g, " ")}</span> : null}
                  {focus.data?.class ? <span>Classification: {String(focus.data.class).replace(/_/g, " ")}</span> : null}
                  {focus.at && <span>{new Date(focus.at).toLocaleString()}</span>}
                  {typeof focus.data?.sha256 === "string" && <span className="font-mono">sha {String(focus.data.sha256).slice(0, 10)}…</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {focusEvidence && <EvidenceButton refs={focusEvidence} label="View original" />}
                  {focus.href && <Link href={focus.href} className="btn-ghost !py-1 !text-xs">Open source ↗</Link>}
                  <button type="button" onClick={() => onFocus(undefined)} className="text-xs text-slate-500 hover:text-slate-800">Clear</button>
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4 text-xs">
                {actions.length > 0 && (
                  <section>
                    <div className="mb-1 font-semibold text-slate-800">Next responsible action</div>
                    {actions.slice(0, 3).map((f) => <div key={f.id} className={`mb-1.5 rounded-lg p-2 ${f.blocking ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800"}`}><b>{f.responsibleRole ?? "Owner"}:</b> {f.nextAction}<div className="mt-0.5 text-[10px] opacity-80">{f.title}</div></div>)}
                  </section>
                )}
                {!report && <div className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-500">Run the Guardian Scan to see next actions linked to this record.</div>}
                <ReachList title="Upstream sources" tone="#22d3ee" items={tr?.upstream ?? []} nodes={nodeById} tr={tr} onFocus={onFocus} evidence={nodeEvidence} />
                <ReachList title="Downstream impact" tone="#fbbf24" items={tr?.downstream ?? []} nodes={nodeById} tr={tr} onFocus={onFocus} evidence={nodeEvidence} />
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function ReachList({ title, tone, items, nodes, tr, onFocus, evidence }: { title: string; tone: string; items: Reach[]; nodes: Map<string, GraphNode>; tr: ReturnType<typeof traverse> | undefined; onFocus: (id: string) => void; evidence: (n: GraphNode, quote?: string) => EvidenceRef | undefined }) {
  return (
    <section>
      <div className="mb-1 flex items-center gap-2 font-semibold text-slate-800"><span className="h-2 w-2 rounded-full" style={{ background: tone }} />{title} <span className="font-normal text-slate-400">({items.length})</span></div>
      {items.length === 0 ? <div className="text-slate-400">None in the graph.</div> : (
        <ol className="space-y-1.5">
          {items.slice(0, 30).map((r) => {
            const n = nodes.get(r.id)!;
            const ev = evidence(n, r.via.evidence);
            return (
              <li key={r.id} className="rounded-lg border border-slate-200 p-2">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => onFocus(r.id)} className="text-left font-medium text-slate-800 hover:text-cyan-600">{n.label}</button>
                  <span className="shrink-0 text-[10px] text-slate-400">{r.depth} step{r.depth > 1 ? "s" : ""}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500"><span className="font-mono text-[10px] text-slate-400">{r.via.type.replace(/_/g, " ")}</span> · {r.via.reason}</div>
                {r.via.evidence && <div className="mt-1 border-l-2 border-amber-400 pl-2 italic text-slate-700">“{r.via.evidence}”</div>}
                {r.depth > 1 && tr && <div className="mt-1 text-[10px] text-slate-400">via {pathTo(tr, r.id).slice(0, -1).map((p) => short(nodes.get(p.id)?.label ?? p.id, 22)).join(" → ")}</div>}
                {ev && <div className="mt-1"><EvidenceButton refs={ev} label="Evidence" /></div>}
              </li>
            );
          })}
          {items.length > 30 && <li className="text-slate-400">+{items.length - 30} more</li>}
        </ol>
      )}
    </section>
  );
}

const PHRASE: Record<string, string> = {
  proposes: "proposed", requires_document: "requires", applies_to: "applies to", revision_of: "is a revision of", states: "states", supersedes: "replaces",
  raised_by: "was raised by", targets: "asks an engineer to check", decided_by: "was decided by", resolved_by: "was resolved by", pins: "pins", satisfied_by: "is satisfied by",
  compares: "compares", gated_by: "is gated by", mentions: "mentions", requires: "requires", reviews: "reviews",
};
function PlainList({ g, focusId, onFocus, q }: { g: Graph; focusId?: string; onFocus: (id?: string) => void; q: string }) {
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const tr = focusId ? traverse(g, focusId) : undefined;
  const important = new Set(["proposes", "requires_document", "raised_by", "targets", "compares", "gated_by", "resolved_by", "satisfied_by", "pins", "supersedes", "applies_to", "mentions"]);
  const edges = g.edges.filter((e) => (tr ? tr.edgeIds.has(e.id) : important.has(e.type)) && (!q || `${nodes.get(e.from)?.label} ${nodes.get(e.to)?.label}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="card max-h-[640px] overflow-auto">
      <div className="sticky top-0 border-b border-slate-200 bg-night-800 px-4 py-2 text-xs text-slate-500">{tr ? `${edges.length} connections around the selected record` : `${edges.length} key connections (requirements, reviews, conflicts, releases)`}</div>
      <ul className="divide-y divide-slate-200">
        {edges.map((e) => (
          <li key={e.id} className="px-4 py-2.5 text-sm">
            <button type="button" onClick={() => onFocus(e.from)} className="font-medium text-slate-900 hover:text-cyan-600">{nodes.get(e.from)?.label}</button>{" "}
            <span className="text-slate-500">{PHRASE[e.type] ?? e.type}</span>{" "}
            <button type="button" onClick={() => onFocus(e.to)} className="font-medium text-slate-900 hover:text-cyan-600">{nodes.get(e.to)?.label}</button>
            <div className="text-[11px] text-slate-500">{e.reason}{e.at ? ` · ${new Date(e.at).toLocaleDateString()}` : ""}</div>
            {e.evidence && <div className="mt-0.5 text-[11px] italic text-slate-600">“{e.evidence}”</div>}
          </li>
        ))}
        {edges.length === 0 && <li className="p-6 text-center text-sm text-slate-500">No connections match.</li>}
      </ul>
    </div>
  );
}


/**
 * Focused evidence chain (default view). Built from the REAL graph: start at the selected record (or the first confirmed,
 * blocking requirement), run the same BFS as the full graph, and keep the nearest record per lane in information-flow
 * order. Nothing is inferred; a lane with no record is shown as an explicit gap only where the chain needs one.
 */
function ChainView({ g, focusId, onFocus }: { g: Graph; focusId?: string; onFocus: (id?: string) => void }) {
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const reqs = g.nodes.filter((n) => n.type === "memory_item" && /confirmed|resolved/.test(String(n.data?.status)) && g.edges.some((e) => e.type === "requires_document" && e.from === n.id));
  const fallback = reqs.find((n) => n.data?.blocking) ?? reqs[0] ?? g.nodes.find((n) => n.type === "finding") ?? g.nodes.find((n) => n.type === "engineering_task");
  const start = focusId && nodes.has(focusId) ? nodes.get(focusId)! : fallback;
  if (!start) return <div className="card p-6 text-sm text-slate-500">No requirement or finding to start a chain from. Use the full graph.</div>;
  const tr = traverse(g, start.id, { skip: (n) => n.type === "fact" || n.type === "observation" });
  const reach = new Map<string, Reach>([...tr.upstream, ...tr.downstream].map((r) => [r.id, r]));
  const SKIP = new Set(["facts", "obligations"]);
  const steps: { lane: string; node?: GraphNode; via?: Reach; gap?: string }[] = [];
  for (const lane of LANES) {
    if (SKIP.has(lane.id)) continue;
    if (lane.types.includes(start.type)) { steps.push({ lane: lane.label, node: start }); continue; }
    const best = Array.from(reach.values()).filter((r) => lane.types.includes(nodes.get(r.id)!.type))
      .sort((a, b) => a.depth - b.depth || String(nodes.get(b.id)!.at ?? "").localeCompare(String(nodes.get(a.id)!.at ?? "")))[0];
    if (best) steps.push({ lane: lane.label, node: nodes.get(best.id), via: best });
    else if (lane.id === "revs" && start.type === "memory_item") steps.push({ lane: lane.label, gap: "No revision on file — the required document is missing" });
  }
  return (
    <div className="card space-y-4 bg-night-900/80 p-4" data-testid="evidence-chain">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">Chain from</span>
        {reqs.slice(0, 4).map((n) => <button key={n.id} type="button" onClick={() => onFocus(n.id)} className={`rounded-full px-2.5 py-1 ring-1 ring-inset ${n.id === start.id ? "bg-[rgba(85,221,229,0.12)] text-[#a5f3fc] ring-[rgba(85,221,229,0.45)]" : "text-slate-600 ring-slate-300 hover:bg-slate-100"}`}>{n.label.replace(/^requirement: /i, "")}</button>)}
        {!reqs.some((n) => n.id === start.id) && <span className="rounded-full bg-[rgba(85,221,229,0.12)] px-2.5 py-1 text-[#a5f3fc] ring-1 ring-inset ring-[rgba(85,221,229,0.45)]">{start.label}</span>}
      </div>
      <ol className="flex flex-col gap-1 pb-1 lg:flex-row lg:flex-wrap lg:items-stretch lg:gap-y-3">
        {steps.map((st, i) => {
          const n = st.node;
          const style = n ? TYPE_STYLE[n.type] ?? TYPE_STYLE.document_family : undefined;
          const isFocus = n && n.id === (focusId ?? start.id);
          return (
            <li key={st.lane + i} className="ros-rise flex min-w-0 flex-col lg:w-[218px] lg:shrink-0 lg:flex-row" style={{ animationDelay: `${i * 70}ms` }}>
              <div className="flex min-w-0 flex-1 items-stretch lg:flex-row">
                {n ? (
                  <button type="button" onClick={() => onFocus(n.id)} data-testid="chain-step"
                    className={`min-w-0 flex-1 rounded-xl p-3 text-left ring-1 ring-inset transition hover:-translate-y-0.5 ${isFocus ? "bg-[rgba(85,221,229,0.08)] ring-[rgba(85,221,229,0.6)]" : "bg-[rgba(255,255,255,0.03)] ring-[rgba(148,163,184,0.18)] hover:ring-[rgba(85,221,229,0.4)]"}`}>
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: style!.stroke }}><span>{style!.glyph(n)}</span>{style!.name}</div>
                    <div className="mt-1 line-clamp-3 text-[13px] font-medium leading-snug text-ink [overflow-wrap:anywhere]" title={n.label}>{n.label.replace(/^(requirement|decision|action item|question): /i, "")}</div>
                    {n.data?.status ? <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-muted">{String(n.data.status).replace(/_/g, " ")}</div> : null}
                    {st.via?.via.evidence && <div className="mt-1.5 line-clamp-3 border-l-2 border-[#F1B56A] pl-2 text-[11px] italic text-ink-soft">“{st.via.via.evidence}”</div>}
                    {st.via && <div className="mt-1 line-clamp-2 text-[10px] text-ink-muted">{st.via.via.reason}</div>}
                  </button>
                ) : (
                  <div className="min-w-0 flex-1 rounded-xl border border-dashed border-[rgba(241,181,106,0.6)] p-3 text-left" data-testid="chain-gap">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#F1B56A]">{st.lane} · gap</div>
                    <div className="mt-1 text-[13px] font-medium text-[#fde68a]">{st.gap}</div>
                  </div>
                )}
              </div>
              {i < steps.length - 1 && <div aria-hidden className="grid place-items-center px-1 py-0.5 text-[#55DDE5] lg:py-0"><span className="rotate-90 lg:rotate-0">→</span></div>}
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] text-slate-500">Each step is the nearest connected record in the server&apos;s evidence graph ({g.nodes.length} records, {g.edges.length} connections). Click a step for its source and evidence; switch to the full graph for everything else.</p>
    </div>
  );
}
