// ==== PROJECT GUARDIAN — SHARED CONTRACT (Ashish → Kaushik) ====
// Evidence graph, cross-document consistency findings, preflight report, and Time Machine diff.
// All produced by pure functions over the existing store (no new database). API routes documented in README.
//
// RULES:
//  - Consistency findings never claim incompatibility or code noncompliance. "verified_discrepancy" means:
//    two CURRENT documents state different values for the same quantity of the same equipment at the same
//    interface — an engineer must review. Only these can gate a release (via an engineering review task).
//  - AI may comment on a finding (advisory) but can never create, upgrade, or clear a gating finding.
//  - Preflight and Time Machine are read-only with respect to project state and releases.

export type Quantity = "voltage" | "current" | "interrupting";
export type EquipmentRole = "switchgear" | "transformer" | "inverter" | "battery" | "service" | "unknown";
export type InterfaceSide = "primary" | "secondary" | "utility" | "ac" | "dc";
export type Measure = "rating" | "nominal" | "unspecified";

/** One stated electrical value with the context needed to decide what it refers to. */
export interface Observation {
  id: string; // `${revisionId}#${n}`
  revisionId: string;
  requirementId: string;
  revLabel: string;
  fileName: string;
  quantity: Quantity;
  value: number; // canonical unit: V for voltage, A for current and interrupting
  display: string; // as stated, e.g. "600 VAC", "13,200 V"
  equipment: EquipmentRole;
  identifiers: string[]; // e.g. ["NSG-4000"], ["T1"]
  side?: InterfaceSide;
  measure: Measure;
  evidence: string; // verbatim line
  page?: number;
  evidenceKind: "text_layer" | "recorded_fact"; // text_layer = read from the PDF text; recorded_fact = stored fact (seed/extraction)
  evidenceVerified: boolean;
  contextReason: string; // how equipment/side were determined
}

/**
 * verified_discrepancy  — same quantity, SAME equipment identifier on both sides, same (or both unstated) interface
 * needs_clarification   — values differ for what appears to be the same equipment, but identity or interface is
 *                         not established by both documents (e.g. "AC disconnect" vs "NSG-4000"); engineer to clarify
 */
export type FindingClass = "verified_discrepancy" | "needs_clarification" | "potential_inconsistency" | "explained_difference" | "consistent" | "insufficient_evidence";

export interface AiReview {
  model: string;
  sameEquipment: "yes" | "no" | "unclear";
  sameInterface: "yes" | "no" | "unclear";
  suggestedClass: "potential_inconsistency" | "explained_difference" | "insufficient_evidence";
  explanation: string;
  citedEvidence: { revisionId: string; quote: string; verified: boolean }[];
  /** True when AI's suggestion differs from the deterministic class (shown; never applied automatically). */
  disagrees: boolean;
  at: string;
}

export interface ConsistencyFinding {
  id: string; // stable fingerprint of (revisions, quantity, equipment context)
  class: FindingClass;
  quantity: Quantity;
  a: Observation; // newer / source side
  b: Observation;
  reason: string; // deterministic explanation of the classification
  /** Which view produced it: approved documents only, or the candidate set (pending revisions override approved). */
  view: "approved" | "candidate";
  /** Related through the dependency graph or a shared package. */
  relation: string;
  aiReview?: AiReview;
  /** Engineering task gating this finding (approved view, verified discrepancies only). */
  taskId?: string;
  taskStatus?: "open" | "resolved" | "superseded";
}

// ---- Evidence graph ----
export type NodeType = "communication" | "memory_item" | "document_family" | "revision" | "observation" | "fact" | "engineering_task" | "review_task" | "decision" | "template" | "release" | "finding" | "site_change" | "obligation" | "impact";
export interface GraphNode { id: string; type: NodeType; label: string; href?: string; at?: string; data?: Record<string, unknown> }
export type EdgeType =
  | "mentions" | "proposes" | "requires_document" | "applies_to" | "revision_of" | "states" | "supersedes"
  | "raised_by" | "targets" | "decided_by" | "resolved_by" | "pins" | "satisfied_by" | "compares" | "gated_by" | "reviews" | "requires" | "may_affect" | "tracks" | "evidenced_by";
export interface GraphEdge {
  id: string;
  type: EdgeType;
  from: string;
  to: string;
  reason: string; // why the connection exists
  evidence?: string; // verbatim quote when the link comes from a source text
  at?: string;
  sourceIds: string[]; // ids of the records that justify this edge
}
export interface EvidenceGraph { siteId: string; builtAt: string; nodes: GraphNode[]; edges: GraphEdge[] }

// ---- Preflight ----
export type Severity = "blocker" | "warning" | "info";
export interface EvidenceRef {
  kind: "communication" | "document" | "release" | "task" | "checklist";
  quote?: string;
  verified?: boolean;
  sourceId: string;
  label: string;
  href?: string;
  page?: number;
}
export interface ChainStep { nodeId: string; type: NodeType; label: string; href?: string; via?: string }
export interface PreflightFinding {
  id: string;
  category: "missing_document" | "outdated_revision" | "pending_review" | "dependency" | "consistency" | "requirement" | "action" | "question" | "decision" | "change_since_release";
  severity: Severity;
  blocking: boolean; // true only for deterministic gate issues (identical to the release gate)
  title: string;
  detail: string;
  evidence: EvidenceRef[];
  affectedFiles: { revisionId: string; requirementId: string; fileName: string; revLabel: string; href: string }[];
  responsibleRole?: string;
  nextAction: string;
  chain: ChainStep[]; // clickable evidence chain: source → requirement/finding → document → package
  consistencyClass?: FindingClass;
}
export interface PreflightReport {
  siteId: string;
  templateId: string;
  templateName: string;
  ranAt: string;
  canBuild: boolean; // identical to the deterministic release gate
  token: string;
  findings: PreflightFinding[];
  counts: Record<Severity, number>;
  consistency: { checkedPairs: number; byClass: Record<FindingClass, number>; ai: "openai" | "off" | "unavailable"; aiNote?: string };
  lastRelease?: { id: string; number: number; builtAt: string };
}

// ---- Time Machine ----
export interface TimeMachineReport {
  siteId: string;
  templateId: string;
  release: { id: string; number: number; builtAt: string; builtBy: string; snapshotSha256: string; integrityVerified: boolean };
  comparedAt: string;
  newRequirements: { memoryItemId: string; title: string; status: string; confirmedAt?: string; source?: string; requirementId?: string }[];
  addedChecklistDocuments: { requirementId: string; name: string; reason: string }[];
  replacedDocuments: { requirementId: string; name: string; releasedRev: string; releasedSha256: string; currentRev?: string; currentStatus: "approved" | "pending" | "unchanged"; currentRevisionId?: string; factChanges: { label: string; before?: string; after?: string; significance?: string }[] }[];
  newEngineeringTasks: { id: string; kind: "dependency" | "consistency"; status: string; explanation: string; createdAt: string }[];
  resolvedSinceRelease: { id: string; kind: string; label: string; resolvedBy?: string; resolvedAt?: string }[];
  currentBlockers: { code: string; message: string }[];
  attentionReasons: string[];
  freshSubmissionRecommended: boolean;
}
