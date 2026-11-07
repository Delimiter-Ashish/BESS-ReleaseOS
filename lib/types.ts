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
  engine?: "ai" | "rules" | "seed";
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
}

export interface User {
  name: string;
  role: Role;
}
