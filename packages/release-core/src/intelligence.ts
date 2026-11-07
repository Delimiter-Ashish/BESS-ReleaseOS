import { randomUUID } from 'node:crypto';
import type { Dependency, DocumentVersion, ImpactAnalysis, IngestDocumentInput, IngestResult, PackageIssue, PackageReadiness, PackageTemplate, ReleaseComparison, ReleaseSnapshot, ReviewDecision, Reviewer, ReviewTask, Site, VersionComparison } from './models.js';
import { compareVersions, extractFacts, validateFacts } from './extraction.js';
import { bytesHash, canonicalJson, checksum, immutable, IntelligenceError, requireText, sortedUnique } from './utils.js';
import { createReleaseZip } from './archive.js';

/** Trusted, project-scoped service. No network or persistence side effects. */
export class ReleaseOS {
  private sites = new Map<string, Site>();
  private templates = new Map<string, PackageTemplate>();
  private versions = new Map<string, DocumentVersion>();
  private histories = new Map<string, string[]>();
  private reviewers = new Map<string, Reviewer>();
  private decisions: ReviewDecision[] = [];
  private dependencies = new Map<string, Dependency>();
  private tasks = new Map<string, ReviewTask>();
  private releases = new Map<string, ReleaseSnapshot>();
  private ids = new Set<string>();
  private clock: () => Date;
  private idFactory: () => string;
  constructor(options: { clock?: () => Date; idFactory?: () => string; allowAuthorApproval?: boolean } = {}) {
    this.clock = options.clock ?? (() => new Date()); this.idFactory = options.idFactory ?? randomUUID;
    this.allowAuthorApproval = options.allowAuthorApproval ?? false;
  }
  private readonly allowAuthorApproval: boolean;
  private id(): string {
    const id = this.idFactory(); requireText(id, 'Generated ID');
    if (this.ids.has(id)) throw new IntelligenceError('DUPLICATE_ID', 'Generated ID was already used');
    this.ids.add(id); return id;
  }
  private site(id: string): Site { return this.sites.get(id) ?? this.error('SITE_NOT_FOUND', `Unknown site ${id}`); }
  private template(id: string): PackageTemplate { return this.templates.get(id) ?? this.error('TEMPLATE_NOT_FOUND', `Unknown template ${id}`); }
  private error(code: string, message: string): never { throw new IntelligenceError(code, message); }
  registerSite(site: Site): Site {
    requireText(site.id, 'Site ID'); requireText(site.name, 'Site name'); requireText(site.jurisdiction, 'Jurisdiction');
    const copy = immutable(site); this.sites.set(site.id, copy); return copy;
  }
  registerReviewer(reviewer: Reviewer): Reviewer {
    requireText(reviewer.id, 'Reviewer ID'); requireText(reviewer.name, 'Reviewer name');
    if (!Array.isArray(reviewer.roles) || typeof reviewer.active !== 'boolean') return this.error('INVALID_REVIEWER', 'Invalid reviewer roles or status');
    reviewer.roles.forEach(role => requireText(role, 'Reviewer role'));
    const copy = immutable({ ...reviewer, roles: sortedUnique(reviewer.roles) }); this.reviewers.set(copy.id, copy); return copy;
  }
  registerTemplate(template: PackageTemplate): PackageTemplate {
    for (const key of ['id', 'name', 'stage', 'packageType'] as const) requireText(template[key], `Template ${key}`);
    const requirements = [...template.requirements, ...template.jurisdictionRequirements.flatMap(rule => { requireText(rule.jurisdiction, 'Jurisdiction'); return rule.requirements; })];
    const ids = new Set<string>();
    for (const requirement of requirements) {
      requireText(requirement.id, 'Requirement ID'); requireText(requirement.family, 'Document family'); requireText(requirement.label, 'Requirement label');
      if (!Number.isInteger(requirement.minimumCount) || requirement.minimumCount < 1 || ids.has(requirement.id)) return this.error('INVALID_TEMPLATE', 'Requirements need unique IDs and positive integer counts');
      ids.add(requirement.id);
    }
    const copy = immutable(template); this.templates.set(copy.id, copy); return copy;
  }
  addDependency(dependency: Dependency): Dependency {
    requireText(dependency.id, 'Dependency ID'); requireText(dependency.explanation, 'Dependency explanation'); this.site(dependency.siteId);
    const source = this.getLatestVersion(dependency.sourceDocumentId), target = this.getLatestVersion(dependency.dependentDocumentId);
    if (source.siteId !== dependency.siteId || target.siteId !== dependency.siteId) return this.error('SITE_MISMATCH', 'Dependencies cannot cross sites');
    if (this.dependencies.has(dependency.id)) return this.error('DEPENDENCY_EXISTS', 'Dependency ID already exists');
    const copy = immutable(dependency); this.dependencies.set(copy.id, copy); return copy;
  }
  listDependencies(siteId: string): readonly Dependency[] { this.site(siteId); return immutable([...this.dependencies.values()].filter(d => d.siteId === siteId)); }
  ingestDocument(input: IngestDocumentInput): IngestResult {
    this.site(input.siteId);
    for (const key of ['documentId', 'family', 'title', 'revisionLabel', 'uploadedBy', 'fileName', 'mediaType'] as const) requireText(input[key], key);
    if (!(typeof input.content === 'string' || input.content instanceof Uint8Array)) return this.error('INVALID_CONTENT', 'Content must be text or bytes');
    if (input.text !== undefined && typeof input.text !== 'string') return this.error('INVALID_CONTENT', 'Extracted text must be a string');
    const bytes = typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : Buffer.from(input.content);
    const contentHash = bytesHash(bytes);
    const history = this.histories.get(input.documentId) ?? [];
    const previous = history.length ? this.getLatestVersion(input.documentId) : null;
    const supplierId = input.supplierId ?? null, componentId = input.componentId ?? null;
    if (previous && (previous.siteId !== input.siteId || previous.family !== input.family || previous.supplierId !== supplierId || previous.componentId !== componentId)) return this.error('IDENTITY_MISMATCH', 'Document site, family, supplier and component identity cannot change across versions');
    // Identical bytes within the same identity are idempotent, even when re-uploaded after another revision.
    const duplicateId = history.find(id => this.versions.get(id)!.contentHash === contentHash);
    if (duplicateId) {
      const version = this.getVersion(duplicateId);
      return immutable({ duplicate: true, version, comparison: null, impacts: this.calculateImpacts(version.id) });
    }
    const id = this.id();
    const text = input.text ?? (typeof input.content === 'string' ? input.content : '');
    const deterministic = extractFacts(text, id), supplied = validateFacts(text, id, input.facts ?? []);
    const facts = [...deterministic, ...supplied].filter((fact, index, all) => all.findIndex(f => f.field === fact.field && f.value === fact.value && f.evidence.start === fact.evidence.start && f.evidence.end === fact.evidence.end) === index);
    const version: DocumentVersion = immutable({ id, documentId: input.documentId, siteId: input.siteId, family: input.family, supplierId, componentId, title: input.title, versionNumber: history.length + 1, revisionLabel: input.revisionLabel, uploadedAt: this.clock().toISOString(), uploadedBy: input.uploadedBy, fileName: input.fileName, mediaType: input.mediaType, contentHash, contentBase64: bytes.toString('base64'), text, approvalStatus: 'pending', facts });
    const baseline = previous ? this.getLatestApprovedVersion(input.documentId) ?? previous : null;
    const comparison = baseline ? compareVersions(baseline, version) : null;
    this.versions.set(id, version); this.histories.set(input.documentId, [...history, id]);
    // Carry unresolved change fields forward even when the source was approved before
    // its dependents were reviewed. A cosmetic third upload cannot erase that review.
    const inheritedFields = [...this.tasks.values()].filter(t => t.sourceDocumentId === input.documentId && t.status === 'open').flatMap(t => t.changedFields);
    // An obsolete pending upload must not leave unresolvable tasks behind.
    for (const [taskId, task] of this.tasks) if (task.sourceDocumentId === input.documentId && task.status === 'open') this.tasks.set(taskId, immutable({ ...task, status: 'superseded' }));
    if (comparison && (comparison.contentChanged || comparison.revisionLabelChanged || comparison.changes.length || inheritedFields.length)) this.propagate(version, comparison, inheritedFields);
    return immutable({ duplicate: false, version, comparison, impacts: this.calculateImpacts(id) });
  }
  private latestDecision(versionId: string): ReviewDecision | null { return [...this.decisions].reverse().find(d => d.versionId === versionId) ?? null; }
  private validReviewer(id: string): Reviewer {
    const reviewer = this.reviewers.get(id);
    if (!reviewer?.active || !reviewer.roles.includes('engineer')) return this.error('UNAUTHORIZED_REVIEWER', 'An active registered engineer is required');
    return reviewer;
  }
  private approvalValid(decision: ReviewDecision): boolean {
    const reviewer = this.reviewers.get(decision.reviewerId);
    return decision.decision === 'approved' && decision.reviewerRoles.includes('engineer') && !!reviewer?.active && reviewer.roles.includes('engineer');
  }
  getVersion(id: string): DocumentVersion {
    const stored = this.versions.get(id) ?? this.error('VERSION_NOT_FOUND', `Unknown version ${id}`);
    return immutable({ ...stored, approvalStatus: this.latestDecision(id)?.decision ?? 'pending' });
  }
  getLatestVersion(documentId: string): DocumentVersion {
    const id = this.histories.get(documentId)?.at(-1) ?? this.error('DOCUMENT_NOT_FOUND', `Unknown document ${documentId}`); return this.getVersion(id);
  }
  getDocumentHistory(documentId: string): readonly DocumentVersion[] {
    const ids = this.histories.get(documentId) ?? this.error('DOCUMENT_NOT_FOUND', `Unknown document ${documentId}`);
    return immutable(ids.map(id => this.getVersion(id)));
  }
  getLatestApprovedVersion(documentId: string): DocumentVersion | null {
    const history = this.histories.get(documentId) ?? this.error('DOCUMENT_NOT_FOUND', `Unknown document ${documentId}`);
    for (const id of [...history].reverse()) { const decision = this.latestDecision(id); if (decision && this.approvalValid(decision)) return this.getVersion(id); }
    return null;
  }
  listDocuments(siteId: string): readonly { documentId: string; latest: DocumentVersion; latestApproved: DocumentVersion | null }[] {
    this.site(siteId);
    return immutable([...this.histories.keys()].sort().filter(id => this.getLatestVersion(id).siteId === siteId).map(documentId => ({ documentId, latest: this.getLatestVersion(documentId), latestApproved: this.getLatestApprovedVersion(documentId) })));
  }
  compareVersions(fromId: string, toId: string): VersionComparison { return compareVersions(this.getVersion(fromId), this.getVersion(toId)); }
  private propagate(source: DocumentVersion, comparison: VersionComparison, inheritedFields: readonly import('./models.js').FactField[] = []): void {
    const changedFields = [...new Set([...comparison.changes.map(c => c.field), ...inheritedFields])];
    const queue: { documentId: string; path: string[]; explanations: string[] }[] = [{ documentId: source.documentId, path: [source.documentId], explanations: [] }];
    const visited = new Set<string>([source.documentId]);
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of this.dependencies.values()) {
        if (edge.siteId !== source.siteId || edge.sourceDocumentId !== current.documentId) continue;
        if (current.path.length === 1 && edge.relevantFields.length && !edge.relevantFields.some(f => changedFields.includes(f))) continue;
        if (visited.has(edge.dependentDocumentId)) continue;
        visited.add(edge.dependentDocumentId);
        const path = [...current.path, edge.dependentDocumentId], explanations = [...current.explanations, edge.explanation];
        const task: ReviewTask = immutable({ id: this.id(), siteId: source.siteId, sourceVersionId: source.id, sourceDocumentId: source.documentId, dependentDocumentId: edge.dependentDocumentId, dependencyPath: path, changedFields, explanation: `${source.title} ${source.revisionLabel} changed ${changedFields.join(', ') || 'document content'}. ${explanations.join(' → ')}. Human review is required; this is not a legal compliance determination.`, status: 'open', resolvedByDecisionId: null });
        this.tasks.set(task.id, task); queue.push({ documentId: edge.dependentDocumentId, path, explanations });
      }
    }
  }
  getReviewTasks(siteId: string): readonly ReviewTask[] { this.site(siteId); return immutable([...this.tasks.values()].filter(t => t.siteId === siteId)); }
  calculateImpacts(versionId: string): ImpactAnalysis {
    const version = this.getVersion(versionId), tasks = [...this.tasks.values()].filter(t => t.sourceVersionId === versionId);
    const affectedDocumentIds = sortedUnique(tasks.map(t => t.dependentDocumentId));
    const families = new Set([version.family, ...affectedDocumentIds.map(id => this.getLatestVersion(id).family)]);
    const impactedTemplateIds = [...this.templates.values()].filter(t => [...t.requirements, ...t.jurisdictionRequirements.filter(j => j.jurisdiction === this.site(version.siteId).jurisdiction).flatMap(j => j.requirements)].some(r => families.has(r.family))).map(t => t.id).sort();
    return immutable({ sourceVersionId: versionId, affectedDocumentIds, impactedTemplateIds, tasks });
  }
  reviewDocument(input: { versionId: string; reviewerId: string; decision: 'approved' | 'rejected'; notes: string; resolvedTaskIds?: readonly string[] }): { decision: ReviewDecision; impactedPackages: readonly PackageReadiness[] } {
    const reviewer = this.validReviewer(input.reviewerId), version = this.getVersion(input.versionId);
    requireText(input.notes, 'Review notes');
    if (input.decision !== 'approved' && input.decision !== 'rejected') return this.error('INVALID_DECISION', 'Explicit approved or rejected decision required');
    if (!this.allowAuthorApproval && reviewer.id === version.uploadedBy) return this.error('SELF_APPROVAL', 'Uploader cannot approve or reject their own document');
    if (this.getLatestVersion(version.documentId).id !== version.id) return this.error('STALE_VERSION', 'Review the current upload rather than a superseded version');
    const tasks = sortedUnique(input.resolvedTaskIds ?? []).map(id => this.tasks.get(id) ?? this.error('TASK_NOT_FOUND', `Unknown task ${id}`));
    if (tasks.length && input.decision !== 'approved') return this.error('INVALID_TASK_RESOLUTION', 'Only an explicit approval may resolve review tasks');
    for (const task of tasks) {
      if (task.status !== 'open' || task.dependentDocumentId !== version.documentId) return this.error('INVALID_TASK_RESOLUTION', 'Task must be open and target this document');
      if (this.getLatestVersion(task.sourceDocumentId).id !== task.sourceVersionId || this.getLatestApprovedVersion(task.sourceDocumentId)?.id !== task.sourceVersionId) return this.error('SOURCE_NOT_APPROVED', 'Approve the exact current source revision before resolving dependent reviews');
    }
    const decision: ReviewDecision = immutable({ id: this.id(), versionId: version.id, contentHash: version.contentHash, reviewerId: reviewer.id, reviewerName: reviewer.name, reviewerRoles: reviewer.roles, decision: input.decision, timestamp: this.clock().toISOString(), notes: input.notes, resolvedTaskIds: tasks.map(t => t.id) });
    this.decisions.push(decision);
    for (const task of tasks) this.tasks.set(task.id, immutable({ ...task, status: 'resolved', resolvedByDecisionId: decision.id }));
    return immutable({ decision, impactedPackages: [...this.templates.keys()].sort().map(templateId => this.evaluateReadiness(version.siteId, templateId)) });
  }
  getReviewDecisions(versionId?: string): readonly ReviewDecision[] { return immutable(this.decisions.filter(d => versionId === undefined || d.versionId === versionId)); }
  evaluateReadiness(siteId: string, templateId: string): PackageReadiness {
    const site = this.site(siteId), template = this.template(templateId);
    const requirements = [...template.requirements, ...template.jurisdictionRequirements.filter(r => r.jurisdiction === site.jurisdiction).flatMap(r => r.requirements)];
    const issues: PackageIssue[] = [], documentIds = new Set<string>();
    const documents = this.listDocuments(siteId);
    if (!requirements.length) issues.push({ code: 'NO_REQUIREMENTS', message: 'Configure stage-specific requirements before signoff', documentIds: [] });
    for (const requirement of requirements) {
      const matches = documents.filter(d => d.latest.family === requirement.family && (requirement.componentId == null || d.latest.componentId === requirement.componentId));
      matches.forEach(d => documentIds.add(d.documentId));
      if (matches.length < requirement.minimumCount) issues.push({ code: 'MISSING_DOCUMENT', message: `${requirement.label}: need ${requirement.minimumCount}, found ${matches.length}`, documentIds: matches.map(d => d.documentId), requirementId: requirement.id });
    }
    // Include all upstream sources of selected documents in signoff and release manifests.
    const visiting = new Set<string>(), visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) { issues.push({ code: 'DEPENDENCY_CYCLE', message: `Dependency cycle through ${id}`, documentIds: [id] }); return; }
      if (visited.has(id)) return;
      visiting.add(id); visited.add(id);
      for (const edge of this.dependencies.values()) if (edge.siteId === siteId && edge.dependentDocumentId === id) { documentIds.add(edge.sourceDocumentId); visit(edge.sourceDocumentId); }
      visiting.delete(id);
    };
    [...documentIds].sort().forEach(visit);
    const selected: DocumentVersion[] = [], pending: string[] = [], rejected: string[] = [];
    for (const id of [...documentIds].sort()) {
      const latest = this.getLatestVersion(id), approved = this.getLatestApprovedVersion(id);
      if (approved) selected.push(approved);
      else issues.push({ code: 'NO_APPROVED_VERSION', message: `${latest.title} has no eligible approved version`, documentIds: [id] });
      if (latest.approvalStatus === 'pending') { pending.push(latest.id); issues.push({ code: 'PENDING_REVIEW', message: `${latest.title} ${latest.revisionLabel} is pending review; earlier approvals are preserved`, documentIds: [id] }); }
      if (latest.approvalStatus === 'rejected') { rejected.push(latest.id); issues.push({ code: 'REJECTED_VERSION', message: `${latest.title} ${latest.revisionLabel} was rejected`, documentIds: [id] }); }
      const decision = this.latestDecision(latest.id);
      if (decision?.decision === 'approved' && !this.approvalValid(decision)) issues.push({ code: 'APPROVAL_INVALID', message: `Reviewer for ${latest.title} is no longer an active engineer`, documentIds: [id] });
      if (!latest.contentBase64.length) issues.push({ code: 'EMPTY_DOCUMENT', message: `${latest.title} has no original bytes`, documentIds: [id] });
      if (/^text\//i.test(latest.mediaType) && !latest.text.trim()) issues.push({ code: 'EMPTY_DOCUMENT', message: `${latest.title} contains no non-whitespace text`, documentIds: [id] });
      if (latest.facts.some(f => f.verification !== 'source-supported')) issues.push({ code: 'UNVERIFIED_FACT', message: `${latest.title} has facts not supported by deterministic evidence; correct or remove them in a new revision`, documentIds: [id] });
      const grouped = new Map<string, Set<string>>();
      for (const fact of latest.facts) { const values = grouped.get(fact.field) ?? new Set<string>(); values.add(canonicalJson(fact.value)); grouped.set(fact.field, values); }
      for (const [field, values] of grouped) if (values.size > 1) issues.push({ code: 'FIELD_CONFLICT', message: `${latest.title} contains conflicting ${field} values`, documentIds: [id], field: field as NonNullable<PackageIssue['field']> });
      const revisionFacts = latest.facts.filter(f => f.field === 'revisionLabel');
      if (revisionFacts.some(f => f.value !== latest.revisionLabel)) issues.push({ code: 'FIELD_CONFLICT', message: `${latest.title} upload revision disagrees with its source revision label`, documentIds: [id], field: 'revisionLabel' });
    }
    for (const task of this.tasks.values()) if (task.siteId === siteId && task.status === 'open' && documentIds.has(task.dependentDocumentId)) issues.push({ code: 'CHANGED_SOURCE', message: task.explanation, documentIds: [task.sourceDocumentId, task.dependentDocumentId], taskId: task.id });
    for (const constraint of template.consistencyChecks) {
      // Only compare values explicitly configured for comparison, grouped by component.
      const groups = new Map<string, { value: string; documentId: string }[]>();
      for (const version of selected) if (constraint.families.includes(version.family) && (constraint.componentId === undefined || version.componentId === constraint.componentId)) {
        const key = version.componentId ?? '__site__', facts = version.facts.filter(f => f.field === constraint.field);
        groups.set(key, [...(groups.get(key) ?? []), ...facts.map(f => ({ value: canonicalJson(f.value), documentId: version.documentId }))]);
      }
      for (const group of groups.values()) if (new Set(group.map(v => v.value)).size > 1) issues.push({ code: 'FIELD_CONFLICT', message: `Configured cross-document check disagrees on ${constraint.field}`, documentIds: sortedUnique(group.map(v => v.documentId)), field: constraint.field });
    }
    const token = checksum({ site, template, versions: documents.map(d => d.latest), decisions: this.decisions.filter(d => this.versions.get(d.versionId)?.siteId === siteId), dependencies: this.listDependencies(siteId), tasks: this.getReviewTasks(siteId), reviewers: [...this.reviewers.values()] });
    return immutable({ siteId, templateId, stage: template.stage, readyForHumanSignoff: issues.length === 0, selectedVersionIds: selected.map(v => v.id), approvedVersionIds: selected.map(v => v.id), pendingVersionIds: pending, rejectedVersionIds: rejected, issues, token });
  }
  buildRelease(input: { siteId: string; templateId: string; reviewerId: string; signoffNotes: string; expectedReadinessToken: string }): ReleaseSnapshot {
    this.validReviewer(input.reviewerId); requireText(input.signoffNotes, 'Human signoff notes');
    const readiness = this.evaluateReadiness(input.siteId, input.templateId);
    if (readiness.token !== input.expectedReadinessToken) throw new IntelligenceError('READINESS_CONFLICT', 'Package changed since readiness was checked; refresh before signing');
    if (!readiness.readyForHumanSignoff) throw new IntelligenceError('PACKAGE_NOT_READY', 'Resolve package review issues before signoff', readiness.issues);
    const documents = readiness.selectedVersionIds.map(id => this.getVersion(id)).sort((a, b) => a.documentId < b.documentId ? -1 : 1);
    const template = this.template(input.templateId), documentIds = new Set(documents.map(d => d.documentId));
    const reviewerApprovals = documents.map(d => this.latestDecision(d.id)!);
    const tasks = [...this.tasks.values()].filter(t => documentIds.has(t.dependentDocumentId) && t.status === 'resolved');
    for (const task of tasks) { const decision = this.decisions.find(d => d.id === task.resolvedByDecisionId); if (decision && !reviewerApprovals.some(a => a.id === decision.id)) reviewerApprovals.push(decision); }
    const body = {
      schemaVersion: 1 as const, id: this.id(), siteId: input.siteId, templateId: template.id, packageType: template.packageType, stage: template.stage,
      builtAt: this.clock().toISOString(), builtBy: input.reviewerId, signoffNotes: input.signoffNotes,
      site: this.site(input.siteId), template,
      manifest: documents.map((d, i) => ({ documentId: d.documentId, versionId: d.id, family: d.family, componentId: d.componentId, revisionLabel: d.revisionLabel, fileName: d.fileName, mediaType: d.mediaType, sha256: d.contentHash, archivePath: `documents/${String(i + 1).padStart(3, '0')}-${safeFilename(d.fileName)}` })),
      documents, reviewerApprovals,
      dependencies: this.listDependencies(input.siteId).filter(d => documentIds.has(d.dependentDocumentId)), reviewTasks: tasks,
      readinessToken: readiness.token,
    };
    const release = immutable({ ...body, sha256: checksum(body) }); this.releases.set(release.id, release); return release;
  }
  getRelease(id: string): ReleaseSnapshot { return this.releases.get(id) ?? this.error('RELEASE_NOT_FOUND', `Unknown release ${id}`); }
  listReleases(siteId: string): readonly ReleaseSnapshot[] { this.site(siteId); return immutable([...this.releases.values()].filter(r => r.siteId === siteId)); }
  compareReleases(fromId: string, toId: string): ReleaseComparison { return compareReleases(this.getRelease(fromId), this.getRelease(toId)); }
  downloadRelease(id: string): { fileName: string; mediaType: 'application/zip'; bytes: Uint8Array } {
    const release = this.getRelease(id); return { fileName: `release-${safeFilename(release.id)}.zip`, mediaType: 'application/zip', bytes: createReleaseZip(release) };
  }
}
function safeFilename(name: string): string { return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'document.bin'; }
export function compareReleases(before: ReleaseSnapshot, after: ReleaseSnapshot): ReleaseComparison {
  if (before.siteId !== after.siteId || before.templateId !== after.templateId) throw new IntelligenceError('PACKAGE_MISMATCH', 'Release comparison needs the same site and template');
  return immutable({ fromReleaseId: before.id, toReleaseId: after.id,
    added: after.manifest.filter(e => !before.manifest.some(old => old.documentId === e.documentId)),
    removed: before.manifest.filter(e => !after.manifest.some(next => next.documentId === e.documentId)),
    updated: after.manifest.filter(e => before.manifest.some(old => old.documentId === e.documentId && old.versionId !== e.versionId)).map(e => {
      const old = before.documents.find(d => d.documentId === e.documentId)!, next = after.documents.find(d => d.documentId === e.documentId)!;
      return { documentId: e.documentId, fromVersionId: old.id, toVersionId: next.id, contentChanged: old.contentHash !== next.contentHash, semanticChanges: compareVersions(old, next).changes };
    }),
  });
}
