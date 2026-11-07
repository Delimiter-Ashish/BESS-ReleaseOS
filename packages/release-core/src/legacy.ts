import { createHash, randomUUID } from 'node:crypto';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Dependency { documentId: string; versionId: string }
export interface ApprovalPolicy { requiredRoles: string[]; minimumApprovals: number; allowAuthorApproval: boolean }
export interface DocumentVersion {
  id: string; documentId: string; revision: number; title: string; content: string;
  metadata: Readonly<Record<string, Json>>; dependencies: readonly Dependency[];
  authorId: string; createdAt: string; checksum: string;
}
export interface Document { id: string; versions: readonly DocumentVersion[] }
export interface Engineer { id: string; name: string; roles: readonly string[]; active: boolean }
export interface Approval {
  id: string; documentId: string; versionId: string; checksum: string;
  engineerId: string; roles: readonly string[]; decision: 'approved' | 'rejected';
  comment: string; createdAt: string;
}
export interface AuditEvent { sequence: number; type: string; actorId: string; subjectId: string; at: string; previousHash: string; hash: string }
export type IssueCode = 'MISSING_DOCUMENT' | 'MISSING_DEPENDENCY' | 'MISSING_DEPENDENCY_VERSION' | 'STALE_DEPENDENCY' | 'DEPENDENCY_CYCLE' | 'EMPTY_CONTENT' | 'APPROVAL_REJECTED' | 'INSUFFICIENT_APPROVALS' | 'MISSING_ROLE' | 'EMPTY_SUBMISSION';
export interface ReadinessIssue { code: IssueCode; documentId: string; message: string }
export interface Readiness { ready: boolean; documentIds: readonly string[]; versionIds: readonly string[]; issues: readonly ReadinessIssue[] }
export interface DependencyAnalysis { documentIds: readonly string[]; edges: readonly { from: string; to: string; versionId: string }[]; issues: readonly ReadinessIssue[]; buildOrder: readonly string[] }
export interface Release {
  schemaVersion: 1; id: string; name: string; createdAt: string; createdBy: string;
  policy: ApprovalPolicy; documents: readonly DocumentVersion[]; approvals: readonly Approval[];
  auditHead: string; checksum: string;
}
export interface VersionInput { title: string; content: string; authorId: string; metadata?: Record<string, Json>; dependencies?: readonly Dependency[] }
export interface RevisionComparison {
  documentId: string; fromVersionId: string; toVersionId: string; changed: boolean;
  titleChanged: boolean; metadataChanged: boolean; dependenciesChanged: boolean;
  lines: readonly { type: 'equal' | 'added' | 'removed'; text: string }[];
  addedLines: number; removedLines: number;
}
export class ReleaseCoreError extends Error {
  constructor(public readonly code: string, message: string, public readonly issues: readonly ReadinessIssue[] = []) { super(message); this.name = 'ReleaseCoreError'; }
}
function fail(code: string, message: string): never { throw new ReleaseCoreError(code, message); }
function required(value: string, label: string): void { if (typeof value !== 'string' || !value.trim()) fail('INVALID_INPUT', `${label} must be nonempty`); }
/** Canonical JSON: sorted object keys, preserved array order, finite numbers only. */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  function encode(v: unknown): string {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== 'object' || v === null || seen.has(v)) return fail('INVALID_JSON', 'Expected acyclic JSON values');
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return fail('INVALID_JSON', 'Expected plain JSON objects');
    seen.add(v);
    const result = Array.isArray(v) ? `[${Array.from(v, encode).join(',')}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${encode((v as Record<string, unknown>)[k])}`).join(',')}}`;
    seen.delete(v); return result;
  }
  return encode(value);
}
export function checksum(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function snapshot<T>(value: T): T { return freeze(JSON.parse(canonicalJson(value)) as T); }
function versionHash(version: DocumentVersion): string { const { checksum: ignored, ...body } = version; return checksum(body); }
export function verifyRelease(release: Release): boolean {
  try {
    const { checksum: expected, ...body } = release;
    return release.schemaVersion === 1 && checksum(body) === expected && release.documents.every(v => versionHash(v) === v.checksum);
  } catch { return false; }
}

/** Server-side engine. Identity authentication and durable storage belong to the caller. */
export class ReleaseEngine {
  private documents = new Map<string, DocumentVersion[]>();
  private engineers = new Map<string, Engineer>();
  private approvals: Approval[] = [];
  private releases = new Map<string, Release>();
  private events: AuditEvent[] = [];
  readonly policy: ApprovalPolicy;
  constructor(options: { policy?: Partial<ApprovalPolicy>; clock?: () => Date; idFactory?: () => string } = {}) {
    const policy = { requiredRoles: ['engineer'], minimumApprovals: 1, allowAuthorApproval: false, ...options.policy };
    if (!Number.isInteger(policy.minimumApprovals) || policy.minimumApprovals < 1 || typeof policy.allowAuthorApproval !== 'boolean' || !Array.isArray(policy.requiredRoles)) fail('INVALID_POLICY', 'Invalid approval policy');
    policy.requiredRoles.forEach(role => required(role, 'Role'));
    this.policy = snapshot({ ...policy, requiredRoles: [...new Set(policy.requiredRoles)].sort() });
    this.clock = options.clock ?? (() => new Date()); this.idFactory = options.idFactory ?? randomUUID;
  }
  private clock: () => Date;
  private idFactory: () => string;
  private usedIds = new Set<string>();
  private id(): string { const id = this.idFactory(); required(id, 'Generated ID'); if (this.usedIds.has(id)) fail('DUPLICATE_ID', `Duplicate generated ID: ${id}`); this.usedIds.add(id); return id; }
  private now(): string { return this.clock().toISOString(); }
  private audit(type: string, actorId: string, subjectId: string): void {
    const body = { sequence: this.events.length + 1, type, actorId, subjectId, at: this.now(), previousHash: this.events.at(-1)?.hash ?? '' };
    this.events.push(snapshot({ ...body, hash: checksum(body) }));
  }
  registerEngineer(input: Engineer): Engineer {
    required(input.id, 'Engineer ID'); required(input.name, 'Engineer name');
    if (!Array.isArray(input.roles) || typeof input.active !== 'boolean') fail('INVALID_INPUT', 'Invalid engineer');
    input.roles.forEach(role => required(role, 'Role'));
    const engineer = snapshot({ ...input, roles: [...new Set(input.roles)].sort() });
    this.engineers.set(input.id, engineer); this.audit('ENGINEER_REGISTERED', input.id, input.id); return engineer;
  }
  createDocument(input: VersionInput & { documentId?: string }): DocumentVersion {
    const id = input.documentId ?? this.id(); required(id, 'Document ID');
    if (this.documents.has(id)) fail('DOCUMENT_EXISTS', `Document ${id} already exists`);
    const version = this.makeVersion(id, 1, input);
    this.documents.set(id, [version]); this.audit('DOCUMENT_CREATED', input.authorId, version.id); return version;
  }
  reviseDocument(documentId: string, input: VersionInput, expectedVersionId: string): DocumentVersion {
    const versions = this.history(documentId);
    if (versions.at(-1)!.id !== expectedVersionId) fail('VERSION_CONFLICT', 'Document changed since it was read');
    const version = this.makeVersion(documentId, versions.length + 1, input);
    versions.push(version); this.audit('DOCUMENT_REVISED', input.authorId, version.id); return version;
  }
  private makeVersion(documentId: string, revision: number, input: VersionInput): DocumentVersion {
    required(input.title, 'Title'); required(input.authorId, 'Author ID');
    if (typeof input.content !== 'string') fail('INVALID_INPUT', 'Content must be a string');
    const dependencies = [...(input.dependencies ?? [])].map(d => { required(d.documentId, 'Dependency document ID'); required(d.versionId, 'Dependency version ID'); return { documentId: d.documentId, versionId: d.versionId }; }).sort((a, b) => a.documentId.localeCompare(b.documentId));
    if (new Set(dependencies.map(d => d.documentId)).size !== dependencies.length) fail('INVALID_INPUT', 'Duplicate dependency');
    const body = snapshot({ id: this.id(), documentId, revision, title: input.title, content: input.content, metadata: input.metadata ?? {}, dependencies, authorId: input.authorId, createdAt: this.now() });
    return snapshot({ ...body, checksum: checksum(body) });
  }
  private history(id: string): DocumentVersion[] { return this.documents.get(id) ?? fail('DOCUMENT_NOT_FOUND', `Document ${id} not found`); }
  getDocument(id: string): Document { return snapshot({ id, versions: this.history(id) }); }
  listDocuments(): readonly Document[] { return snapshot([...this.documents.keys()].sort().map(id => this.getDocument(id))); }
  getVersion(documentId: string, versionId?: string): DocumentVersion {
    const versions = this.history(documentId);
    return (versionId === undefined ? versions.at(-1) : versions.find(v => v.id === versionId)) ?? fail('VERSION_NOT_FOUND', `Version ${versionId} not found in ${documentId}`);
  }
  compareRevisions(documentId: string, fromVersionId: string, toVersionId: string): RevisionComparison {
    const a = this.getVersion(documentId, fromVersionId), b = this.getVersion(documentId, toVersionId);
    const lines = diffLines(a.content, b.content);
    const titleChanged = a.title !== b.title, metadataChanged = canonicalJson(a.metadata) !== canonicalJson(b.metadata), dependenciesChanged = canonicalJson(a.dependencies) !== canonicalJson(b.dependencies);
    return snapshot({ documentId, fromVersionId, toVersionId, changed: a.content !== b.content || titleChanged || metadataChanged || dependenciesChanged, titleChanged, metadataChanged, dependenciesChanged, lines, addedLines: lines.filter(l => l.type === 'added').length, removedLines: lines.filter(l => l.type === 'removed').length });
  }
  analyzeDependencies(roots: readonly string[]): DependencyAnalysis {
    const visited = new Set<string>(), visiting = new Set<string>(), buildOrder: string[] = [], edges: { from: string; to: string; versionId: string }[] = [], issues: ReadinessIssue[] = [];
    const issue = (code: IssueCode, documentId: string, message: string) => issues.push({ code, documentId, message });
    const visit = (id: string, parent?: string): void => {
      if (visiting.has(id)) { issue('DEPENDENCY_CYCLE', id, `Cycle through ${id}`); return; }
      if (visited.has(id)) return;
      if (!this.documents.has(id)) { issue(parent ? 'MISSING_DEPENDENCY' : 'MISSING_DOCUMENT', parent ?? id, `Missing document ${id}`); return; }
      visited.add(id); visiting.add(id);
      for (const dependency of this.getVersion(id).dependencies) {
        edges.push({ from: id, to: dependency.documentId, versionId: dependency.versionId });
        const history = this.documents.get(dependency.documentId);
        if (history && !history.some(v => v.id === dependency.versionId)) issue('MISSING_DEPENDENCY_VERSION', id, `Missing version ${dependency.versionId} of ${dependency.documentId}`);
        else if (history && history.at(-1)!.id !== dependency.versionId) issue('STALE_DEPENDENCY', id, `Dependency ${dependency.documentId} has a newer revision`);
        visit(dependency.documentId, id);
      }
      visiting.delete(id); buildOrder.push(id);
    };
    [...new Set(roots)].sort().forEach(id => visit(id));
    return snapshot({ documentIds: [...visited].sort(), edges, issues, buildOrder });
  }
  /** Direct and transitive dependents requiring review when this document changes. */
  analyzeImpact(documentId: string): readonly string[] {
    this.history(documentId); const affected = new Set<string>();
    const visit = (id: string): void => { for (const [candidate, history] of this.documents) if (candidate !== documentId && !affected.has(candidate) && history.at(-1)!.dependencies.some(d => d.documentId === id)) { affected.add(candidate); visit(candidate); } };
    visit(documentId); return snapshot([...affected].sort());
  }
  recordApproval(input: { documentId: string; versionId: string; engineerId: string; decision: 'approved' | 'rejected'; comment?: string }): Approval {
    const version = this.getVersion(input.documentId, input.versionId);
    if (this.getVersion(input.documentId).id !== version.id) fail('STALE_VERSION', 'Only the current version may be approved');
    const engineer = this.engineers.get(input.engineerId);
    if (!engineer?.active) fail('UNAUTHORIZED_ENGINEER', 'Engineer must be registered and active');
    if (!this.policy.allowAuthorApproval && version.authorId === engineer.id) fail('SELF_APPROVAL', 'Author cannot approve their own revision');
    if (input.decision !== 'approved' && input.decision !== 'rejected') fail('INVALID_INPUT', 'Invalid approval decision');
    if (input.comment !== undefined && typeof input.comment !== 'string') fail('INVALID_INPUT', 'Comment must be a string');
    const approval = snapshot({ ...input, id: this.id(), checksum: version.checksum, roles: engineer.roles, comment: input.comment ?? '', createdAt: this.now() });
    this.approvals.push(approval); this.audit('APPROVAL_RECORDED', engineer.id, approval.id); return approval;
  }
  getApprovals(documentId?: string): readonly Approval[] { return snapshot(this.approvals.filter(a => documentId === undefined || a.documentId === documentId)); }
  private effectiveApprovals(version: DocumentVersion): Approval[] {
    const latest = new Map<string, Approval>();
    for (const a of this.approvals) if (a.versionId === version.id && a.checksum === version.checksum) latest.set(a.engineerId, a);
    return [...latest.values()].filter(a => this.engineers.get(a.engineerId)?.active);
  }
  checkReadiness(documentIds: readonly string[]): Readiness {
    const analysis = this.analyzeDependencies(documentIds), issues = [...analysis.issues];
    if (!documentIds.length) issues.push({ code: 'EMPTY_SUBMISSION', documentId: '', message: 'Select at least one document' });
    const versionIds: string[] = [];
    for (const id of analysis.documentIds) {
      const version = this.getVersion(id); versionIds.push(version.id);
      const approvals = this.effectiveApprovals(version), approved = approvals.filter(a => a.decision === 'approved');
      if (!version.content.trim()) issues.push({ code: 'EMPTY_CONTENT', documentId: id, message: 'Document content is empty' });
      if (approvals.some(a => a.decision === 'rejected')) issues.push({ code: 'APPROVAL_REJECTED', documentId: id, message: 'A current engineer decision rejects this revision' });
      if (approved.length < this.policy.minimumApprovals) issues.push({ code: 'INSUFFICIENT_APPROVALS', documentId: id, message: `Requires ${this.policy.minimumApprovals} distinct engineer approvals` });
      for (const role of this.policy.requiredRoles) if (!approved.some(a => a.roles.includes(role) && this.engineers.get(a.engineerId)!.roles.includes(role))) issues.push({ code: 'MISSING_ROLE', documentId: id, message: `Missing approval from role ${role}` });
    }
    return snapshot({ ready: issues.length === 0, documentIds: analysis.documentIds, versionIds, issues });
  }
  generateRelease(input: { name: string; createdBy: string; documentIds: readonly string[]; expectedVersionIds: readonly string[] }): Release {
    required(input.name, 'Release name'); required(input.createdBy, 'Release creator');
    const readiness = this.checkReadiness(input.documentIds);
    if (!readiness.ready) throw new ReleaseCoreError('NOT_READY', 'Submission is not ready', readiness.issues);
    if (canonicalJson([...input.expectedVersionIds].sort()) !== canonicalJson([...readiness.versionIds].sort())) fail('VERSION_CONFLICT', 'Submission versions changed; check readiness again');
    const documents = readiness.documentIds.map(id => this.getVersion(id));
    const approvals = documents.flatMap(v => this.effectiveApprovals(v)).sort((a, b) => a.id.localeCompare(b.id));
    const body = { schemaVersion: 1 as const, id: this.id(), name: input.name, createdAt: this.now(), createdBy: input.createdBy, policy: this.policy, documents, approvals, auditHead: this.events.at(-1)?.hash ?? '' };
    const release = snapshot({ ...body, checksum: checksum(body) }); this.releases.set(release.id, release); this.audit('RELEASE_GENERATED', input.createdBy, release.id); return release;
  }
  getRelease(id: string): Release { return this.releases.get(id) ?? fail('RELEASE_NOT_FOUND', `Release ${id} not found`); }
  listReleases(): readonly Release[] { return snapshot([...this.releases.values()]); }
  getAuditTrail(): readonly AuditEvent[] { return snapshot(this.events); }
}

/** LCS line diff with bounded memory/time; large inputs use a lossless replacement diff. */
export function diffLines(before: string, after: string): RevisionComparison['lines'] {
  const a = before === '' ? [] : before.split('\n'), b = after === '' ? [] : after.split('\n');
  type Line = RevisionComparison['lines'][number];
  if (before === after) return snapshot(a.map(text => ({ type: 'equal' as const, text })));
  if ((a.length + 1) * (b.length + 1) > 1_000_000) return snapshot([...a.map(text => ({ type: 'removed' as const, text })), ...b.map(text => ({ type: 'added' as const, text }))]);
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const lines: Line[] = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { lines.push({ type: 'equal', text: a[i++]! }); j++; }
    else if (j < b.length && (i === a.length || table[i]![j + 1]! > table[i + 1]![j]!)) lines.push({ type: 'added', text: b[j++]! });
    else lines.push({ type: 'removed', text: a[i++]! });
  }
  return snapshot(lines);
}
