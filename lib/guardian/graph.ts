// Cross-source evidence graph (pure). Built on demand from the existing store records — no separate database.
// Node ids: com:, mem:, fam:, rev:, fact:, task:, rv:, dec:, tpl:, rel:, finding:. Every edge keeps the ids of the
// records that justify it, the evidence quote when it came from a source text, a timestamp and a reason.
import { PACKAGE_TEMPLATES, REQ_BY_ID } from "../requirements";
import type { Release, Site } from "../types";
import type { ConsistencyFinding, EdgeType, EvidenceGraph, GraphEdge, GraphNode } from "./types";

export const nid = {
  com: (id: string) => `com:${id}`, mem: (id: string) => `mem:${id}`, fam: (rid: string) => `fam:${rid}`, rev: (id: string) => `rev:${id}`,
  fact: (revId: string, key: string) => `fact:${revId}:${key}`, task: (id: string) => `task:${id}`, rv: (id: string) => `rv:${id}`, dec: (id: string) => `dec:${id}`,
  tpl: (id: string) => `tpl:${id}`, rel: (id: string) => `rel:${id}`, finding: (id: string) => `finding:${id}`,
};
export const hrefs = (siteId: string) => ({
  rev: (id: string, page?: number) => `/sites/${siteId}/documents/${encodeURIComponent(id)}${page ? `#p${page}` : ""}`,
  com: (id: string) => `/sites/${siteId}/memory#${id}`,
  mem: () => `/sites/${siteId}/memory`,
  rel: (id: string) => `/sites/${siteId}/releases/${encodeURIComponent(id)}`,
  tpl: (id: string) => `/sites/${siteId}/guardian?template=${id}`,
  task: () => `/sites/${siteId}#tasks`,
  finding: (id: string) => `/sites/${siteId}/guardian#${id}`,
});

const RELEVANT_FACTS = /^(rating\.|equipment\.model|equipment\.manufacturer|listing\.)/;

export function buildEvidenceGraph(site: Site, releases: Release[], findings: ConsistencyFinding[] = []): EvidenceGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const h = hrefs(site.id);
  const node = (n: GraphNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); };
  const edge = (type: EdgeType, from: string, to: string, reason: string, sourceIds: string[], extra: { evidence?: string; at?: string } = {}) => {
    if (nodes.has(from) && nodes.has(to)) edges.push({ id: `e${edges.length}`, type, from, to, reason, sourceIds, ...extra });
  };

  for (const t of PACKAGE_TEMPLATES) node({ id: nid.tpl(t.id), type: "template", label: t.name, href: h.tpl(t.id) });
  const fams = new Set([...site.documents.map((d) => d.requirementId), ...PACKAGE_TEMPLATES.flatMap((t) => t.required), ...(site.memory ?? []).flatMap((m) => (m.requirementId ? [m.requirementId] : []))]);
  fams.forEach((rid) => node({ id: nid.fam(rid), type: "document_family", label: REQ_BY_ID[rid]?.name ?? rid }));
  for (const t of PACKAGE_TEMPLATES) for (const rid of t.required) edge("requires", nid.tpl(t.id), nid.fam(rid), `${t.name} checklist`, [t.id]);

  // Revisions, their facts, supersession
  for (const r of site.documents) {
    node({ id: nid.rev(r.id), type: "revision", label: `${REQ_BY_ID[r.requirementId]?.name ?? r.requirementId} Rev ${r.revLabel}`, href: h.rev(r.id), at: r.uploadedAt, data: { status: r.status, fileName: r.fileName, sha256: r.sha256 } });
    edge("revision_of", nid.rev(r.id), nid.fam(r.requirementId), `Rev ${r.revLabel} (${r.status})`, [r.id], { at: r.uploadedAt });
    for (const f of r.facts.filter((x) => RELEVANT_FACTS.test(x.key) && x.evidence)) {
      node({ id: nid.fact(r.id, f.key), type: "fact", label: `${f.label}: ${f.value}${f.unit ? ` ${f.unit}` : ""}`, href: h.rev(r.id, f.page), data: { page: f.page, verified: !!f.evidenceVerified } });
      edge("states", nid.rev(r.id), nid.fact(r.id, f.key), `Stated${f.page ? ` on p.${f.page}` : ""}${f.evidenceVerified ? " (quote verified in text layer)" : ""}`, [r.id], { evidence: f.evidence });
    }
  }
  for (const rid of Array.from(fams)) {
    const approved = site.documents.filter((d) => d.requirementId === rid && d.status === "approved").sort((a, b) => a.version - b.version);
    for (let i = 1; i < approved.length; i++) edge("supersedes", nid.rev(approved[i].id), nid.rev(approved[i - 1].id), `Rev ${approved[i].revLabel} approved after Rev ${approved[i - 1].revLabel}`, [approved[i].id, approved[i - 1].id], { at: approved[i].approvedAt });
  }

  // Communications → memory items → documents / packages
  for (const c of site.communications ?? []) {
    node({ id: nid.com(c.id), type: "communication", label: `${c.subject ?? "(no subject)"} — ${c.sender}`, href: h.com(c.id), at: c.sentAt, data: { channel: c.channel, engine: c.analysis.engine } });
    for (const d of c.analysis.documentReferences) if (d.linkedRevisionId) edge("mentions", nid.com(c.id), nid.rev(d.linkedRevisionId), `Mentions ${d.reference}`, [c.id, d.linkedRevisionId], { evidence: d.evidence, at: c.sentAt });
  }
  for (const m of site.memory ?? []) {
    node({ id: nid.mem(m.id), type: "memory_item", label: `${m.kind.replace("_", " ")}: ${m.title}`, href: h.mem(), at: m.confirmedAt ?? m.createdAt, data: { status: m.status, blocking: m.blocking } });
    for (const s of m.sources) edge("proposes", nid.com(s.communicationId), nid.mem(m.id), `${m.origin === "openai" ? "AI" : m.origin} extraction${s.evidenceVerified ? " (quote verified)" : " (quote NOT verified)"}; status ${m.status}`, [s.communicationId, m.id], { evidence: s.evidence, at: s.sentAt });
    if (m.status === "dismissed" || m.status === "merged") continue;
    if (m.requirementId) edge("requires_document", nid.mem(m.id), nid.fam(m.requirementId), m.status === "suggested" ? "Suggested (not authoritative)" : `Confirmed by ${m.confirmedBy}`, [m.id], { at: m.confirmedAt });
    if (m.status !== "suggested") for (const t of m.templateIds) edge("applies_to", nid.mem(m.id), nid.tpl(t), m.blocking ? "Blocking for this package" : "Non-blocking", [m.id, t], { at: m.confirmedAt });
    if (m.resolvedRevisionId) edge("satisfied_by", nid.mem(m.id), nid.rev(m.resolvedRevisionId), `Resolved by ${m.resolvedBy}: ${m.resolutionNote ?? ""}`, [m.id, m.resolvedRevisionId], { at: m.resolvedAt });
  }

  // Review tasks, engineering tasks, decisions
  for (const d of site.decisions ?? []) {
    node({ id: nid.dec(d.id), type: "decision", label: `${d.kind.replace(/_/g, " ")}: ${d.decision} by ${d.reviewerName}`, at: d.at, data: { note: d.note, seeded: !!d.seeded } });
    if (d.revisionId) edge("decided_by", nid.rev(d.revisionId), nid.dec(d.id), d.note, [d.id, d.revisionId], { at: d.at });
  }
  for (const t of site.engTasks ?? []) {
    node({ id: nid.task(t.id), type: "engineering_task", label: `${t.kind === "consistency" ? "Consistency review" : "Dependency review"}: ${REQ_BY_ID[t.dependentRequirementId]?.name ?? t.dependentRequirementId} (${t.status})`, href: h.task(), at: t.createdAt, data: { status: t.status } });
    edge("raised_by", nid.task(t.id), nid.rev(t.sourceRevisionId), t.explanation, [t.id, t.sourceRevisionId], { at: t.createdAt });
    edge("targets", nid.task(t.id), t.dependentRevisionId ? nid.rev(t.dependentRevisionId) : nid.fam(t.dependentRequirementId), `Changed: ${t.changedKeys.join(", ") || "(see explanation)"}`, [t.id], { at: t.createdAt });
    if (t.resolvedByDecisionId) edge("resolved_by", nid.task(t.id), nid.dec(t.resolvedByDecisionId), t.resolutionNote ?? "resolved", [t.id, t.resolvedByDecisionId], { at: t.resolvedAt });
  }

  // Releases (frozen)
  for (const rel of releases) {
    node({ id: nid.rel(rel.id), type: "release", label: `${PACKAGE_TEMPLATES.find((t) => t.id === rel.templateId)?.name ?? rel.templateId} R${rel.number}`, href: h.rel(rel.id), at: rel.builtAt, data: { snapshotSha256: rel.snapshot?.sha256 } });
    edge("applies_to", nid.rel(rel.id), nid.tpl(rel.templateId), `Built by ${rel.builtBy}`, [rel.id], { at: rel.builtAt });
    for (const it of rel.items) edge("pins", nid.rel(rel.id), nid.rev(it.revisionId), `Pinned Rev ${it.revLabel} (sha256 ${it.sha256.slice(0, 12)}…)`, [rel.id, it.revisionId], { at: rel.builtAt });
  }

  // Cross-document findings
  for (const f of findings.filter((x) => x.class !== "consistent")) {
    node({ id: nid.finding(f.id), type: "finding", label: `${f.class.replace(/_/g, " ")}: ${f.quantity} ${f.a.display} vs ${f.b.display}`, href: h.finding(f.id), data: { class: f.class, view: f.view } });
    edge("compares", nid.finding(f.id), nid.rev(f.a.revisionId), `${f.a.display}${f.a.page ? ` (p.${f.a.page})` : ""} — ${f.a.contextReason}`, [f.id, f.a.revisionId], { evidence: f.a.evidence });
    edge("compares", nid.finding(f.id), nid.rev(f.b.revisionId), `${f.b.display}${f.b.page ? ` (p.${f.b.page})` : ""} — ${f.b.contextReason}`, [f.id, f.b.revisionId], { evidence: f.b.evidence });
    const t = (site.engTasks ?? []).find((x) => x.findingIds?.includes(f.id));
    if (t) edge("gated_by", nid.finding(f.id), nid.task(t.id), `Engineer review task (${t.status})`, [f.id, t.id]);
  }
  return { siteId: site.id, builtAt: new Date().toISOString(), nodes: Array.from(nodes.values()), edges };
}

/** Neighborhood of one node (for focused evidence views). */
export function neighborhood(g: EvidenceGraph, id: string, depth = 2): EvidenceGraph {
  const keep = new Set([id]);
  for (let d = 0; d < depth; d++) for (const e of g.edges) if (keep.has(e.from) || keep.has(e.to)) { keep.add(e.from); keep.add(e.to); }
  return { ...g, nodes: g.nodes.filter((n) => keep.has(n.id)), edges: g.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
}
