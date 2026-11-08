// ==== PROJECT MEMORY — SHARED CONTRACT (Ashish → Kaushik) ====
// Typed records for communication intelligence, the project register, and pre-submission checks.
// UI code should import types from here and data from the API routes documented in README ("Project memory API").
//
// RULES encoded by these types (enforced in lib/memory/register.ts):
//  - Everything the AI extracts starts as status "suggested". Suggestions NEVER block a release.
//  - Only a human (EQORE PM or engineer) can confirm a suggestion; only confirmed + blocking items gate packages.
//  - A confirmed requirement that names a document type adds that document to the applicable package checklists.
//  - Requirements are resolved by an authorized engineer; actions/questions/decisions by an EQORE user. Notes required.

export type CommunicationChannel = "email" | "ahj_comment" | "engineering_note" | "meeting_note" | "other";
export type MemoryKind = "requirement" | "decision" | "action_item" | "question";
export type Authority = "ahj" | "utility" | "eqore" | "engineer" | "supplier" | "owner" | "other";

/**
 * suggested  → AI/rules proposal awaiting a human (never authoritative)
 * confirmed  → human confirmed applicability; may block packages if `blocking`
 * resolved   → closed by an authorized user (requirement satisfied / action done / question answered / decision made)
 * dismissed  → human rejected the suggestion (kept for audit)
 * merged     → duplicate of another item; its evidence was added to `mergedIntoId`
 */
export type MemoryStatus = "suggested" | "confirmed" | "resolved" | "dismissed" | "merged";

/** Where a memory item came from. The quote is checked server-side against the original source text. */
export interface MemorySource {
  communicationId: string;
  sender: string;
  sentAt: string; // ISO timestamp as stated by the source (or entered by the importer)
  channel: CommunicationChannel;
  subject?: string;
  evidence: string; // verbatim quote from the communication
  evidenceVerified: boolean; // true = quote found in the stored original text
}

export interface MemoryHistoryEntry {
  at: string;
  byId: string;
  byName: string;
  action: "suggested" | "confirmed" | "dismissed" | "merged" | "resolved" | "reopened" | "source_added";
  note?: string;
}

export interface MemoryItem {
  id: string;
  siteId: string;
  kind: MemoryKind;
  title: string;
  detail: string;
  status: MemoryStatus;
  origin: "openai" | "rules" | "manual";
  model?: string;
  confidence: number; // 0..1 (AI/rules confidence of the extraction, not of compliance)
  sources: MemorySource[]; // first = original source; more are added when duplicates are merged

  // ---- links into the document system ----
  /** Document type (lib/requirements.ts id) this item concerns, e.g. "ventilation_plan". */
  requirementId?: string;
  /** Package templates this item applies to (e.g. ["ahj_permit"]). Required for a confirmed item to block. */
  templateIds: string[];
  /** Requirement must be met by a revision uploaded AFTER the source was sent ("send an UPDATED plan"). */
  requiresUpdatedRevision: boolean;
  /** Existing revisions mentioned by the source (deterministically matched). */
  relatedRevisionIds: string[];
  authority?: Authority;
  responsibleParty?: string;
  dueDate?: string; // YYYY-MM-DD
  decisionState?: "made" | "pending"; // decisions only

  /** Human-set on confirmation (AI only proposes `proposedBlocking`). */
  blocking: boolean;
  proposedBlocking: boolean;
  /** Fingerprint used to detect the same item imported from another communication. */
  fingerprint: string;
  duplicateOfId?: string; // set on suggestions that match an existing active item
  mergedIntoId?: string;

  confirmedById?: string; confirmedBy?: string; confirmedAt?: string; confirmNote?: string;
  dismissedBy?: string; dismissedAt?: string; dismissNote?: string;
  resolvedById?: string; resolvedBy?: string; resolvedAt?: string; resolutionNote?: string;
  /** Requirement satisfied by this exact approved revision (hash recorded). */
  resolvedRevisionId?: string; resolvedRevisionSha256?: string;

  history: MemoryHistoryEntry[];
  createdAt: string;
}

export interface DocumentReference {
  reference: string; // as stated, e.g. "ventilation plan", "switchgear Rev B"
  requirementId?: string;
  revisionLabel?: string;
  evidence: string;
  evidenceVerified: boolean;
  linkedRevisionId?: string; // matched deterministically to a revision on file
}

export interface Stakeholder { name: string; organization?: string; role?: string }

/** One imported communication. `body` is the ORIGINAL text, stored verbatim and never rewritten. */
export interface Communication {
  id: string;
  siteId: string;
  channel: CommunicationChannel;
  subject?: string;
  sender: string;
  senderOrg?: string;
  recipients: string[];
  sentAt: string;
  body: string;
  /** sha256 of the whitespace/case-normalized body: the same message imported twice is detected. */
  contentSha256: string;
  importedById: string;
  importedBy: string;
  importedAt: string;
  analysis: {
    engine: "openai" | "rules";
    model?: string;
    fallback: boolean;
    summary: string;
    warnings: string[];
    embeddedInstructionsDetected: string[];
    stakeholders: Stakeholder[];
    documentReferences: DocumentReference[];
  };
  itemIds: string[];
  synthetic?: boolean;
}

// ---- Pre-submission check (extends the release readiness gate) ----

export type PreSubmissionCode =
  // existing deterministic release gate
  | "MISSING_DOCUMENT" | "NO_APPROVED_VERSION" | "PENDING_REVIEW" | "CHANGED_SOURCE"
  // project memory (confirmed items only)
  | "OUTDATED_REVISION" | "REQUIREMENT_UNRESOLVED" | "OPEN_ACTION" | "OPEN_QUESTION" | "OPEN_DECISION"
  // project guardian (verified cross-document discrepancy under engineer review)
  | "CROSS_DOC_DISCREPANCY";

export interface IssueSource {
  kind: "package_template" | "dependency_graph" | "project_memory" | "consistency_check";
  label: string; // human description of why this is required
  memoryItemId?: string;
  communicationId?: string;
  sender?: string;
  sentAt?: string;
  evidence?: string;
}

/** Advisory = shown, never blocks (e.g. unconfirmed AI suggestions). */
export interface Advisory { code: "UNCONFIRMED_SUGGESTION" | "POSSIBLE_DUPLICATE"; message: string; memoryItemId: string }

export interface PreSubmissionIssue {
  code: PreSubmissionCode;
  /** Document type concerned (absent for memory items that are not about a document). */
  requirementId?: string;
  message: string;
  taskId?: string;
  memoryItemId?: string;
  /** Why this is required: package checklist, dependency graph, or a confirmed project-memory item (with its source). */
  source?: IssueSource;
  affectedDocument?: string;
  responsibleParty?: string;
  nextAction?: string;
}

export type BlockerCategory = "missing_document" | "outdated_revision" | "pending_review" | "dependency" | "consistency" | "requirement" | "action" | "question" | "decision";
export const CATEGORY_OF: Record<PreSubmissionCode, BlockerCategory> = {
  MISSING_DOCUMENT: "missing_document", NO_APPROVED_VERSION: "missing_document", OUTDATED_REVISION: "outdated_revision",
  PENDING_REVIEW: "pending_review", CHANGED_SOURCE: "dependency", REQUIREMENT_UNRESOLVED: "requirement",
  OPEN_ACTION: "action", OPEN_QUESTION: "question", OPEN_DECISION: "decision", CROSS_DOC_DISCREPANCY: "consistency",
};

/** GET /api/sites/:id/presubmission?templateId=… — "Before we move forward, what are we forgetting?" */
export interface PreSubmissionReport {
  siteId: string;
  templateId: string;
  templateName: string;
  audience: string;
  checkedAt: string;
  /** True only when there are zero blockers. Advisories never affect this. */
  canBuild: boolean;
  /** Pass back as readinessToken when building the release (stale checks are rejected). */
  token: string;
  blockers: (PreSubmissionIssue & { category: BlockerCategory })[];
  advisories: Advisory[];
  counts: Record<BlockerCategory, number> & { blockers: number; advisories: number };
  checklist: { requirementId: string; name: string; state: "ready" | "missing" | "in_review" | "pending_change" | "needs_eng_review"; approvedRevision?: string; pendingRevision?: string; requiredBy: "package_template" | "project_memory"; memoryItemIds: string[] }[];
}
