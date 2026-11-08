// Lifecycle obligation register. Starting model = the EQORE README "Documents NFPA 855 requires for every site" table
// plus its approval-record list, as already encoded in lib/requirements.ts (codeRef, when, change triggers).
// Obligations REFERENCE existing document types; no second document store. No due dates are created here —
// the README gives no deadlines/frequencies we can rely on, so schedules are configured per project (see ops.ts).
import { REQ_BY_ID, STAGES, stageIndex, type StageId } from "../requirements";
import type { Site } from "../types";
import { defaultTimezone } from "./clock";
import type { LifecycleState, Obligation, ObligationCategory } from "./types";

export const CATEGORY_LABEL: Record<ObligationCategory, string> = {
  commissioning: "Commissioning plan & report",
  om_manual: "Operations & maintenance manual",
  operations_records: "Operations, maintenance, testing, repair & training records",
  emergency_plan: "Emergency operations plan",
  decommissioning: "Decommissioning plan & report",
  approvals: "Approvals, inspection sign-offs, PTO, signage & labels",
};
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as ObligationCategory[];

interface TemplateEntry { category: ObligationCategory; requirementId: string; responsible: string; readme: "nfpa_table" | "approval_list" }
export const REGISTER_TEMPLATE: TemplateEntry[] = [
  { category: "commissioning", requirementId: "cx_plan", responsible: "EQORE engineering / commissioning agent", readme: "nfpa_table" },
  { category: "commissioning", requirementId: "cx_report", responsible: "EQORE engineering / commissioning agent", readme: "nfpa_table" },
  { category: "om_manual", requirementId: "om_manual", responsible: "EQORE operations", readme: "nfpa_table" },
  { category: "operations_records", requirementId: "ops_record", responsible: "Facility operator + EQORE field service", readme: "nfpa_table" },
  { category: "operations_records", requirementId: "training_drill", responsible: "Facility + EQORE operations", readme: "nfpa_table" },
  { category: "emergency_plan", requirementId: "eop", responsible: "EQORE operations with the facility", readme: "nfpa_table" },
  { category: "decommissioning", requirementId: "decom_plan", responsible: "EQORE engineering", readme: "nfpa_table" },
  { category: "decommissioning", requirementId: "decom_ahj_notice", responsible: "EQORE permitting", readme: "nfpa_table" },
  { category: "decommissioning", requirementId: "decom_report", responsible: "EQORE engineering", readme: "nfpa_table" },
  { category: "approvals", requirementId: "permit_building", responsible: "EQORE permitting", readme: "approval_list" },
  { category: "approvals", requirementId: "permit_electrical", responsible: "EQORE permitting", readme: "approval_list" },
  { category: "approvals", requirementId: "permit_fire", responsible: "EQORE permitting", readme: "approval_list" },
  { category: "approvals", requirementId: "insp_electrical", responsible: "EQORE permitting (AHJ inspector sign-off)", readme: "approval_list" },
  { category: "approvals", requirementId: "insp_building", responsible: "EQORE permitting (AHJ inspector sign-off)", readme: "approval_list" },
  { category: "approvals", requirementId: "insp_fire", responsible: "EQORE permitting (fire inspector sign-off)", readme: "approval_list" },
  { category: "approvals", requirementId: "ix_approval", responsible: "EQORE interconnection", readme: "approval_list" },
  { category: "approvals", requirementId: "pto", responsible: "EQORE interconnection", readme: "approval_list" },
  { category: "approvals", requirementId: "signage", responsible: "EQORE installation", readme: "nfpa_table" },
  { category: "approvals", requirementId: "sds", responsible: "EQORE installation", readme: "nfpa_table" },
];

export const obligationId = (siteId: string, requirementId: string) => `OBL-${siteId}-${requirementId}`;

export function templateObligation(site: Site, e: TemplateEntry, at: string): Obligation {
  const req = REQ_BY_ID[e.requirementId];
  return {
    id: obligationId(site.id, e.requirementId),
    siteId: site.id,
    category: e.category,
    requirementId: req.id,
    title: req.name,
    kind: "document",
    stage: req.stage,
    source: {
      kind: "eqore_readme_table",
      citation: req.codeRef,
      label: `${e.readme === "nfpa_table" ? "EQORE README — NFPA 855 documents table" : "EQORE README — approval records"}: “${req.when}”`,
    },
    responsible: e.responsible,
    reviewer: "engineer",
    reviewTriggers: [...req.triggers],
    createdAt: at,
    updatedAt: at,
    history: [{ at, by: "ReleaseOS register", byId: "system", action: "created", detail: "Created from the EQORE README starting model (no due date configured)" }],
  };
}

/** Create the lifecycle state if absent and add any template obligations not yet registered (idempotent). Returns true if changed. */
export function ensureLifecycle(site: Site, at: string): boolean {
  let changed = false;
  if (!site.lifecycle) {
    site.lifecycle = { timezone: defaultTimezone(site.state), warningDays: 14, settingsHistory: [], stageHistory: [], obligations: [], changes: [], impacts: [], events: [], publications: [] } satisfies LifecycleState;
    changed = true;
  }
  const lc = site.lifecycle;
  for (const e of REGISTER_TEMPLATE) {
    if (!REQ_BY_ID[e.requirementId]) continue;
    if (lc.obligations.some((o) => o.id === obligationId(site.id, e.requirementId))) continue;
    lc.obligations.push(templateObligation(site, e, at));
    changed = true;
  }
  return changed;
}

/** An obligation applies once the project reaches its stage; decommissioning items only during decommissioning. */
export function isApplicable(obStage: StageId, siteStage: StageId) {
  if (obStage === "decommissioning") return siteStage === "decommissioning";
  return stageIndex(obStage) <= stageIndex(siteStage);
}
/** Document types that may be EXPLICITLY published to the public emergency (QR) page by an engineer — never automatically. */
export const PUBLISHABLE_TYPES = ["emergency_info_sheet", "eop", "signage", "sds"];

export const stageLabel = (s: StageId) => STAGES[stageIndex(s)]?.label ?? s;
