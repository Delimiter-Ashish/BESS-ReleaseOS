// ===== ReleaseOS engine (owner: Ashish) =====
// Pure functions over a Site + its releases. No I/O here — store.ts does mutations.
import { checksum, compareReleases as coreCompareReleases, type ReleaseComparison } from "@releaseos/release-core";
import { compareFacts } from "./intelligence";
import { REQ_BY_ID, REQUIREMENTS, TEMPLATE_BY_ID, type PackageTemplate } from "./requirements";
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

export interface ReadinessIssue { code: "MISSING_DOCUMENT" | "NO_APPROVED_VERSION" | "PENDING_REVIEW" | "CHANGED_SOURCE"; requirementId: string; message: string; taskId?: string }

/** Deterministic release gate (core semantics: pending reviews and open dependency tasks block signoff). */
export function packageReadiness(site: Site, template: PackageTemplate) {
  const issues: ReadinessIssue[] = [];
  const items = template.required.map((rid) => {
    const name = REQ_BY_ID[rid]?.name ?? rid;
    const approved = latestApproved(site, rid);
    const pending = pendingRevision(site, rid);
    const tasks = openTasks(site, rid);
    const flags = tasks.map((t) => t.explanation);
    let state: ItemState = "ready";
    if (!approved) {
      state = pending ? "in_review" : "missing";
      issues.push(pending ? { code: "NO_APPROVED_VERSION", requirementId: rid, message: `${name}: Rev ${pending.revLabel} awaiting engineer review; no approved revision yet` } : { code: "MISSING_DOCUMENT", requirementId: rid, message: `${name}: required document is missing` });
    } else if (pending) {
      state = "pending_change";
      issues.push({ code: "PENDING_REVIEW", requirementId: rid, message: `${name}: Rev ${pending.revLabel} is pending engineer review (Rev ${approved.revLabel} remains the approved version)` });
    }
    for (const t of tasks) {
      if (state === "ready") state = "needs_eng_review";
      issues.push({ code: "CHANGED_SOURCE", requirementId: rid, taskId: t.id, message: `${name}: dependency review open — ${REQ_BY_ID[t.sourceRequirementId]?.name ?? t.sourceRequirementId} changed (${t.changedKeys.join(", ")})` });
    }
    return { requirementId: rid, name, approved, pending, flags, tasks, state };
  });
  const blockers = items.filter((i) => i.state !== "ready");
  const flags = items.flatMap((i) => i.flags);
  const token = checksum({ templateId: template.id, siteId: site.id, items: items.map((i) => ({ r: i.requirementId, a: i.approved?.id ?? null, p: i.pending?.id ?? null, t: i.tasks.map((t) => t.id) })) });
  return { items, canBuild: blockers.length === 0, blockers, flags, issues, token, readyCount: items.filter((i) => i.state === "ready").length };
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
