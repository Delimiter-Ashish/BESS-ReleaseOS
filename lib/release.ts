// ===== ReleaseOS engine (owner: Ashish) =====
// Pure functions over a Site + its releases. No I/O here — store.ts does mutations.
import { checksum, compareReleases as coreCompareReleases, type ReleaseComparison } from "@releaseos/release-core";
import { compareFacts } from "./intelligence";
import { REQ_BY_ID, REQUIREMENTS, TEMPLATE_BY_ID, type PackageTemplate } from "./requirements";
import { applicableItems, memoryAdvisories, memoryRequiredDocs, memorySource, requestedAt } from "./memory/readiness";
import type { IssueSource, PreSubmissionIssue } from "./memory/types";
import type { EngineeringTask, Fact, FactChange, Release, Revision, Site } from "./types";

export const byNewest = (a: Revision, b: Revision) => b.version - a.version;

export function revisionsOf(site: Site, requirementId: string) {
  return site.documents.filter((d) => d.requirementId === requirementId).sort(byNewest);
}
export function latestApproved(site: Site, requirementId: string) {
  return revisionsOf(site, requirementId).find((d) => d.status === "approved");
}
export function pendingRevision(site: Site, requirementId: string) {
  const approved = latestApproved(site, requirementId);
  return revisionsOf(site, requirementId).find(
    (d) => (d.status === "in_review" || d.status === "uploaded") && (!approved || d.version > approved.version),
  );
}
export function isSuperseded(site: Site, r: Revision) {
  const a = latestApproved(site, r.requirementId);
  return r.status === "approved" && !!a && a.id !== r.id;
}

/** Fact-level diff between two revisions (by canonical key). Unit-normalized and classified (material / cosmetic / informational). */
export function diffFacts(before: Fact[] = [], after: Fact[] = []): FactChange[] {
  return compareFacts(before, after);
}

/** Requirements that depend on `requirementId` (e.g. plan_set depends on switchgear_datasheet). */
export function dependentsOf(requirementId: string) {
  return REQUIREMENTS.filter((r) => r.dependsOn?.includes(requirementId)).map((r) => r.id);
}

export const openTasks = (site: Site, requirementId?: string): EngineeringTask[] =>
  (site.engTasks ?? []).filter((t) => t.status === "open" && (!requirementId || t.dependentRequirementId === requirementId));

/**
 * Engineering-review flags = OPEN dependency review tasks targeting this document (explicit records,
 * created deterministically from the dependency graph; resolved only by an authorized engineer).
 */
export function dependencyFlags(site: Site, requirementId: string): string[] {
  return openTasks(site, requirementId).map((t) => t.explanation);
}

export type ItemState = "ready" | "missing" | "in_review" | "pending_change" | "needs_eng_review";

export type ReadinessIssue = PreSubmissionIssue;

/** Who usually supplies a document type (shown as "responsible party" when nothing more specific is known). */
function docOwner(rid: string) {
  const stage = REQ_BY_ID[rid]?.stage;
  if (stage === "procurement") return "Supplier (requested by EQORE PM)";
  if (stage === "design") return "Engineer of record";
  return "EQORE project manager";
}

/**
 * Deterministic release gate (core semantics: pending reviews and open dependency tasks block signoff),
 * extended with the pre-submission check: CONFIRMED project-memory items add required documents and blockers.
 * AI suggestions (status "suggested") are returned as `advisories` and never block.
 */
export function packageReadiness(site: Site, template: PackageTemplate) {
  const issues: ReadinessIssue[] = [];
  const memDocs = memoryRequiredDocs(site, template.id);
  const required = [...template.required, ...Array.from(memDocs.keys()).filter((rid) => !template.required.includes(rid))];
  const items = required.map((rid) => {
    const name = REQ_BY_ID[rid]?.name ?? rid;
    const approved = latestApproved(site, rid);
    const pending = pendingRevision(site, rid);
    const tasks = openTasks(site, rid);
    const flags = tasks.map((t) => t.explanation);
    const asked = memDocs.get(rid) ?? [];
    const source: IssueSource = template.required.includes(rid)
      ? { kind: "package_template", label: `${template.name} checklist` }
      : memorySource(asked[0]);
    const owner = asked.find((m) => m.responsibleParty)?.responsibleParty ?? docOwner(rid);
    let state: ItemState = "ready";
    if (!approved) {
      state = pending ? "in_review" : "missing";
      issues.push(pending
        ? { code: "NO_APPROVED_VERSION", requirementId: rid, message: `${name}: Rev ${pending.revLabel} awaiting engineer review; no approved revision yet`, source, affectedDocument: name, responsibleParty: "EQORE engineer", nextAction: `Engineer: review and approve or reject ${name} Rev ${pending.revLabel}` }
        : { code: "MISSING_DOCUMENT", requirementId: rid, message: `${name}: required document is missing${source.kind === "project_memory" ? ` (requested: ${asked[0].title})` : ""}`, source, affectedDocument: name, responsibleParty: owner, nextAction: `Upload ${name} and file it for engineer review`, memoryItemId: asked[0]?.id });
    } else if (pending) {
      state = "pending_change";
      issues.push({ code: "PENDING_REVIEW", requirementId: rid, message: `${name}: Rev ${pending.revLabel} is pending engineer review (Rev ${approved.revLabel} remains the approved version)`, source, affectedDocument: name, responsibleParty: "EQORE engineer", nextAction: `Engineer: review ${name} Rev ${pending.revLabel}` });
    }
    for (const t of tasks) {
      if (state === "ready") state = "needs_eng_review";
      const src = REQ_BY_ID[t.sourceRequirementId]?.name ?? t.sourceRequirementId;
      issues.push({ code: "CHANGED_SOURCE", requirementId: rid, taskId: t.id, message: `${name}: dependency review open — ${src} changed (${t.changedKeys.join(", ")})`, source: { kind: "dependency_graph", label: `${name} depends on ${src}` }, affectedDocument: name, responsibleParty: "EQORE engineer", nextAction: `Engineer: confirm ${name} remains valid, or upload and approve a revised ${name}` });
    }
    // Confirmed requirements for this document: an UPDATED revision may be required, then explicit resolution.
    for (const m of asked.filter((x) => x.status === "confirmed")) {
      if (!approved) continue; // already reported above with the memory source
      const since = requestedAt(m);
      if (m.requiresUpdatedRevision && approved.uploadedAt < since) {
        if (state === "ready") state = "needs_eng_review";
        issues.push({ code: "OUTDATED_REVISION", requirementId: rid, memoryItemId: m.id, message: `${name}: approved Rev ${approved.revLabel} (uploaded ${approved.uploadedAt.slice(0, 10)}) predates the request of ${since.slice(0, 10)} for an updated version`, source: memorySource(m), affectedDocument: name, responsibleParty: m.responsibleParty ?? owner, nextAction: pending ? `Engineer: review ${name} Rev ${pending.revLabel}, then resolve the requirement` : `Upload an updated ${name} and file it for engineer review` });
      } else {
        if (state === "ready") state = "needs_eng_review";
        issues.push({ code: "REQUIREMENT_UNRESOLVED", requirementId: rid, memoryItemId: m.id, message: `${name}: Rev ${approved.revLabel} is approved — engineer must confirm it satisfies “${m.title}”`, source: memorySource(m), affectedDocument: name, responsibleParty: "EQORE engineer", nextAction: `Engineer: verify ${name} Rev ${approved.revLabel} against the request and resolve the requirement` });
      }
    }
    return { requirementId: rid, name, approved, pending, flags, tasks, state, requiredBy: asked.map((m) => m.id) };
  });
  // Confirmed memory items that are not satisfied by a document.
  for (const m of applicableItems(site, template.id).filter((x) => x.status === "confirmed" && !(x.kind === "requirement" && x.requirementId))) {
    const base = { memoryItemId: m.id, source: memorySource(m), responsibleParty: m.responsibleParty, requirementId: m.requirementId, affectedDocument: m.requirementId ? REQ_BY_ID[m.requirementId]?.name : undefined };
    const due = m.dueDate ? ` (due ${m.dueDate})` : "";
    if (m.kind === "requirement") issues.push({ ...base, code: "REQUIREMENT_UNRESOLVED", message: `Requirement not yet resolved: ${m.title}`, nextAction: "Engineer: verify the requirement is met and resolve it with a note", responsibleParty: m.responsibleParty ?? "EQORE engineer" });
    if (m.kind === "action_item") issues.push({ ...base, code: "OPEN_ACTION", message: `Open commitment${due}: ${m.title}`, nextAction: `${m.responsibleParty ?? "Owner"}: complete the action; EQORE marks it done with a note` });
    if (m.kind === "question") issues.push({ ...base, code: "OPEN_QUESTION", message: `Unanswered question: ${m.title}`, nextAction: `Answer the question${m.responsibleParty ? ` (${m.responsibleParty})` : ""} and record the answer` });
    if (m.kind === "decision" && m.decisionState === "pending") issues.push({ ...base, code: "OPEN_DECISION", message: `Decision pending${due}: ${m.title}`, nextAction: "Record the decision (EQORE) with a note" });
  }
  const blockers = items.filter((i) => i.state !== "ready");
  const flags = items.flatMap((i) => i.flags);
  const advisories = memoryAdvisories(site, template.id);
  const memory = applicableItems(site, template.id).map((m) => ({ i: m.id, s: m.status, r: m.resolvedRevisionId ?? null }));
  const token = checksum({ templateId: template.id, siteId: site.id, items: items.map((i) => ({ r: i.requirementId, a: i.approved?.id ?? null, p: i.pending?.id ?? null, t: i.tasks.map((t) => t.id) })), ...(memory.length ? { memory } : {}) });
  return { items, canBuild: issues.length === 0, blockers, flags, issues, advisories, token, readyCount: items.filter((i) => i.state === "ready").length };
}

export type ReleaseState = "current" | "pending_change" | "stale";

/** Is a built release still the right one to submit? */
export function releaseStatus(site: Site, release: Release): { state: ReleaseState; reasons: string[] } {
  const reasons: string[] = [];
  let state: ReleaseState = "current";
  for (const it of release.items) {
    const a = latestApproved(site, it.requirementId);
    if (a && a.id !== it.revisionId) {
      state = "stale";
      reasons.push(`${REQ_BY_ID[it.requirementId]?.name}: package has Rev ${it.revLabel}, Rev ${a.revLabel} approved ${String(a.approvedAt).slice(0, 10)} by ${a.approvedBy ?? "engineer"}`);
    }
  }
  if (state !== "stale") {
    for (const it of release.items) {
      const p = pendingRevision(site, it.requirementId);
      if (p) {
        state = "pending_change";
        reasons.push(`${REQ_BY_ID[it.requirementId]?.name}: Rev ${p.revLabel} uploaded ${p.uploadedAt}, awaiting engineer review`);
      }
    }
  }
  return { state, reasons };
}

export function latestRelease(releases: Release[], siteId: string, templateId: string) {
  return releases.filter((r) => r.siteId === siteId && r.templateId === templateId).sort((a, b) => b.number - a.number)[0];
}

/** R(n) vs R(n-1): which pinned documents changed, and how their facts changed. */
export function compareReleases(site: Site, prev: Release | undefined, next: Release) {
  return next.items.map((it) => {
    const old = prev?.items.find((p) => p.requirementId === it.requirementId);
    const changed = !old || old.revisionId !== it.revisionId;
    const before = old ? site.documents.find((d) => d.id === old.revisionId) : undefined;
    const after = site.documents.find((d) => d.id === it.revisionId);
    return {
      requirementId: it.requirementId,
      name: REQ_BY_ID[it.requirementId]?.name ?? it.requirementId,
      before: old,
      after: it,
      changed,
      factChanges: changed ? diffFacts(before?.facts, after?.facts) : [],
      approvedBy: after?.approvedBy,
      approvedAt: after?.approvedAt,
    };
  });
}

export function buildManifest(site: Site, release: Release, prev?: Release) {
  const t = TEMPLATE_BY_ID[release.templateId];
  return {
    package: t?.name ?? release.templateId,
    audience: t?.audience,
    site: { id: site.id, name: site.name, address: site.address, ahj: site.ahj, utility: site.utility },
    release: `R${release.number}`,
    builtAt: release.builtAt,
    builtBy: release.builtBy,
    note: release.note,
    status: "READY FOR ENGINEER SIGNOFF — not a certification of code compliance",
    items: release.items.map((i) => ({
      document: REQ_BY_ID[i.requirementId]?.name ?? i.requirementId,
      documentType: i.requirementId,
      revision: i.revLabel,
      file: i.fileName,
      sha256: i.sha256,
      approvedBy: i.approvedBy,
      approvedAt: i.approvedAt,
    })),
    openEngineeringFlags: release.openFlags,
    previousRelease: prev ? `R${prev.number}` : null,
    changesFromPrevious: prev
      ? compareReleases(site, prev, release)
          .filter((c) => c.changed)
          .map((c) => ({ document: c.name, from: c.before ? `Rev ${c.before.revLabel}` : null, to: `Rev ${c.after.revLabel}`, factChanges: c.factChanges.map((f) => `${f.label}: ${f.before ?? "—"} → ${f.after ?? "—"}`) }))
      : [],
    templateBasis: t?.basis,
  };
}

/** Frozen app revisions stored inside a release snapshot (lossless copies at build time). */
export function frozenRevisions(rel: Release): Revision[] {
  return ((rel.snapshot?.annotations?.revisions as Revision[] | undefined) ?? []);
}

/**
 * Historical comparison computed ONLY from two frozen snapshots — never from live data.
 * Uses release-core's compareReleases for the authoritative added/removed/updated sets.
 */
export function compareSnapshots(prev: Release, next: Release): { core: ReleaseComparison | null; docs: { requirementId: string; name: string; before?: Revision; after?: Revision; changed: boolean; factChanges: FactChange[] }[] } {
  const core = prev.snapshot && next.snapshot ? coreCompareReleases(prev.snapshot, next.snapshot) : null;
  const pr = frozenRevisions(prev), nr = frozenRevisions(next);
  const reqs = Array.from(new Set([...nr.map((r) => r.requirementId), ...pr.map((r) => r.requirementId)]));
  const docs = reqs.map((rid) => {
    const before = pr.find((r) => r.requirementId === rid), after = nr.find((r) => r.requirementId === rid);
    const changed = before?.id !== after?.id;
    return { requirementId: rid, name: REQ_BY_ID[rid]?.name ?? rid, before, after, changed, factChanges: changed ? compareFacts(before?.facts, after?.facts) : [] };
  });
  return { core, docs };
}
