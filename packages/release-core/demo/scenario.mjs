import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReleaseOS, verifyReleaseSnapshot } from '../dist/index.js';
export const fixture = JSON.parse(readFileSync(new URL('../fixtures/synthetic-project.json', import.meta.url), 'utf8'));
export function createDemo() {
  let id = 0;
  const engine = new ReleaseOS({ clock: () => new Date('2026-11-07T12:00:00Z'), idFactory: () => `synthetic-${++id}` });
  engine.registerSite(fixture.site); engine.registerReviewer(fixture.reviewer); engine.registerTemplate(fixture.template);
  const versions = fixture.documents.map(document => engine.ingestDocument({ ...document, siteId: fixture.site.id, supplierId: 'synthetic-supplier', revisionLabel: 'V1', uploadedBy: 'synthetic-uploader', fileName: `${document.documentId}.txt`, mediaType: 'text/plain' }).version);
  engine.addDependency({ id: 'synthetic-switchgear-plan', siteId: fixture.site.id, sourceDocumentId: 'synthetic-switchgear', dependentDocumentId: 'synthetic-plan', relevantFields: ['voltageV', 'currentA', 'frequencyHz', 'manufacturer', 'equipmentModel'], explanation: 'Switchgear electrical ratings must be reviewed against the engineering plan' });
  return { engine, versions };
}
export function runDemo(outputDirectory) {
  const { engine, versions } = createDemo();
  const approve = (versionId, resolvedTaskIds = []) => engine.reviewDocument({ versionId, reviewerId: fixture.reviewer.id, decision: 'approved', notes: 'Explicit synthetic engineer review completed.', resolvedTaskIds });
  const readiness = () => engine.evaluateReadiness(fixture.site.id, fixture.template.id);
  const build = () => engine.buildRelease({ siteId: fixture.site.id, templateId: fixture.template.id, reviewerId: fixture.reviewer.id, signoffNotes: 'Human signoff for synthetic demonstration only.', expectedReadinessToken: readiness().token });
  versions.forEach(v => approve(v.id));
  const release1 = build(), original = JSON.stringify(release1);
  const old = engine.getLatestVersion('synthetic-switchgear');
  const incoming = engine.ingestDocument({ documentId: old.documentId, siteId: old.siteId, family: old.family, title: old.title, supplierId: old.supplierId, componentId: old.componentId, revisionLabel: 'V2', uploadedBy: 'synthetic-uploader', fileName: old.fileName, mediaType: old.mediaType, content: fixture.switchgearV2 });
  const pendingReadiness = readiness();
  approve(incoming.version.id);
  // Source approval alone cannot silently clear engineering review.
  const afterSourceApproval = readiness();
  const previousPlan = engine.getLatestVersion('synthetic-plan');
  const plan = engine.ingestDocument({ documentId: previousPlan.documentId, siteId: previousPlan.siteId, family: previousPlan.family, title: previousPlan.title, supplierId: previousPlan.supplierId, componentId: previousPlan.componentId, revisionLabel: 'V2', uploadedBy: 'synthetic-uploader', fileName: previousPlan.fileName, mediaType: previousPlan.mediaType, content: previousPlan.text.replace('Revision: V1', 'Revision: V2').replace('480 V', '600 V') }).version;
  const openTasks = engine.getReviewTasks(fixture.site.id).filter(t => t.dependentDocumentId === plan.documentId && t.status === 'open');
  approve(plan.id, openTasks.map(t => t.id));
  const finalReadiness = readiness(), release2 = build();
  const comparison = engine.compareReleases(release1.id, release2.id);
  if (JSON.stringify(engine.getRelease(release1.id)) !== original || !verifyReleaseSnapshot(release1) || !verifyReleaseSnapshot(release2) || pendingReadiness.readyForHumanSignoff || afterSourceApproval.readyForHumanSignoff || !finalReadiness.readyForHumanSignoff) throw new Error('Demo invariant failed');
  const result = { release1, incoming, pendingReadiness, afterSourceApproval, finalReadiness, release2, comparison, release1Unchanged: true };
  if (outputDirectory) {
    mkdirSync(outputDirectory, { recursive: true });
    for (const release of [release1, release2]) {
      const archive = engine.downloadRelease(release.id);
      writeFileSync(resolve(outputDirectory, archive.fileName), archive.bytes);
      writeFileSync(resolve(outputDirectory, `${release.id}.manifest.json`), JSON.stringify(release.manifest, null, 2));
    }
    writeFileSync(resolve(outputDirectory, 'frontend-example.json'), JSON.stringify(result, null, 2));
  }
  return { engine, ...result };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputDirectory = fileURLToPath(new URL('../demo-output/', import.meta.url));
  const result = runDemo(outputDirectory);
  console.log(JSON.stringify({ release1: result.release1.id, detectedChanges: result.incoming.comparison.changes.map(c => ({ field: c.field, old: c.oldValue, new: c.newValue })), impactedDocuments: result.incoming.impacts.affectedDocumentIds, pendingIssueCodes: result.pendingReadiness.issues.map(i => i.code), sourceApprovalStillRequiresEngineeringReview: !result.afterSourceApproval.readyForHumanSignoff, finalReady: result.finalReadiness.readyForHumanSignoff, release2: result.release2.id, updatedDocuments: result.comparison.updated.map(d => d.documentId), release1Unchanged: result.release1Unchanged, outputDirectory }, null, 2));
}
