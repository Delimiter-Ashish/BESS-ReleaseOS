// ==== SHARED CONTRACT — agree before changing (Ashish + Kaushik) ====
import type { ChangeType, Role, StageId } from "./requirements";

/** A single extracted fact. `key` is canonical so two revisions can be diffed. */
export interface Fact {
  key: string; // e.g. "rating.current_a", "equipment.model" (see FACT_KEYS in extract.ts)
  label: string; // human label, e.g. "Rated current"
  value: string; // normalized value, e.g. "600"
  unit?: string; // e.g. "A", "kW", "kWh", "V"
  evidence?: string; // short verbatim quote from the document
  page?: number;
  confidence: number; // 0..1
  // ---- additive (integration) ----
  /** found = stated clearly; uncertain/ambiguous = model or parser could not establish it reliably. */
  status?: "found" | "uncertain" | "ambiguous";
  /** True when the evidence quote was located verbatim in the PDF text layer (server-checked). */
  evidenceVerified?: boolean;
  /** True when the page number was checked against that text-layer page. */
  pageVerified?: boolean;
  origin?: "openai" | "anthropic" | "rules" | "seed";
  note?: string;
}

/** Back-compat alias used by older UI code. */
export type ExtractedField = { name: string; value: string; evidence?: string; page?: number; confidence: number };

export type RevisionStatus = "uploaded" | "in_review" | "approved" | "rejected";

/**
 * One uploaded version of one document type at one site.
 * RULE: packages/releases only ever pin APPROVED revisions. Uploading never changes a release.
 * "Superseded" is computed: an approved revision with a newer approved revision of the same type.
 */
export interface Revision {
  id: string;
  siteId: string;
  requirementId: string; // DocumentType id (lib/requirements.ts)
  revLabel: string; // "A", "B", ...
  version: number; // 1, 2, ...
  fileName: string;
  fileId?: string; // key into file store (bytes)
  sha256: string;
  source: "supplier" | "engineer" | "eqore" | "ahj" | "utility" | "facility" | "seed";
  uploadedBy: string;
  uploadedAt: string; // ISO date
  effectiveDate: string; // date on the document
  status: RevisionStatus;
  approvedBy?: string;
  approvedAt?: string;
  facts: Fact[];
  summary?: string;
  aiConfidence?: number;
  engine?: "claude" | "openai" | "rules" | "seed";
  // ---- additive (integration) ----
  mediaType?: string;
  /** Server session user id of the uploader (used to block self-approval). */
  uploadedById?: string;
  /** Extracted text layer (when available) — used to verify evidence quotes. */
  textLayer?: string;
  pageCount?: number;
  model?: string;
  extractionWarnings?: string[];
  missingItems?: string[];
  rejectedBy?: string;
  rejectedAt?: string;
  synthetic?: boolean; // label synthetic docs honestly in the UI
  notes?: string;
}
/** Older code calls revisions "documents". */
export type DocRecord = Revision;

export interface FactChange {
  key: string;
  label: string;
  before?: string; // "400 A"
  after?: string; // "600 A"
  evidenceBefore?: string;
  evidenceAfter?: string;
  pageAfter?: number;
  // ---- additive (integration) ----
  pageBefore?: number;
  /** Values converted to a canonical unit (e.g. 0.6 kV → 600 V) for comparison. */
  normalizedBefore?: string;
  normalizedAfter?: string;
  /** material = engineering-relevant; cosmetic = same normalized value, different wording; informational = metadata (revision/date). */
  significance?: "material" | "cosmetic" | "informational";
  reason?: string;
  evidenceVerifiedAfter?: boolean;
  /** AI- or rule-generated explanation of possible consequences. Never an approval. */
  impact?: string;
  impactSource?: "openai" | "rules";
}

/** Created when a revision is submitted. Engineer approves or rejects. */
export interface ReviewTask {
  id: string;
  siteId: string;
  revisionId: string;
  previousRevisionId?: string;
  requirementId: string;
  changes: FactChange[];
  affectedReleaseIds: string[];
  affectedRequirementIds: string[]; // dependents that need engineering review (e.g. plan set)
  assignee: string;
  status: "open" | "approved" | "rejected";
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
  // ---- additive (integration) ----
  materialChangeCount?: number;
  aiSummary?: string;
  aiSummarySource?: "openai" | "rules";
  /** Requirements that might be affected but have no document on file yet. */
  potentiallyAffectedMissing?: string[];
}

/**
 * Engineering review task for a DEPENDENT document, created deterministically from the
 * dependency graph when a source document has material changes (core: ReviewTask).
 * Only an authorized engineer can resolve it, and only after the exact source revision is approved.
 */
export interface EngineeringTask {
  id: string;
  siteId: string;
  sourceRevisionId: string;
  sourceRequirementId: string;
  dependentRequirementId: string;
  /** The dependent's approved revision at the time the task was raised. */
  dependentRevisionId?: string;
  changedKeys: string[];
  explanation: string; // deterministic, from the dependency graph
  aiImpact?: string; // optional AI explanation (advisory only)
  status: "open" | "resolved" | "superseded";
  createdAt: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolution?: "confirmed_no_change" | "new_revision_approved";
  resolutionNote?: string;
  resolvedByDecisionId?: string;
  // ---- additive (Project Guardian) ----
  /** "consistency" = raised by the cross-document check (lib/guardian); default "dependency". */
  kind?: "dependency" | "consistency";
  /** Verified cross-document discrepancies this task covers (finding ids are stable fingerprints). */
  findingIds?: string[];
  consistency?: { findingId: string; quantity: string; reason: string; a: { revisionId: string; display: string; evidence: string; page?: number }; b: { revisionId: string; display: string; evidence: string; page?: number } }[];
}

/** Immutable audit record of a human decision (core: ReviewDecision). */
export interface DecisionRecord {
  id: string;
  siteId: string;
  kind: "revision_review" | "dependency_resolution" | "release_signoff";
  revisionId?: string;
  contentSha256?: string;
  taskIds: string[];
  releaseId?: string;
  decision: "approved" | "rejected" | "resolved" | "signed_off";
  reviewerId: string;
  reviewerName: string;
  reviewerRoles: string[];
  note: string;
  at: string;
  seeded?: boolean;
}

export interface PinnedItem {
  requirementId: string;
  revisionId: string;
  revLabel: string;
  fileName: string;
  sha256: string;
  approvedBy?: string;
  approvedAt?: string;
}

/** A version-locked submission package. Immutable once built. */
export interface Release {
  id: string;
  siteId: string;
  templateId: string;
  number: number; // R1, R2...
  items: PinnedItem[];
  openFlags: string[]; // review flags carried at build time (shown in manifest)
  builtBy: string;
  builtAt: string; // ISO datetime
  note?: string;
  manifestSha256: string;
  // ---- additive (integration) ----
  /** Frozen release-core ReleaseSnapshot (schemaVersion 1). Never regenerated from live data. */
  snapshot?: import("@releaseos/release-core").ReleaseSnapshot;
  builtById?: string;
}

export interface ChangeEvent {
  id: string;
  type: ChangeType;
  date: string;
  description: string;
  by: string;
}

export interface Contact {
  role: string;
  name: string;
  phone: string;
}

export interface Site {
  id: string;
  name: string;
  address: string;
  city: string;
  state: "MA" | "CA";
  utility: string;
  ahj: string;
  stage: StageId;
  chemistry: string;
  powerKw: number;
  energyKwh: number;
  vendor: string;
  inverter?: string;
  location: string;
  disconnectLocation: string;
  installDate?: string;
  documents: Revision[]; // all revisions, every status
  events: ChangeEvent[];
  contacts: Contact[];
  // ---- additive (integration) ----
  engTasks?: EngineeringTask[];
  decisions?: DecisionRecord[];
  // ---- additive (project memory; see lib/memory/types.ts) ----
  communications?: import("./memory/types").Communication[];
  memory?: import("./memory/types").MemoryItem[];
}

export interface User {
  name: string;
  role: Role;
}
