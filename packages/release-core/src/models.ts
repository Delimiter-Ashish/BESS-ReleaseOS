/** Configurable identifiers; illustrative categories are not universal legal requirements. */
export type DocumentFamily = string;
export interface Site { id: string; name: string; jurisdiction: string }
export const documentationCategories = Object.freeze({
  commissioning: 'commissioning', operationsMaintenance: 'operations-maintenance',
  emergencyOperations: 'emergency-operations-plan', decommissioning: 'decommissioning',
});
export type FactField = 'batteryCapacityKWh' | 'powerRatingKW' | 'manufacturer' | 'equipmentModel' | 'inverterQuantity' | 'voltageV' | 'currentA' | 'frequencyHz' | 'revisionLabel';
export interface SourceEvidence {
  documentVersionId: string;
  excerpt: string;
  /** UTF-16 offsets into DocumentVersion.text; end is exclusive. Page only if supplied by a parser. */
  start: number; end: number; line: number; page?: number;
}
export interface ExtractedFact {
  field: FactField; value: string | number; unit: string | null;
  evidence: SourceEvidence; confidence: number;
  verification: 'source-supported' | 'needs-verification';
  origin: 'deterministic' | 'structured' | 'ai';
}
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export interface DocumentVersion {
  id: string; documentId: string; siteId: string; family: DocumentFamily;
  supplierId: string | null; componentId: string | null;
  title: string; versionNumber: number; revisionLabel: string;
  uploadedAt: string; uploadedBy: string;
  fileName: string; mediaType: string; contentHash: string;
  /** Original bytes, JSON portable. Hash and ZIP contents use these bytes, not extracted text. */
  contentBase64: string; text: string;
  approvalStatus: ApprovalStatus; facts: readonly ExtractedFact[];
}
export interface Reviewer { id: string; name: string; roles: readonly string[]; active: boolean }
export interface ReviewDecision {
  id: string; versionId: string; contentHash: string; reviewerId: string; reviewerName: string;
  reviewerRoles: readonly string[]; decision: 'approved' | 'rejected'; timestamp: string;
  notes: string; resolvedTaskIds: readonly string[];
}
export interface Dependency {
  id: string; siteId: string; sourceDocumentId: string; dependentDocumentId: string;
  /** Empty means any content or semantic change. */
  relevantFields: readonly FactField[]; explanation: string;
}
export interface Requirement {
  id: string; family: DocumentFamily; label: string; minimumCount: number;
  /** Null means any component; otherwise this component must be covered. */
  componentId?: string | null;
}
export interface FactConstraint { field: FactField; families: readonly DocumentFamily[]; componentId?: string }
export interface PackageTemplate {
  id: string; name: string; stage: string; packageType: string;
  requirements: readonly Requirement[];
  /** Application-authored jurisdiction rules; never inferred from the site name. */
  jurisdictionRequirements: readonly { jurisdiction: string; requirements: readonly Requirement[] }[];
  consistencyChecks: readonly FactConstraint[];
}
export interface SemanticChange {
  field: FactField; oldValue: readonly (string | number)[]; newValue: readonly (string | number)[];
  oldEvidence: readonly SourceEvidence[]; newEvidence: readonly SourceEvidence[];
  verification: 'source-supported' | 'needs-verification'; confidence: number;
  engineeringReviewRequired: boolean;
}
export interface VersionComparison {
  documentId: string; fromVersionId: string; toVersionId: string;
  contentChanged: boolean; revisionLabelChanged: boolean; changes: readonly SemanticChange[];
}
export interface ReviewTask {
  id: string; siteId: string; sourceVersionId: string; sourceDocumentId: string;
  dependentDocumentId: string; dependencyPath: readonly string[];
  changedFields: readonly FactField[]; explanation: string;
  status: 'open' | 'resolved' | 'superseded'; resolvedByDecisionId: string | null;
}
export interface ImpactAnalysis {
  sourceVersionId: string; affectedDocumentIds: readonly string[];
  impactedTemplateIds: readonly string[]; tasks: readonly ReviewTask[];
}
export type ReadinessCode = 'MISSING_DOCUMENT' | 'PENDING_REVIEW' | 'REJECTED_VERSION' | 'NO_APPROVED_VERSION' | 'CHANGED_SOURCE' | 'FIELD_CONFLICT' | 'UNVERIFIED_FACT' | 'EMPTY_DOCUMENT' | 'DEPENDENCY_CYCLE' | 'DEPENDENCY_SOURCE_MISSING' | 'NO_REQUIREMENTS' | 'APPROVAL_INVALID';
export interface PackageIssue { code: ReadinessCode; message: string; documentIds: readonly string[]; requirementId?: string; taskId?: string; field?: FactField }
export interface PackageReadiness {
  siteId: string; templateId: string; stage: string; readyForHumanSignoff: boolean;
  selectedVersionIds: readonly string[]; approvedVersionIds: readonly string[];
  pendingVersionIds: readonly string[]; rejectedVersionIds: readonly string[];
  issues: readonly PackageIssue[];
  /** Optimistic token covers current versions, decisions, graph, tasks and applicable template. */
  token: string;
}
export interface ReleaseManifestEntry {
  documentId: string; versionId: string; family: DocumentFamily; componentId: string | null;
  revisionLabel: string; fileName: string; mediaType: string; sha256: string; archivePath: string;
}
export interface ReleaseSnapshot {
  schemaVersion: 1; id: string; siteId: string; templateId: string; packageType: string;
  stage: string; builtAt: string; builtBy: string; signoffNotes: string;
  /** Configuration and site at build time; later edits cannot change this snapshot. */
  site: Site; template: PackageTemplate;
  manifest: readonly ReleaseManifestEntry[];
  documents: readonly DocumentVersion[]; reviewerApprovals: readonly ReviewDecision[];
  dependencies: readonly Dependency[]; reviewTasks: readonly ReviewTask[];
  readinessToken: string;
  /** Optional application metadata frozen at build time (e.g. a human-readable manifest, original app records). Covered by sha256. */
  annotations?: { readonly [key: string]: unknown };
  sha256: string;
}
export interface ReleaseComparison {
  fromReleaseId: string; toReleaseId: string;
  added: readonly ReleaseManifestEntry[]; removed: readonly ReleaseManifestEntry[];
  updated: readonly { documentId: string; fromVersionId: string; toVersionId: string; contentChanged: boolean; semanticChanges: readonly SemanticChange[] }[];
}
export interface FactInput {
  field: FactField; value: string | number; unit?: string | null;
  evidence: Omit<SourceEvidence, 'documentVersionId'>;
  confidence?: number; verification?: ExtractedFact['verification'];
}
export interface IngestDocumentInput {
  documentId: string; siteId: string; family: DocumentFamily;
  supplierId?: string | null; componentId?: string | null;
  title: string; revisionLabel: string; uploadedBy: string;
  fileName: string; mediaType: string;
  content: string | Uint8Array;
  /** For binary uploads, supply extracted text. No built-in PDF/OCR parser. */
  text?: string; facts?: readonly FactInput[];
}
export interface IngestResult { duplicate: boolean; version: DocumentVersion; comparison: VersionComparison | null; impacts: ImpactAnalysis }
/** Optional adapter is explicitly invoked by the caller; the engine never makes network calls. */
export interface AIExtractionAdapter {
  extract(input: { versionId: string; text: string }): Promise<readonly FactInput[]>;
}
