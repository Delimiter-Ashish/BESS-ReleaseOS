// Preflight simulator: "what are we forgetting before we submit this package?" Read-only.
// Blocking findings are EXACTLY the deterministic release gate (packageReadiness). Everything else — candidate-view
// consistency findings, AI reviews, unconfirmed suggestions, changes since the last release — is a warning or info.
import { REQ_BY_ID, TEMPLATE_BY_ID } from "../requirements";
import { latestApproved, latestRelease, packageReadiness, pendingRevision } from "../release";
import { CATEGORY_OF } from "../memory/types";
import type { Release, Revision, Site } from "../types";
import { aiAvailable, reviewFinding } from "./ai";
import { findConsistency } from "./consistency";
import { hrefs, nid } from "./graph";
import { timeMachine } from "./timemachine";
import type { ChainStep, ConsistencyFinding, EvidenceRef, FindingClass, PreflightFinding, PreflightReport } from "./types";

export async function runPreflight(site: Site, templateId: string, releases: Release[], opts: { ai?: boolean } = {}): Promise<PreflightReport> {
  const t = TEMPLATE_BY_ID[templateId];
  if (!t) throw new Error("unknown package");
  const h = hrefs(site.id);
  const ready = packageReadiness(site, t);
  const revById = new Map(site.documents.map((d) => [d.id, d]));
  const name = (rid: string) => REQ_BY_ID[rid]?.name ?? rid;
  const file = (r?: Revision) => (r ? [{ revisionId: r.id, requirementId: r.requirementId, fileName: r.fileName, revLabel: r.revLabel, href: h.rev(r.id) }] : []);
  const step = (nodeId: string, type: ChainStep["type"], label: string, href?: string, via?: string): ChainStep => ({ nodeId, type, label, href, via });
  const tplStep = step(nid.tpl(t.id), "template", t.name, h.tpl(t.id));
  const revStep = (r: Revision, via?: string, page?: number) => step(nid.rev(r.id), "revision", `${name(r.requirementId)} Rev ${r.revLabel}${page ? ` p.${page}` : ""} (${r.status.replace("_", " ")})`, h.rev(r.id, page), via);
  const findings: PreflightFinding[] = [];

  // 1) Blocking: the deterministic gate, explained with evidence.
  for (let n = 0; n < ready.issues.length; n++) {
    const i = ready.issues[n];
    const evidence: EvidenceRef[] = [];
    const affected: PreflightFinding["affectedFiles"] = [];
    let chain: ChainStep[] = [];
    const mem = i.memoryItemId ? (site.memory ?? []).find((m) => m.id === i.memoryItemId) : undefined;
    const task = i.taskId ? (site.engTasks ?? []).find((x) => x.id === i.taskId) : undefined;
    const approved = i.requirementId ? latestApproved(site, i.requirementId) : undefined;
    const pending = i.requirementId ? pendingRevision(site, i.requirementId) : undefined;
    if (mem) {
      for (const s of mem.sources) evidence.push({ kind: "communication", quote: s.evidence, verified: s.evidenceVerified, sourceId: s.communicationId, label: `${s.sender} · ${s.sentAt.slice(0, 10)}`, href: h.com(s.communicationId) });
      const s0 = mem.sources[0];
      chain = [
        ...(s0 ? [step(nid.com(s0.communicationId), "communication", `${s0.subject ?? "Communication"} — ${s0.sender}`, h.com(s0.communicationId))] : []),
        step(nid.mem(mem.id), "memory_item", `${mem.kind.replace("_", " ")}: ${mem.title} (confirmed by ${mem.confirmedBy ?? "?"})`, h.mem(), "proposes → confirmed"),
        ...(i.requirementId ? [approved ? revStep(approved, "requires document") : step(nid.fam(i.requirementId), "document_family", `${name(i.requirementId)} — none on file`, undefined, "requires document")] : []),
        { ...tplStep, via: "applies to" },
      ];
    } else if (task) {
      const src = revById.get(task.sourceRevisionId), dep = task.dependentRevisionId ? revById.get(task.dependentRevisionId) : undefined;
      for (const c of task.consistency ?? []) {
        const ra = revById.get(c.a.revisionId), rb = revById.get(c.b.revisionId);
        evidence.push({ kind: "document", quote: c.a.evidence, sourceId: c.a.revisionId, label: `${ra ? `${name(ra.requirementId)} Rev ${ra.revLabel}` : c.a.revisionId}${c.a.page ? ` p.${c.a.page}` : ""}: ${c.a.display}`, href: h.rev(c.a.revisionId, c.a.page), page: c.a.page });
        evidence.push({ kind: "document", quote: c.b.evidence, sourceId: c.b.revisionId, label: `${rb ? `${name(rb.requirementId)} Rev ${rb.revLabel}` : c.b.revisionId}${c.b.page ? ` p.${c.b.page}` : ""}: ${c.b.display}`, href: h.rev(c.b.revisionId, c.b.page), page: c.b.page });
      }
      evidence.push({ kind: "task", sourceId: task.id, label: `${task.id}: ${task.explanation.slice(0, 160)}`, href: h.task() });
      affected.push(...file(src), ...file(dep));
      const c0 = task.consistency?.[0];
      chain = [
        ...(src ? [revStep(src, undefined, c0?.a.revisionId === src.id ? c0.a.page : undefined)] : []),
        ...(c0 ? [step(nid.finding(c0.findingId), "finding", `${c0.quantity}: ${c0.a.display} vs ${c0.b.display}`, h.finding(c0.findingId), "cross-document check")] : []),
        step(nid.task(task.id), "engineering_task", `${task.kind === "consistency" ? "Consistency" : "Dependency"} review ${task.id} (open)`, h.task(), "raised"),
        ...(dep ? [revStep(dep, "targets", c0?.b.revisionId === dep.id ? c0.b.page : undefined)] : []),
        { ...tplStep, via: "in package" },
      ];
    } else {
      evidence.push({ kind: "checklist", sourceId: t.id, label: i.source?.label ?? `${t.name} checklist` });
      chain = [tplStep, ...(i.requirementId ? [pending ? revStep(pending, "awaiting review") : approved ? revStep(approved, "requires") : step(nid.fam(i.requirementId), "document_family", `${name(i.requirementId)} — none on file`, undefined, "requires")] : [])];
    }
    if (!affected.length) affected.push(...file(pending), ...file(approved));
    findings.push({
      id: `PF-${n + 1}`, category: CATEGORY_OF[i.code], severity: "blocker", blocking: true,
      title: i.message, detail: i.source ? `${i.source.label}` : "", evidence, affectedFiles: affected,
      responsibleRole: i.responsibleParty, nextAction: i.nextAction ?? "Resolve before signoff", chain,
    });
  }

  // 2) Cross-document consistency on the CANDIDATE set (pending revisions included), scoped to this package.
  const scope = new Set(ready.items.map((x) => x.requirementId));
  const cand = findConsistency(site, { view: "candidate", scope });
  const gated = new Set((site.engTasks ?? []).filter((x) => x.status !== "superseded").flatMap((x) => x.findingIds ?? []));
  let ai: PreflightReport["consistency"]["ai"] = "off";
  let aiNote: string | undefined;
  const reviewable = cand.findings.filter((f) => ["verified_discrepancy", "potential_inconsistency", "insufficient_evidence"].includes(f.class)).slice(0, 4);
  if (opts.ai) {
    if (!aiAvailable()) { ai = "unavailable"; aiNote = "OpenAI is not configured (AI_PROVIDER/OPENAI_API_KEY); deterministic results only."; }
    else {
      ai = "openai";
      for (const f of reviewable) {
        try { f.aiReview = await reviewFinding(f, revById); }
        catch (e) { aiNote = `AI review failed for ${f.id}: ${(e as Error).message.slice(0, 160)} — deterministic result shown.`; }
      }
    }
  }
  for (const f of cand.findings.filter((x) => x.class !== "consistent")) {
    const task = (site.engTasks ?? []).find((x) => x.findingIds?.includes(f.id) && x.status !== "superseded");
    if (task?.status === "open") { f.taskId = task.id; f.taskStatus = "open"; continue; } // already reported as a blocker above
    if (task) { f.taskId = task.id; f.taskStatus = task.status; }
    const ra = revById.get(f.a.revisionId)!, rb = revById.get(f.b.revisionId)!;
    const pendingSide = [ra, rb].find((r) => r.status !== "approved");
    const sev = consistencySeverity(f.class, !!task);
    findings.push({
      id: f.id, category: "consistency", severity: sev, blocking: false, consistencyClass: f.class,
      title: consistencyTitle(f, pendingSide, task?.status),
      detail: `${f.reason} Relation: ${f.relation}.${f.aiReview ? ` AI review (${f.aiReview.model}, advisory): same equipment ${f.aiReview.sameEquipment}, same interface ${f.aiReview.sameInterface}, suggests ${f.aiReview.suggestedClass.replace(/_/g, " ")}${f.aiReview.disagrees ? " — DISAGREES with the deterministic check; engineer to decide" : ""}. ${f.aiReview.explanation}` : ""}`,
      evidence: [obsRef(f, "a", h), obsRef(f, "b", h)],
      affectedFiles: [...file(ra), ...file(rb)],
      responsibleRole: f.class === "verified_discrepancy" || f.class === "potential_inconsistency" ? "EQORE engineer" : undefined,
      nextAction: consistencyAction(f, pendingSide, task?.status),
      chain: [revStep(ra, undefined, f.a.page), step(nid.finding(f.id), "finding", f.class.replace(/_/g, " "), h.finding(f.id), f.relation), revStep(rb, "compared with", f.b.page), ...(task ? [step(nid.task(task.id), "engineering_task", `Review ${task.id} (${task.status})`, h.task(), "gated by")] : []), { ...tplStep, via: "in package" }],
    });
    void gated;
  }

  // 3) Unconfirmed suggestions (advisory) and changes since the last release.
  for (const adv of ready.advisories) {
    const m = (site.memory ?? []).find((x) => x.id === adv.memoryItemId);
    findings.push({ id: `ADV-${adv.memoryItemId}`, category: "requirement", severity: "info", blocking: false, title: adv.message, detail: "AI/rules suggestions never block until a person confirms them.", evidence: (m?.sources ?? []).map((s) => ({ kind: "communication" as const, quote: s.evidence, verified: s.evidenceVerified, sourceId: s.communicationId, label: `${s.sender} · ${s.sentAt.slice(0, 10)}`, href: h.com(s.communicationId) })), affectedFiles: [], responsibleRole: "EQORE project manager", nextAction: "Confirm or dismiss the suggestion on the Project memory page", chain: m ? [step(nid.com(m.sources[0]?.communicationId ?? ""), "communication", m.sources[0]?.sender ?? "source", h.com(m.sources[0]?.communicationId ?? "")), step(nid.mem(m.id), "memory_item", `suggested: ${m.title}`, h.mem(), "proposes")] : [] });
  }
  const last = latestRelease(releases, site.id, t.id);
  if (last?.snapshot) {
    const tm = timeMachine(site, last);
    for (const r of tm.replacedDocuments) {
      const cur = r.currentRevisionId ? revById.get(r.currentRevisionId) : undefined;
      const material = r.factChanges.filter((c) => c.significance === "material");
      findings.push({ id: `CHG-${r.requirementId}-${r.currentStatus}`, category: "change_since_release", severity: r.currentStatus === "approved" ? "warning" : "info", blocking: false, title: `${r.name}: R${last.number} pins Rev ${r.releasedRev}; Rev ${r.currentRev} is ${r.currentStatus === "approved" ? "now approved" : "pending review"}`, detail: material.length ? `Material changes: ${material.map((c) => `${c.label} ${c.before ?? "—"} → ${c.after ?? "—"}`).join("; ")}` : "No material fact changes detected.", evidence: [{ kind: "release", sourceId: last.id, label: `R${last.number} pinned Rev ${r.releasedRev} (sha256 ${r.releasedSha256.slice(0, 12)}…)`, href: h.rel(last.id) }], affectedFiles: file(cur), responsibleRole: "EQORE engineer", nextAction: r.currentStatus === "approved" ? `Build R${last.number + 1} so the submission carries Rev ${r.currentRev}` : `Review Rev ${r.currentRev}`, chain: [step(nid.rel(last.id), "release", `${t.name} R${last.number} (frozen)`, h.rel(last.id)), ...(cur ? [revStep(cur, "newer revision")] : [])] });
    }
    for (const d of tm.addedChecklistDocuments) findings.push({ id: `CHG-add-${d.requirementId}`, category: "change_since_release", severity: "info", blocking: false, title: `${d.name} is required now but was not in R${last.number}`, detail: d.reason, evidence: [{ kind: "release", sourceId: last.id, label: `R${last.number} (frozen)`, href: h.rel(last.id) }], affectedFiles: file(latestApproved(site, d.requirementId)), nextAction: `Include it in R${last.number + 1}`, chain: [step(nid.rel(last.id), "release", `R${last.number}`, h.rel(last.id)), tplStep] });
  }

  const byClass = Object.fromEntries((["verified_discrepancy", "potential_inconsistency", "explained_difference", "consistent", "insufficient_evidence"] as FindingClass[]).map((c) => [c, cand.findings.filter((f) => f.class === c).length])) as Record<FindingClass, number>;
  const order = { blocker: 0, warning: 1, info: 2 } as const;
  findings.sort((x, y) => order[x.severity] - order[y.severity]);
  return {
    siteId: site.id, templateId: t.id, templateName: t.name, ranAt: new Date().toISOString(),
    canBuild: ready.canBuild, token: ready.token, findings,
    counts: { blocker: findings.filter((f) => f.severity === "blocker").length, warning: findings.filter((f) => f.severity === "warning").length, info: findings.filter((f) => f.severity === "info").length },
    consistency: { checkedPairs: cand.checkedPairs, byClass, ai, aiNote },
    lastRelease: last ? { id: last.id, number: last.number, builtAt: last.builtAt } : undefined,
  };
}

function consistencySeverity(c: FindingClass, reviewed: boolean): PreflightFinding["severity"] {
  if (reviewed) return "info";
  return c === "verified_discrepancy" || c === "potential_inconsistency" ? "warning" : "info";
}
function consistencyTitle(f: ConsistencyFinding, pending: Revision | undefined, taskStatus?: string) {
  const what = `${f.quantity}: ${f.a.display} (${REQ_BY_ID[f.a.requirementId]?.name} Rev ${f.a.revLabel}) vs ${f.b.display} (${REQ_BY_ID[f.b.requirementId]?.name} Rev ${f.b.revLabel})`;
  if (taskStatus === "resolved") return `Reviewed by an engineer — ${what}`;
  switch (f.class) {
    case "verified_discrepancy": return `${pending ? `If Rev ${pending.revLabel} is approved: ` : ""}verified discrepancy requiring review — ${what}`;
    case "potential_inconsistency": return `Potential inconsistency (investigate) — ${what}`;
    case "explained_difference": return `Explained difference, no conflict — ${what}`;
    default: return `Insufficient evidence to compare — ${what}`;
  }
}
function consistencyAction(f: ConsistencyFinding, pending: Revision | undefined, taskStatus?: string) {
  if (taskStatus === "resolved") return "No action — resolved by an engineer (see the task resolution note)";
  if (f.class === "verified_discrepancy") return pending ? `Engineer: when reviewing ${REQ_BY_ID[pending.requirementId]?.name} Rev ${pending.revLabel}, decide which value is correct; approval will open a review task on the other document` : "Engineer: decide which value is correct and re-issue the outdated document";
  if (f.class === "potential_inconsistency") return "Engineer: check both documents and record a decision";
  if (f.class === "explained_difference") return "None — shown so reviewers can see why this is not a conflict";
  return "Optional: clarify which equipment the value refers to";
}
function obsRef(f: ConsistencyFinding, side: "a" | "b", h: ReturnType<typeof hrefs>): EvidenceRef {
  const o = f[side];
  return { kind: "document", quote: o.evidence, verified: o.evidenceVerified, sourceId: o.revisionId, label: `${REQ_BY_ID[o.requirementId]?.name} Rev ${o.revLabel}${o.page ? ` p.${o.page}` : ""} · ${o.display} · ${o.equipment}${o.identifiers.length ? ` ${o.identifiers.join("/")}` : ""}${o.side ? ` · ${o.side}` : ""} · ${o.evidenceKind === "text_layer" ? "PDF text" : "recorded fact"}`, href: h.rev(o.revisionId, o.page), page: o.page };
}
