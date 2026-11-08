// Pure status derivation for lifecycle obligations. Everything is computed from stored dates and existing
// revision/review/decision state at a site-local "as of" date — no stored counters, no UI-only status.
import type { Session } from "../auth";
import { STAGES, type StageId } from "../requirements";
import { audiencesOf, ruleFor } from "../studio/access";
import type { Revision, Site } from "../types";
import { dayDiff, localDate } from "./clock";
import { CATEGORY_LABEL, isApplicable, PUBLISHABLE_TYPES, stageLabel } from "./register";
import { REQ_BY_ID } from "../requirements";
import { latestApproved } from "../release";
import type { LifecycleState, LifecycleView, Obligation, ObligationImpact, ObligationStatus, ObligationView } from "./types";

export const STATUS_ORDER: ObligationStatus[] = ["overdue", "needs_review", "due_soon", "awaiting_review", "open", "upcoming", "completed", "not_applicable"];
export const STATUS_LABEL: Record<ObligationStatus, string> = {
  overdue: "Overdue", needs_review: "Needs review (site change)", due_soon: "Due soon", awaiting_review: "Awaiting review",
  open: "Open", upcoming: "Upcoming", completed: "Completed", not_applicable: "Not yet applicable",
};
export const DISCLAIMER =
  "Obligations come from the EQORE README starting model and project configuration. ReleaseOS does not determine legal applicability, NFPA deadlines or maintenance frequencies; every due date shown is project-specific (synthetic in this demo). Statuses are documentation-tracking states, not compliance certifications.";

/** Stage the site was in on a given local date (from the recorded transitions). */
export function stageAsOf(site: Site, lc: LifecycleState, asOf: string): StageId {
  const tr = lc.stageHistory;
  if (!tr.length) return site.stage;
  let stage = tr[0].from;
  for (const t of tr) if (localDate(t.at, lc.timezone) <= asOf) stage = t.to;
  return stage;
}

const on = (iso: string | undefined, lc: LifecycleState, asOf: string) => !!iso && localDate(iso, lc.timezone) <= asOf;

export function approvedAsOf(site: Site, lc: LifecycleState, requirementId: string, asOf: string): Revision | undefined {
  return site.documents
    .filter((d) => d.requirementId === requirementId && d.status === "approved" && on(d.approvedAt ?? d.effectiveDate, lc, asOf))
    .sort((a, b) => b.version - a.version)[0];
}
export function pendingAsOf(site: Site, lc: LifecycleState, requirementId: string, asOf: string, after?: Revision): Revision | undefined {
  return site.documents
    .filter((d) => d.requirementId === requirementId && d.version > (after?.version ?? 0) && on(d.uploadedAt, lc, asOf))
    .filter((d) => !(d.status === "approved" && on(d.approvedAt, lc, asOf)) && !(d.status === "rejected" && on(d.rejectedAt ?? d.uploadedAt, lc, asOf)))
    .sort((a, b) => b.version - a.version)[0];
}
export function openImpactsAsOf(lc: LifecycleState, obligationId: string, asOf: string): ObligationImpact[] {
  return lc.impacts.filter((i) => i.obligationId === obligationId && on(i.raisedAt, lc, asOf) && (i.status === "open" || !on(i.resolvedAt, lc, asOf)));
}

export interface Evaluated { status: ObligationStatus; reason: string; nextAction: string; daysRemaining?: number; warningDays: number; doc?: Revision; pending?: Revision; impacts: ObligationImpact[] }

export function evaluateObligation(site: Site, lc: LifecycleState, ob: Obligation, asOf: string): Evaluated {
  const stage = stageAsOf(site, lc, asOf);
  const warningDays = ob.due?.warningDays ?? lc.warningDays;
  const doc = approvedAsOf(site, lc, ob.requirementId, asOf);
  const pending = pendingAsOf(site, lc, ob.requirementId, asOf, doc);
  const impacts = openImpactsAsOf(lc, ob.id, asOf);
  const base = { warningDays, doc, pending, impacts };
  const daysRemaining = ob.due ? dayDiff(asOf, ob.due.date) : undefined;
  const dueState = (): Evaluated | null => {
    if (!ob.due || daysRemaining === undefined) return null;
    if (daysRemaining < 0) return { ...base, daysRemaining, status: "overdue", reason: `Due ${ob.due.date} (${-daysRemaining} day(s) ago) with no verified completion`, nextAction: ob.kind === "record" ? "Record the event, attach evidence, and have an engineer verify it" : "Upload the document and have an engineer approve it" };
    if (daysRemaining <= warningDays) return { ...base, daysRemaining, status: "due_soon", reason: `Due ${ob.due.date} — in ${daysRemaining} day(s) (warning window ${warningDays} days)`, nextAction: ob.kind === "record" ? "Schedule/perform it, then record the event with evidence" : "Prepare and upload the document" };
    return { ...base, daysRemaining, status: "upcoming", reason: `Due ${ob.due.date} — in ${daysRemaining} day(s); outside the ${warningDays}-day warning window`, nextAction: "No action yet" };
  };

  if (!isApplicable(ob.stage, stage))
    return { ...base, daysRemaining, status: "not_applicable", reason: `Applies from ${stageLabel(ob.stage)}; the site is at ${stageLabel(stage)}`, nextAction: "None until the project reaches this stage" };
  if (impacts.length)
    return { ...base, daysRemaining, status: "needs_review", reason: `${impacts.length} confirmed site change(s) may affect it: ${impacts.map((i) => i.what).join("; ")}`, nextAction: "Engineer reviews; update and approve the document, or record a justified no-change decision" };

  if (ob.kind === "record") {
    const c = ob.completion;
    if (c && (!ob.due || c.forDueDate === ob.due.date) && on(c.verifiedAt, lc, asOf))
      return { ...base, daysRemaining, status: "completed", reason: `Verified by ${c.verifiedBy} on ${localDate(c.verifiedAt, lc.timezone)} against reviewed evidence`, nextAction: "Set the next project-specific due date when known" };
    const recorded = lc.events.filter((e) => e.obligationId === ob.id && !e.evidenceRevisionId && on(e.recordedAt, lc, asOf));
    const due = dueState();
    if (due?.status === "overdue") return recorded.length ? { ...due, reason: `${due.reason}; event recorded ${recorded[0].performedOn} awaits evidence review` } : due;
    if (recorded.length)
      return { ...base, daysRemaining, status: "awaiting_review", reason: `Event recorded for ${recorded[0].performedOn} by ${recorded[0].recordedBy}; not complete until an engineer verifies reviewed evidence (an upload is not proof)`, nextAction: "Upload the record as evidence, approve it, then verify completion" };
    return due ?? { ...base, status: "open", reason: "Required at this stage; no verified record yet and no due date configured", nextAction: "Configure a project-specific due date or record the event" };
  }

  if (doc)
    return { ...base, daysRemaining, status: "completed", reason: `Rev ${doc.revLabel} approved${doc.approvedBy ? ` by ${doc.approvedBy}` : ""}${doc.approvedAt ? ` on ${String(doc.approvedAt).slice(0, 10)}` : ""}${pending ? ` · Rev ${pending.revLabel} awaiting review` : ""}`, nextAction: pending ? `Review Rev ${pending.revLabel}` : "Keep current; re-review when a confirmed site change affects it" };
  if (pending)
    return { ...base, daysRemaining, status: "awaiting_review", reason: `Rev ${pending.revLabel} uploaded; not current until an engineer approves it`, nextAction: `Engineer reviews Rev ${pending.revLabel}` };
  return dueState() ?? { ...base, status: "open", reason: "Required at this stage; no approved document on file", nextAction: "Upload the document for engineer review" };
}

export function canViewObligation(s: Pick<Session, "role" | "engineer">, site: Site, ob: Obligation) {
  if (s.role === "eqore") return true;
  const rule = ruleFor(site, ob.requirementId);
  return audiencesOf(s).some((a) => rule.view.includes(a));
}

export function lifecycleView(site: Site, lc: LifecycleState, asOf: string, clock: "system" | "frozen", s: Pick<Session, "role" | "engineer">): LifecycleView {
  const eqore = s.role === "eqore";
  const counts = Object.fromEntries(STATUS_ORDER.map((k) => [k, 0])) as Record<ObligationStatus, number>;
  const rev = (r: Revision) => ({ id: r.id, revLabel: r.revLabel, status: r.status, approvedBy: r.approvedBy, approvedAt: r.approvedAt, sha256: r.sha256, href: `/sites/${site.id}/documents/${encodeURIComponent(r.id)}` });
  const obligations: ObligationView[] = lc.obligations
    .filter((ob) => canViewObligation(s, site, ob))
    .map((ob) => {
      const ev = evaluateObligation(site, lc, ob, asOf);
      counts[ev.status]++;
      const rule = ruleFor(site, ob.requirementId);
      return {
        id: ob.id, category: ob.category, categoryLabel: CATEGORY_LABEL[ob.category], requirementId: ob.requirementId, title: ob.title, kind: ob.kind,
        stage: ob.stage, stageLabel: stageLabel(ob.stage), status: ev.status, statusReason: ev.reason, source: ob.source, responsible: ob.responsible,
        reviewer: ob.reviewer, reviewTriggers: ob.reviewTriggers,
        due: ob.due ? { ...ob.due, daysRemaining: ev.daysRemaining ?? 0, warningDays: ev.warningDays, ...(eqore ? {} : { setById: "", note: "" }) } : undefined,
        currentRevision: ev.doc ? rev(ev.doc) : undefined,
        pendingRevision: ev.pending ? { id: ev.pending.id, revLabel: ev.pending.revLabel, href: rev(ev.pending).href } : undefined,
        completion: ob.completion && eqore ? ob.completion : ob.completion ? { ...ob.completion, note: "", verifiedById: "" } : undefined,
        openImpacts: eqore ? ev.impacts : ev.impacts.map((i) => ({ ...i, evidence: [], resolutionNote: undefined })),
        events: eqore ? lc.events.filter((e) => e.obligationId === ob.id) : [],
        access: { view: rule.view, releaseTo: rule.releaseTo, isDefault: rule.isDefault },
        createdAt: ob.createdAt, updatedAt: ob.updatedAt,
        history: eqore ? ob.history : undefined,
        nextAction: ev.nextAction,
        evidenceCandidates: eqore && ob.kind === "record"
          ? site.documents.filter((d) => d.requirementId === ob.requirementId && d.status === "approved" && !lc.events.some((e) => e.evidenceRevisionId === d.id)).sort((a, b) => b.version - a.version).map((d) => ({ id: d.id, revLabel: d.revLabel, fileName: d.fileName, approvedBy: d.approvedBy }))
          : undefined,
      };
    })
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  const stage = stageAsOf(site, lc, asOf);
  return {
    siteId: site.id, siteName: site.name, asOf, clock, timezone: lc.timezone, warningDays: lc.warningDays,
    stage, stageLabel: STAGES.find((x) => x.id === stage)?.label ?? stage,
    stageHistory: eqore ? lc.stageHistory : lc.stageHistory.map((t) => ({ ...t, note: "", byId: "" })),
    counts, obligations,
    changes: eqore ? lc.changes : [], impacts: eqore ? lc.impacts : [], publications: eqore ? lc.publications : [],
    publishCandidates: eqore
      ? PUBLISHABLE_TYPES.flatMap((rid) => { const d = latestApproved(site, rid); return d && !lc.publications.some((p) => p.status === "published" && p.revisionId === d.id) ? [{ revisionId: d.id, requirementId: rid, title: `${REQ_BY_ID[rid]?.name ?? rid} Rev ${d.revLabel}` }] : []; })
      : [],
    viewer: { role: s.role, restricted: !eqore },
    disclaimer: DISCLAIMER,
  };
}
