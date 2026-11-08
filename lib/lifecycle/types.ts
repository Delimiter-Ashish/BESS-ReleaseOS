// ==== LIFECYCLE ASSURANCE — SHARED CONTRACT (Ashish → Kaushik) ====
// Ongoing compliance after submission: a per-site obligation register (from the EQORE README NFPA 855 documents
// table), date-driven status with a deterministic clock, human-confirmed site changes → impacted obligations →
// engineer review, maintenance events with reviewed evidence, and explicitly approved first-responder publications.
//
// Stored additively on Site.lifecycle (lib/types.ts). Documents, revisions, approvals, decisions and access rules
// are the EXISTING records — obligations only reference them by id. API: GET/POST /api/sites/:id/lifecycle.
//
// SAFETY: the README table is a starting data model, not a legal compliance engine. No obligation here carries a
// built-in NFPA deadline or maintenance frequency; every due date is configured per project, recorded with who/why,
// and labeled as project-specific (synthetic in the demo).
import type { ChangeType, StageId } from "../requirements";

export type ObligationCategory = "commissioning" | "om_manual" | "operations_records" | "emergency_plan" | "decommissioning" | "approvals";

export type ObligationStatus =
  | "not_applicable" // the project has not reached the obligation's stage
  | "needs_review" // a confirmed site change may affect it; engineer review open
  | "awaiting_review" // a document/record was submitted but not yet reviewed (an upload is never proof)
  | "overdue"
  | "due_soon" // within the warning window
  | "upcoming" // configured due date outside the warning window
  | "open" // required at this stage, nothing approved yet, no due date configured
  | "completed";

export interface RequirementSourceRef {
  kind: "eqore_readme_table" | "project_config" | "confirmed_memory";
  /** Citation as recorded in the README table / requirement model (not a legal interpretation). */
  citation: string;
  label: string;
  memoryItemId?: string;
}

export interface DueConfig {
  date: string; // YYYY-MM-DD, site-local calendar date
  /** Overrides the site's warning window for this obligation. */
  warningDays?: number;
  basis: "project_specific";
  /** True for demo data. Every demo deadline is synthetic and labeled as such. */
  synthetic: boolean;
  setBy: string;
  setById: string;
  setAt: string;
  note: string;
}

export interface Completion {
  /** Due date this completion satisfies (a new due date starts a new cycle). */
  forDueDate?: string;
  eventId?: string;
  evidenceRevisionId: string;
  decisionId: string;
  verifiedBy: string;
  verifiedById: string;
  verifiedAt: string;
  note: string;
}

export interface ObligationHistoryEntry { at: string; by: string; byId: string; action: string; detail: string }

export interface Obligation {
  id: string;
  siteId: string;
  category: ObligationCategory;
  /** Existing document type id (lib/requirements.ts) whose revisions satisfy / evidence this obligation. */
  requirementId: string;
  title: string;
  /** document = satisfied by an approved revision; record = needs a recorded event + reviewed evidence each cycle. */
  kind: "document" | "record";
  stage: StageId; // applicable from this stage on (decommissioning: only in decommissioning)
  source: RequirementSourceRef;
  /** Who must produce/keep it (role-based, from the requirement model or project config). */
  responsible: string;
  /** Who must review before it can count as current or be resolved. */
  reviewer: "engineer";
  /** Event-driven review triggers (from the requirement model's change triggers). */
  reviewTriggers: ChangeType[];
  due?: DueConfig;
  completion?: Completion;
  pastCycles?: Completion[];
  createdAt: string;
  updatedAt: string;
  history: ObligationHistoryEntry[];
}

/** Lifecycle-specific change kinds; each maps onto an existing ChangeType (site.events) for compatibility. */
export type ChangeKind = ChangeType | "monitoring_device_replace";

export interface SiteChange {
  id: string;
  siteId: string;
  kind: ChangeKind;
  baseType: ChangeType;
  description: string;
  component?: string;
  /** Identifier being replaced/removed (used to look for evidence in current documents). */
  from?: string;
  to?: string;
  effectiveDate: string; // YYYY-MM-DD
  origin: "manual" | "memory_suggestion";
  memoryItemId?: string;
  status: "proposed" | "confirmed" | "dismissed";
  proposedBy: string;
  proposedById: string;
  proposedAt: string;
  decidedBy?: string;
  decidedById?: string;
  decidedAt?: string;
  decisionNote?: string;
  /** Transparent assessment of every register obligation at confirmation time (flagged or not, and why). */
  assessment?: { obligationId: string; requirementId: string; flagged: boolean; reason: string }[];
}

export interface ImpactEvidence { revisionId: string; revLabel: string; page?: number; quote: string }

export interface ObligationImpact {
  id: string;
  siteId: string;
  changeId: string;
  obligationId: string;
  requirementId: string;
  /** What changed, in words. */
  what: string;
  /** Why the obligation may need attention (never a violation claim). */
  why: string;
  source: RequirementSourceRef;
  reviewer: "engineer";
  responsible: string;
  /** Document/record that needs updating, and the approved revision at the time the impact was raised. */
  documentToUpdate: string;
  baselineRevisionId?: string;
  evidence: ImpactEvidence[];
  status: "open" | "resolved";
  raisedAt: string;
  resolution?: "new_revision_approved" | "confirmed_no_change";
  resolvedBy?: string;
  resolvedById?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  resolutionRevisionId?: string;
  decisionId?: string;
}

export interface ComplianceEvent {
  id: string;
  siteId: string;
  obligationId: string;
  type: "maintenance" | "test" | "repair" | "training" | "inspection";
  performedOn: string; // YYYY-MM-DD (site-local)
  performedBy: string;
  summary: string;
  recordedBy: string;
  recordedById: string;
  recordedAt: string;
  fingerprint: string;
  /** Linked when an engineer verifies the record against reviewed evidence. */
  evidenceRevisionId?: string;
}

export interface StageTransition { from: StageId; to: StageId; by: string; byId: string; at: string; note: string }

export interface EmergencyPublication {
  id: string;
  siteId: string;
  revisionId: string;
  requirementId: string;
  sha256: string;
  title: string;
  status: "published" | "withdrawn";
  publishedBy: string;
  publishedById: string;
  publishedAt: string;
  note: string;
  withdrawnBy?: string;
  withdrawnAt?: string;
}

export interface LifecycleState {
  timezone: string; // IANA zone used for site-local date boundaries
  warningDays: number; // default warning window (demo-configurable)
  settingsHistory: { at: string; by: string; timezone: string; warningDays: number; note: string }[];
  stageHistory: StageTransition[];
  obligations: Obligation[];
  changes: SiteChange[];
  impacts: ObligationImpact[];
  events: ComplianceEvent[];
  publications: EmergencyPublication[];
}

// ---------- read model (GET /api/sites/:id/lifecycle) ----------
export interface ObligationView {
  id: string;
  category: ObligationCategory;
  categoryLabel: string;
  requirementId: string;
  title: string;
  kind: Obligation["kind"];
  stage: StageId;
  stageLabel: string;
  status: ObligationStatus;
  statusReason: string;
  source: RequirementSourceRef;
  responsible: string;
  reviewer: "engineer";
  reviewTriggers: ChangeType[];
  due?: DueConfig & { daysRemaining: number; warningDays: number };
  currentRevision?: { id: string; revLabel: string; status: string; approvedBy?: string; approvedAt?: string; sha256: string; href: string };
  pendingRevision?: { id: string; revLabel: string; href: string };
  completion?: Completion;
  openImpacts: ObligationImpact[];
  events: ComplianceEvent[];
  /** Access policy for the underlying document type (Submission Studio rules). */
  access: { view: string[]; releaseTo: string[]; isDefault: boolean };
  createdAt: string;
  updatedAt: string;
  history?: ObligationHistoryEntry[]; // EQORE only
  nextAction: string;
  /** Record obligations (EQORE only): approved revisions not yet linked to any event — usable as evidence. */
  evidenceCandidates?: { id: string; revLabel: string; fileName: string; approvedBy?: string }[];
}

export interface LifecycleView {
  siteId: string;
  siteName: string;
  asOf: string; // site-local date used for status
  clock: "system" | "frozen";
  timezone: string;
  warningDays: number;
  stage: StageId;
  stageLabel: string;
  stageHistory: StageTransition[];
  counts: Record<ObligationStatus, number>;
  obligations: ObligationView[];
  changes: SiteChange[]; // EQORE only (empty for others)
  impacts: ObligationImpact[]; // EQORE only
  publications: EmergencyPublication[]; // EQORE only
  /** Current approved revisions of publishable emergency types not currently published (EQORE only). */
  publishCandidates: { revisionId: string; requirementId: string; title: string }[];
  viewer: { role: string; restricted: boolean };
  disclaimer: string;
}

export type LifecycleAction =
  | { action: "set_stage"; to: StageId; note: string }
  | { action: "settings"; warningDays?: number; timezone?: string; note: string }
  | { action: "add_obligation"; requirementId: string; title: string; category: ObligationCategory; kind?: "record" | "document"; dueDate?: string; warningDays?: number; note: string; responsible?: string }
  | { action: "set_due"; obligationId: string; dueDate: string; warningDays?: number; note: string }
  | { action: "propose_change"; kind: ChangeKind; description: string; component?: string; from?: string; to?: string; effectiveDate: string; memoryItemId?: string }
  | { action: "confirm_change"; changeId: string; note: string }
  | { action: "dismiss_change"; changeId: string; note: string }
  | { action: "resolve_impact"; impactId: string; resolution: "new_revision_approved" | "confirmed_no_change"; note: string }
  | { action: "record_event"; obligationId: string; type: ComplianceEvent["type"]; performedOn: string; performedBy: string; summary: string }
  | { action: "verify_completion"; obligationId: string; eventId: string; evidenceRevisionId: string; note: string }
  | { action: "publish_emergency"; revisionId: string; note: string }
  | { action: "withdraw_emergency"; publicationId: string; note: string };
