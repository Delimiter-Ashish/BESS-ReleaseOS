// Minimal, configurable document access policy (server-enforced). Two SEPARATE permissions per document type:
//   view      — who may see the document inside ReleaseOS (internal visibility)
//   releaseTo — which EXTERNAL recipients it may be included in a submission package for
// Default for any document type without a rule: visible to EQORE staff + engineers, releasable to NOBODY.
// Nothing is ever assumed authorized for external release. Changes are recorded (who, when, why); latest rule wins.
import type { Session } from "../auth";
import { REQ_BY_ID } from "../requirements";
import type { Revision, Site } from "../types";

export type Audience = "eqore_staff" | "engineer" | "supplier" | "authority" | "facility";
export type Recipient = "ahj" | "planning" | "utility" | "supplier" | "owner";
export const AUDIENCES: Audience[] = ["eqore_staff", "engineer", "supplier", "authority", "facility"];
export const RECIPIENTS: Recipient[] = ["ahj", "planning", "utility", "supplier", "owner"];
export const RECIPIENT_LABEL: Record<Recipient, string> = { ahj: "AHJ (building / fire)", planning: "Planning board", utility: "Utility (interconnection)", supplier: "Supplier", owner: "Site owner" };
export const AUDIENCE_LABEL: Record<Audience, string> = { eqore_staff: "EQORE staff", engineer: "EQORE engineers", supplier: "Suppliers", authority: "Authority reviewers", facility: "Facility" };

export interface AccessRule {
  requirementId: string;
  view: Audience[];
  releaseTo: Recipient[];
  setById: string;
  setBy: string;
  setAt: string;
  note: string;
  seeded?: boolean;
}
export interface EffectiveRule extends Omit<AccessRule, "setById" | "setBy" | "setAt" | "note"> { isDefault: boolean; setBy?: string; setAt?: string; note?: string }

export const DEFAULT_RULE = { view: ["eqore_staff", "engineer"] as Audience[], releaseTo: [] as Recipient[] };

export function ruleFor(site: Site, requirementId: string): EffectiveRule {
  const r = [...(site.accessPolicy ?? [])].reverse().find((x) => x.requirementId === requirementId);
  return r ? { requirementId, view: r.view, releaseTo: r.releaseTo, isDefault: false, setBy: r.setBy, setAt: r.setAt, note: r.note, seeded: r.seeded } : { requirementId, ...DEFAULT_RULE, isDefault: true };
}

/** Audiences a session belongs to (identity from the signed session cookie only). */
export function audiencesOf(s: Pick<Session, "role" | "engineer">): Audience[] {
  switch (s.role) {
    case "eqore": return s.engineer ? ["eqore_staff", "engineer"] : ["eqore_staff"];
    case "supplier": return ["supplier"];
    case "ahj": return ["authority"];
    case "facility": return ["facility"];
    default: return [];
  }
}
/** Which external recipient a non-EQORE session represents (for downloading packages addressed to it). */
export function recipientOf(s: Pick<Session, "role">): Recipient[] {
  return s.role === "ahj" ? ["ahj", "planning"] : s.role === "supplier" ? ["supplier"] : s.role === "facility" ? ["owner"] : [];
}

/** Internal visibility. The uploader of a revision can always see their own upload. */
export function canViewRevision(s: Pick<Session, "role" | "engineer" | "userId">, site: Site, rev: Revision) {
  if (s.role === "public") return false;
  if (rev.uploadedById && rev.uploadedById === s.userId) return true;
  const rule = ruleFor(site, rev.requirementId);
  return audiencesOf(s).some((a) => rule.view.includes(a));
}
export const canReleaseTo = (site: Site, requirementId: string, recipient: Recipient) => ruleFor(site, requirementId).releaseTo.includes(recipient);

export function policyTable(site: Site) {
  const ids = Array.from(new Set([...site.documents.map((d) => d.requirementId), ...(site.accessPolicy ?? []).map((r) => r.requirementId)]));
  return ids.map((rid) => ({ ...ruleFor(site, rid), name: REQ_BY_ID[rid]?.name ?? rid, history: (site.accessPolicy ?? []).filter((r) => r.requirementId === rid) }));
}

/**
 * Synthetic demo policy for the hero site (recorded as seeded configuration, not assumed defaults).
 * Supplier datasheets are visible to suppliers; commercial documents stay internal and releasable to nobody.
 */
export function seedHeroPolicy(site: Site, at: string) {
  const r = (requirementId: string, view: Audience[], releaseTo: Recipient[]): AccessRule => ({ requirementId, view, releaseTo, setById: "seed", setBy: "EQORE document control (seeded synthetic policy)", setAt: at, note: "Synthetic demo policy", seeded: true });
  const internal: Audience[] = ["eqore_staff", "engineer"];
  const withSupplier: Audience[] = [...internal, "supplier"];
  const withAuthority: Audience[] = [...internal, "authority"];
  site.accessPolicy = [
    r("contract", internal, []),
    r("proposal", internal, []),
    r("utility_bill", ["eqore_staff"], ["utility"]),
    r("property_record", internal, ["planning"]),
    r("site_photos", withAuthority, ["utility", "planning"]),
    r("plan_set", withAuthority, ["ahj", "utility", "planning"]),
    r("ventilation_plan", withAuthority, ["ahj"]),
    r("battery_datasheet", withSupplier, ["ahj", "utility"]),
    r("inverter_datasheet", withSupplier, ["ahj", "utility"]),
    r("switchgear_datasheet", withSupplier, ["ahj", "utility"]),
    r("ul9540_listing", withSupplier, ["ahj"]),
    r("ul9540a_report", withSupplier, ["ahj"]),
    r("sds", withSupplier, ["ahj"]),
    r("ix_application", internal, ["utility"]),
    r("ix_approval", internal, []),
  ];
}
