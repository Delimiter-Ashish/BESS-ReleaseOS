// ===== ReleaseOS engine (owner: Ashish) =====
// Pure functions over a Site + its releases. No I/O here — store.ts does mutations.
import { REQ_BY_ID, REQUIREMENTS, TEMPLATE_BY_ID, type PackageTemplate } from "./requirements";
import type { Fact, FactChange, Release, Revision, Site } from "./types";

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

const fmt = (f?: Fact) => (f ? `${f.value}${f.unit ? ` ${f.unit}` : ""}` : undefined);
const norm = (s?: string) => (s ?? "").toLowerCase().replace(/[\s,]/g, "");

/** Fact-level diff between two revisions (by canonical key). */
export function diffFacts(before: Fact[] = [], after: Fact[] = []): FactChange[] {
  const keys = Array.from(new Set([...before.map((f) => f.key), ...after.map((f) => f.key)]));
  const out: FactChange[] = [];
  for (const k of keys) {
    const b = before.find((f) => f.key === k);
    const a = after.find((f) => f.key === k);
    if (b && a && norm(fmt(b)) === norm(fmt(a))) continue;
    out.push({ key: k, label: a?.label ?? b?.label ?? k, before: fmt(b), after: fmt(a), evidenceBefore: b?.evidence, evidenceAfter: a?.evidence, pageAfter: a?.page });
  }
  return out;
}

/** Requirements that depend on `requirementId` (e.g. plan_set depends on switchgear_datasheet). */
export function dependentsOf(requirementId: string) {
  return REQUIREMENTS.filter((r) => r.dependsOn?.includes(requirementId)).map((r) => r.id);
}

/**
 * Engineering-review flags: a document whose upstream dependency got a newer approved
 * revision AFTER this document's approval (e.g. new switchgear datasheet → plan set may need revision).
 */
export function dependencyFlags(site: Site, requirementId: string): string[] {
  const req = REQ_BY_ID[requirementId];
  const doc = latestApproved(site, requirementId);
  if (!req?.dependsOn || !doc) return [];
  const flags: string[] = [];
  for (const dep of req.dependsOn) {
    const d = latestApproved(site, dep);
    if (d && (d.approvedAt ?? "") > (doc.approvedAt ?? "") && d.version > 1) {
      flags.push(`${req.name} Rev ${doc.revLabel} predates ${REQ_BY_ID[dep].name} Rev ${d.revLabel} (approved ${String(d.approvedAt).slice(0, 10)}) — engineer to confirm or re-issue`);
    }
  }
  return flags;
}

export type ItemState = "ready" | "missing" | "in_review" | "needs_eng_review";

export function packageReadiness(site: Site, template: PackageTemplate) {
  const items = template.required.map((rid) => {
    const approved = latestApproved(site, rid);
    const pending = pendingRevision(site, rid);
    const flags = dependencyFlags(site, rid);
    let state: ItemState = "ready";
    if (!approved) state = pending ? "in_review" : "missing";
    else if (flags.length) state = "needs_eng_review";
    return { requirementId: rid, name: REQ_BY_ID[rid]?.name ?? rid, approved, pending, flags, state };
  });
  const blockers = items.filter((i) => i.state === "missing" || i.state === "in_review");
  const flags = items.flatMap((i) => i.flags);
  return { items, canBuild: blockers.length === 0, blockers, flags, readyCount: items.filter((i) => i.state === "ready").length };
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
