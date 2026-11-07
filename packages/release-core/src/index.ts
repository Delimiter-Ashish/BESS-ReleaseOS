/** Preferred site/package intelligence API. */
export * from './models.js';
export * from './extraction.js';
export * from './intelligence.js';
export * from './archive.js';
export { IntelligenceError } from './utils.js';
/** Earlier document-centric API retained for existing consumers. */
export { ReleaseEngine, ReleaseCoreError, canonicalJson, checksum, diffLines, verifyRelease } from './legacy.js';
export type {
  Json, ApprovalPolicy, DocumentVersion as LegacyDocumentVersion, Dependency as PinnedDependency,
  Document, Engineer, Approval, AuditEvent, IssueCode, ReadinessIssue, Readiness,
  DependencyAnalysis, Release, VersionInput, RevisionComparison,
} from './legacy.js';
