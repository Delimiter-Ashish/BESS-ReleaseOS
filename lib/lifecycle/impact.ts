// Change → impacted obligation assessment (pure, deterministic). Runs only for HUMAN-CONFIRMED site changes.
// Which obligations are candidates comes from the existing requirement model's change triggers
// (lib/requirements.ts, from the EQORE README "update when…" column). Evidence comes from the current approved
// revision's own text: if it still names the replaced equipment, the quote and page are attached.
// Output is a review request for an engineer — never a finding of noncompliance.
import { CHANGE_LABEL, REQ_BY_ID, type ChangeType } from "../requirements";
import { latestApproved } from "../release";
import { classifyLines } from "../sections";
import type { Site } from "../types";
import { isApplicable, stageLabel } from "./register";
import type { ChangeKind, ImpactEvidence, LifecycleState, ObligationImpact, SiteChange } from "./types";

export const CHANGE_KINDS: { id: ChangeKind; base: ChangeType; label: string; equipment: boolean }[] = [
  { id: "inverter_replace", base: "inverter_replace", label: CHANGE_LABEL.inverter_replace, equipment: true },
  { id: "add_modules", base: "add_modules", label: CHANGE_LABEL.add_modules, equipment: true },
  { id: "setpoint_change", base: "setpoint_change", label: CHANGE_LABEL.setpoint_change, equipment: false },
  { id: "occupancy_change", base: "occupancy_change", label: CHANGE_LABEL.occupancy_change, equipment: false },
  { id: "contact_change", base: "contact_change", label: CHANGE_LABEL.contact_change, equipment: false },
  // Like-for-like replacement of a monitoring/metering device is recorded as a repair (maintenance action).
  { id: "monitoring_device_replace", base: "maintenance_action", label: "Monitoring / metering device replaced like-for-like (no change to power equipment)", equipment: true },
];
export const CHANGE_KIND_BY_ID = Object.fromEntries(CHANGE_KINDS.map((k) => [k.id, k])) as Record<ChangeKind, (typeof CHANGE_KINDS)[number]>;

const squash = (s: string) => s.toLowerCase().replace(/[‘’“”"'`]/g, "").replace(/\s+/g, " ").trim();

/** Search terms for the replaced item: the full identifier plus model-number-like tokens (e.g. "MPS125"). */
export function searchTerms(from?: string): string[] {
  if (!from) return [];
  const full = squash(from);
  const tokens = full.split(/[\s,;()]+/).filter((t) => t.length >= 4 && /\d/.test(t) && /[a-z]/.test(t));
  return Array.from(new Set([full, ...tokens])).filter((t) => t.length >= 3);
}

/** Lines of the current text (revision-history rows excluded) that mention the replaced item. */
export function findEvidence(pages: string[], from: string | undefined, rev: { id: string; revLabel: string }, max = 3): ImpactEvidence[] {
  const terms = searchTerms(from);
  if (!terms.length) return [];
  const out: ImpactEvidence[] = [];
  pages.forEach((p, i) => {
    for (const l of classifyLines(p)) {
      if (l.revisionHistory || out.length >= max) continue;
      const s = squash(l.text);
      if (terms.some((t) => s.includes(t))) out.push({ revisionId: rev.id, revLabel: rev.revLabel, page: i + 1, quote: l.text.trim().slice(0, 240) });
    }
  });
  return out;
}

export interface Assessment { assessment: NonNullable<SiteChange["assessment"]>; impacts: Omit<ObligationImpact, "id" | "raisedAt">[] }

export function assessChange(site: Site, lc: LifecycleState, change: SiteChange, pagesOf: (revisionId: string) => string[] | undefined): Assessment {
  const label = CHANGE_KIND_BY_ID[change.kind]?.label ?? CHANGE_LABEL[change.baseType];
  const what = `${label}${change.from || change.to ? `: ${change.from ?? "?"} → ${change.to ?? "?"}` : ""} (effective ${change.effectiveDate})`;
  const assessment: Assessment["assessment"] = [];
  const impacts: Assessment["impacts"] = [];
  for (const ob of lc.obligations) {
    const req = REQ_BY_ID[ob.requirementId];
    const name = req?.name ?? ob.title;
    if (!ob.reviewTriggers.includes(change.baseType)) {
      assessment.push({ obligationId: ob.id, requirementId: ob.requirementId, flagged: false, reason: `${name}: its recorded review triggers (${ob.reviewTriggers.length ? ob.reviewTriggers.map((t) => CHANGE_LABEL[t]).join("; ") : "none"}) do not include “${CHANGE_LABEL[change.baseType]}”.` });
      continue;
    }
    const doc = latestApproved(site, ob.requirementId);
    if (!doc) {
      const applicable = isApplicable(ob.stage, site.stage);
      assessment.push({ obligationId: ob.id, requirementId: ob.requirementId, flagged: false, reason: applicable ? `${name}: no approved document on file yet — the obligation is already open, and the new document must reflect this change.` : `${name}: not yet applicable (applies from ${stageLabel(ob.stage)}) and no document on file.` });
      continue;
    }
    const pages = pagesOf(doc.id) ?? [];
    const evidence = findEvidence(pages, change.from, doc);
    const textNote = evidence.length
      ? ` Current Rev ${doc.revLabel} still references “${change.from}” (p.${evidence.map((e) => e.page).join(", p.")}).`
      : change.from && pages.length
        ? ` Rev ${doc.revLabel}'s text was checked and does not mention “${change.from}”; review is requested by the trigger table only.`
        : change.from ? ` Rev ${doc.revLabel} has no readable text to check for “${change.from}”.` : "";
    const why = `${name} is recorded as needing update when “${CHANGE_LABEL[change.baseType]}” occurs (requirement model: “${req?.when ?? "—"}”, ${req?.codeRef ?? "—"}).${textNote} This is a request for engineering review, not a finding of noncompliance.`;
    assessment.push({ obligationId: ob.id, requirementId: ob.requirementId, flagged: true, reason: why });
    impacts.push({
      siteId: site.id, changeId: change.id, obligationId: ob.id, requirementId: ob.requirementId, what, why, source: ob.source,
      reviewer: "engineer", responsible: ob.responsible, documentToUpdate: `${name} (currently Rev ${doc.revLabel})`, baselineRevisionId: doc.id, evidence, status: "open",
    });
  }
  // Evidence-backed impacts first.
  impacts.sort((a, b) => b.evidence.length - a.evidence.length);
  return { assessment, impacts };
}
