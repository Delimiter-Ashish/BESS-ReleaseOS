import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { ReleaseOS, compareVersions, compareReleases, extractFacts, extractWithAdapter, validateFacts, verifyReleaseSnapshot } from '../dist/index.js';
import { createDemo, runDemo, fixture } from '../demo/scenario.mjs';
import { createHash } from 'node:crypto';
const sha = b => createHash('sha256').update(b).digest('hex');
const ready = e => e.evaluateReadiness(fixture.site.id, fixture.template.id);
const codes = r => r.issues.map(i => i.code);
const review = (e, version, decision = 'approved', resolvedTaskIds = []) => e.reviewDocument({ versionId: typeof version === 'string' ? version : version.id, reviewerId: fixture.reviewer.id, decision, notes: 'Explicit synthetic engineering decision', resolvedTaskIds });
const approveAll = ({ engine, versions }) => { versions.forEach(v => review(engine, v)); return engine; };
function revise(e, documentId = 'synthetic-switchgear', content = fixture.switchgearV2, revisionLabel = 'V2') {
  const old = e.getLatestVersion(documentId);
  return e.ingestDocument({ documentId, siteId: old.siteId, family: old.family, supplierId: old.supplierId, componentId: old.componentId, title: old.title, revisionLabel, uploadedBy: old.uploadedBy, fileName: old.fileName, mediaType: old.mediaType, content });
}
const build = e => e.buildRelease({ siteId: fixture.site.id, templateId: fixture.template.id, reviewerId: fixture.reviewer.id, signoffNotes: 'Synthetic human signoff', expectedReadinessToken: ready(e).token });

test('missing document families are stage-specific and jurisdiction rules are separate', () => {
  const e = new ReleaseOS(); e.registerSite(fixture.site); e.registerTemplate(fixture.template);
  assert.equal(ready(e).issues.filter(i => i.code === 'MISSING_DOCUMENT').length, 4);
  const { engine } = createDemo(); approveAll({ engine, versions: engine.listDocuments(fixture.site.id).map(d => d.latest) });
  assert.equal(ready(engine).readyForHumanSignoff, true);
  const base = { ...fixture.template, id: 'operations', stage: 'operations', requirements: [{ id: 'om', family: 'operations-maintenance', label: 'O&M records', minimumCount: 1 }] };
  engine.registerTemplate(base);
  assert.equal(engine.evaluateReadiness(fixture.site.id, 'operations').readyForHumanSignoff, false);
  engine.registerTemplate({ ...fixture.template, jurisdictionRequirements: [{ jurisdiction: 'OTHER', requirements: [{ id: 'other-eop', family: 'emergency-operations-plan', label: 'EOP', minimumCount: 1 }] }] });
  assert.equal(ready(engine).readyForHumanSignoff, true);
  engine.registerTemplate({ ...fixture.template, jurisdictionRequirements: [{ jurisdiction: fixture.site.jurisdiction, requirements: [{ id: 'local-eop', family: 'emergency-operations-plan', label: 'EOP', minimumCount: 1 }] }] });
  assert.ok(ready(engine).issues.some(i => i.requirementId === 'local-eop'));
});

test('duplicate uploads are idempotent and do not erase approval or add tasks', () => {
  const e = approveAll(createDemo()), before = e.getLatestVersion('synthetic-switchgear');
  const result = revise(e, before.documentId, before.text, 'V1');
  assert.equal(result.duplicate, true); assert.equal(result.version.id, before.id); assert.equal(result.version.approvalStatus, 'approved');
  assert.equal(e.getDocumentHistory(before.documentId).length, 1); assert.equal(e.getReviewTasks(fixture.site.id).length, 0);
  const next = revise(e).version;
  const duplicateOld = revise(e, before.documentId, before.text, 'V1');
  assert.equal(duplicateOld.version.id, before.id); assert.equal(e.getLatestVersion(before.documentId).id, next.id);
});

test('pending upload never replaces latest approved selection and blocks new package signoff', () => {
  const e = approveAll(createDemo()), before = e.getLatestApprovedVersion('synthetic-switchgear');
  const result = revise(e), r = ready(e);
  assert.equal(result.version.approvalStatus, 'pending');
  assert.equal(e.getLatestVersion(before.documentId).id, result.version.id);
  assert.equal(e.getLatestApprovedVersion(before.documentId).id, before.id);
  assert.ok(r.selectedVersionIds.includes(before.id)); assert.ok(!r.selectedVersionIds.includes(result.version.id));
  assert.ok(codes(r).includes('PENDING_REVIEW')); assert.ok(codes(r).includes('CHANGED_SOURCE'));
  assert.throws(() => build(e), { code: 'PACKAGE_NOT_READY' });
});

test('rejected revision preserves previous approved document but blocks submission', () => {
  const e = approveAll(createDemo()), old = e.getLatestApprovedVersion('synthetic-switchgear');
  const next = revise(e).version; review(e, next, 'rejected');
  assert.equal(e.getLatestApprovedVersion(old.documentId).id, old.id);
  assert.ok(codes(ready(e)).includes('REJECTED_VERSION'));
  assert.equal(e.getVersion(next.id).approvalStatus, 'rejected');
});

test('deterministic extraction covers every requested engineering fact with exact evidence', () => {
  const text = 'Battery capacity: 1250 kWh\nPower rating: 600 kW\nManufacturer: Synthetic Inc\nEquipment model: SYN-2\nInverter quantity: 3\nVoltage rating: 600 V\nCurrent rating: 1000 A\nFrequency: 60 Hz\nRevision: B';
  const facts = extractFacts(text, 'v'); assert.equal(facts.length, 9);
  for (const fact of facts) {
    assert.equal(text.slice(fact.evidence.start, fact.evidence.end), fact.evidence.excerpt);
    assert.equal(fact.evidence.documentVersionId, 'v'); assert.equal(fact.verification, 'source-supported');
  }
  assert.equal(extractFacts('Capacity: unknown\nPower rating: 1 MW\nUnlabelled 999', 'v').length, 0);
  const e = approveAll(createDemo()), before = e.getLatestVersion('synthetic-switchgear'), after = revise(e).version;
  const change = compareVersions(before, after).changes.find(c => c.field === 'voltageV');
  assert.deepEqual(change.oldValue, [480]); assert.deepEqual(change.newValue, [600]);
  assert.equal(change.engineeringReviewRequired, true); assert.equal(change.confidence, 1);
  assert.equal(change.oldEvidence[0].documentVersionId, before.id); assert.equal(change.newEvidence[0].documentVersionId, after.id);
});

test('evidence validation rejects invented citations; adapter claims do not become verified facts', async () => {
  const text = 'Voltage rating: 480 V';
  const input = { field: 'voltageV', value: 480, evidence: { start: 0, end: text.length, line: 1, excerpt: text } };
  assert.equal(validateFacts(text, 'v', [input])[0].verification, 'source-supported');
  assert.throws(() => validateFacts(text, 'v', [{ ...input, evidence: { ...input.evidence, excerpt: 'invented' } }]), { code: 'INVALID_EVIDENCE' });
  assert.throws(() => validateFacts(text, 'v', [{ ...input, evidence: { ...input.evidence, line: 2 } }]), { code: 'INVALID_EVIDENCE' });
  const facts = await extractWithAdapter({ extract: async () => [{ ...input, value: 999, verification: 'source-supported' }] }, { versionId: 'v', text });
  assert.equal(facts[0].verification, 'needs-verification'); assert.equal(facts[0].origin, 'ai');
});

test('conflicting facts inside one document block readiness', () => {
  const e = approveAll(createDemo());
  const v = revise(e, 'synthetic-switchgear', 'Revision: V2\nVoltage rating: 480 V\nVoltage rating: 600 V').version;
  review(e, v);
  assert.ok(ready(e).issues.some(i => i.code === 'FIELD_CONFLICT' && i.field === 'voltageV'));
});

test('configured cross-document conflicts are scoped by component', () => {
  const e = approveAll(createDemo());
  e.registerTemplate({ ...fixture.template, consistencyChecks: [{ field: 'voltageV', families: ['engineering-plan', 'switchgear-specification'] }] });
  assert.equal(ready(e).readyForHumanSignoff, true);
  const next = revise(e).version; review(e, next);
  assert.ok(ready(e).issues.some(i => i.code === 'FIELD_CONFLICT' && i.field === 'voltageV'));
});

test('dependency propagation traverses multiple hops and explains the path', () => {
  const e = approveAll(createDemo());
  e.addDependency({ id: 'plan-fire', siteId: fixture.site.id, sourceDocumentId: 'synthetic-plan', dependentDocumentId: 'synthetic-fire', relevantFields: [], explanation: 'Submission fire review depends on engineering plan review' });
  const result = revise(e);
  assert.deepEqual(result.impacts.affectedDocumentIds, ['synthetic-fire', 'synthetic-plan']);
  const task = result.impacts.tasks.find(t => t.dependentDocumentId === 'synthetic-fire');
  assert.deepEqual(task.dependencyPath, ['synthetic-switchgear', 'synthetic-plan', 'synthetic-fire']);
  assert.match(task.explanation, /electrical ratings/); assert.match(task.explanation, /not a legal compliance determination/);
  assert.deepEqual(result.impacts.impactedTemplateIds, [fixture.template.id]);
});

test('irrelevant changes do not trigger field-filtered dependency tasks', () => {
  const e = approveAll(createDemo()), old = e.getLatestVersion('synthetic-switchgear');
  const result = revise(e, old.documentId, old.text.replace('Revision: V1', 'Revision: V2') + '\nSynthetic formatting note');
  assert.equal(result.impacts.tasks.length, 0);
  assert.ok(codes(ready(e)).includes('PENDING_REVIEW'));
});

test('approving a changed source does not silently resolve engineering tasks', () => {
  const e = approveAll(createDemo()), result = revise(e), task = result.impacts.tasks[0];
  const plan = e.getLatestVersion('synthetic-plan');
  assert.throws(() => review(e, plan, 'approved', [task.id]), { code: 'SOURCE_NOT_APPROVED' });
  review(e, result.version); assert.ok(codes(ready(e)).includes('CHANGED_SOURCE'));
  review(e, plan, 'approved', [task.id]);
  assert.equal(ready(e).readyForHumanSignoff, true);
  const decision = e.getReviewDecisions(plan.id).at(-1);
  assert.equal(decision.reviewerId, fixture.reviewer.id); assert.equal(decision.resolvedTaskIds[0], task.id);
});

test('newer pending revisions supersede obsolete review tasks', () => {
  const e = approveAll(createDemo()), first = revise(e);
  const second = revise(e, 'synthetic-switchgear', fixture.switchgearV2.replace('V2', 'V3').replace('600 V', '690 V'), 'V3');
  assert.equal(e.getReviewTasks(fixture.site.id).find(t => t.id === first.impacts.tasks[0].id).status, 'superseded');
  assert.equal(second.impacts.tasks[0].status, 'open');
  assert.throws(() => review(e, first.version), { code: 'STALE_VERSION' });
});

test('approval is explicit, authorized, timestamped, and invalidated by reviewer deactivation', () => {
  const { engine: e, versions } = createDemo();
  assert.throws(() => e.reviewDocument({ versionId: versions[0].id, reviewerId: 'unknown', decision: 'approved', notes: 'test' }), { code: 'UNAUTHORIZED_REVIEWER' });
  e.registerReviewer({ id: 'synthetic-uploader', name: 'Synthetic Uploader', roles: ['engineer'], active: true });
  assert.throws(() => e.reviewDocument({ versionId: versions[0].id, reviewerId: 'synthetic-uploader', decision: 'approved', notes: 'test' }), { code: 'SELF_APPROVAL' });
  assert.throws(() => e.reviewDocument({ versionId: versions[0].id, reviewerId: fixture.reviewer.id, decision: 'automatic', notes: 'test' }), { code: 'INVALID_DECISION' });
  approveAll({ engine: e, versions });
  assert.equal(e.getReviewDecisions()[0].timestamp, '2026-11-07T12:00:00.000Z');
  e.registerReviewer({ ...fixture.reviewer, active: false });
  assert.ok(codes(ready(e)).includes('APPROVAL_INVALID'));
});

test('dependency cycles block release and cross-site identities cannot leak', () => {
  const e = approveAll(createDemo());
  e.addDependency({ id: 'cycle', siteId: fixture.site.id, sourceDocumentId: 'synthetic-plan', dependentDocumentId: 'synthetic-switchgear', relevantFields: [], explanation: 'Synthetic cycle for testing' });
  assert.ok(codes(ready(e)).includes('DEPENDENCY_CYCLE'));
  assert.throws(() => build(e), { code: 'PACKAGE_NOT_READY' });
  e.registerSite({ id: 'other', name: 'Other synthetic site', jurisdiction: 'OTHER' });
  const old = e.getLatestVersion('synthetic-switchgear');
  assert.throws(() => e.ingestDocument({ ...old, siteId: 'other', content: 'new', uploadedBy: 'u' }), { code: 'IDENTITY_MISMATCH' });
  assert.throws(() => e.addDependency({ id: 'cross', siteId: 'other', sourceDocumentId: 'synthetic-plan', dependentDocumentId: 'synthetic-fire', relevantFields: [], explanation: 'Invalid cross-site dependency' }), { code: 'SITE_MISMATCH' });
});

test('readiness token prevents stale human signoff after document and policy changes', () => {
  const e = approveAll(createDemo()), token = ready(e).token;
  e.registerTemplate({ ...fixture.template, name: 'Updated synthetic policy' });
  assert.throws(() => e.buildRelease({ siteId: fixture.site.id, templateId: fixture.template.id, reviewerId: fixture.reviewer.id, signoffNotes: 'test', expectedReadinessToken: token }), { code: 'READINESS_CONFLICT' });
  const r = ready(e); revise(e);
  assert.throws(() => e.buildRelease({ siteId: fixture.site.id, templateId: fixture.template.id, reviewerId: fixture.reviewer.id, signoffNotes: 'test', expectedReadinessToken: r.token }), { code: 'READINESS_CONFLICT' });
});

test('release snapshots freeze exact approved versions and remain valid after later decisions', () => {
  const e = approveAll(createDemo()), release = build(e), original = JSON.stringify(release);
  assert.ok(verifyReleaseSnapshot(release)); assert.equal(release.documents.length, 4);
  assert.throws(() => { release.documents[0].facts.push({}); }, TypeError);
  assert.throws(() => { release.manifest[0].sha256 = 'tampered'; }, TypeError);
  const next = revise(e); review(e, next.version, 'rejected');
  assert.equal(JSON.stringify(e.getRelease(release.id)), original); assert.ok(verifyReleaseSnapshot(release));
  assert.equal(verifyReleaseSnapshot({ ...release, signoffNotes: 'tampered' }), false);
  assert.equal(verifyReleaseSnapshot(null), false);
});

test('full synthetic demo regenerates package with explicit dependent review and release diff', () => {
  const result = runDemo();
  assert.equal(result.release1Unchanged, true); assert.equal(result.finalReadiness.readyForHumanSignoff, true);
  assert.equal(result.pendingReadiness.readyForHumanSignoff, false); assert.equal(result.afterSourceApproval.readyForHumanSignoff, false);
  assert.deepEqual(result.comparison.updated.map(d => d.documentId), ['synthetic-plan', 'synthetic-switchgear']);
  const switchgear = result.comparison.updated.find(d => d.documentId === 'synthetic-switchgear');
  assert.deepEqual(switchgear.semanticChanges.find(c => c.field === 'voltageV').newValue, [600]);
  assert.deepEqual(compareReleases(result.release1, result.release1).updated, []);
  assert.ok(result.release2.reviewTasks.every(t => t.status === 'resolved'));
});

test('downloadable ZIP reproduces exact document bytes, manifest and independently valid snapshot', () => {
  const { engine, release1, release2 } = runDemo();
  for (const release of [release1, release2]) {
    const archive = engine.downloadRelease(release.id), files = unzipSync(archive.bytes);
    assert.equal(archive.mediaType, 'application/zip'); assert.equal(files['manifest.json'] !== undefined, true);
    assert.ok(verifyReleaseSnapshot(JSON.parse(Buffer.from(files['snapshot.json']).toString('utf8'))));
    const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'));
    assert.equal(manifest.sha256, release.sha256);
    for (const entry of release.manifest) {
      assert.equal(sha(files[entry.archivePath]), entry.sha256);
      assert.deepEqual(Buffer.from(files[entry.archivePath]), Buffer.from(release.documents.find(d => d.id === entry.versionId).contentBase64, 'base64'));
    }
    assert.deepEqual(engine.downloadRelease(release.id).bytes, archive.bytes);
  }
});

test('binary uploads preserve original bytes independently of extracted text', () => {
  const e = new ReleaseOS(); e.registerSite(fixture.site); e.registerReviewer(fixture.reviewer);
  e.registerTemplate({ ...fixture.template, requirements: [{ id: 'binary', family: 'binary-drawing', label: 'Synthetic binary drawing', minimumCount: 1 }] });
  const bytes = Uint8Array.from([0, 255, 1, 42, 13]);
  const result = e.ingestDocument({ documentId: 'binary', siteId: fixture.site.id, family: 'binary-drawing', title: 'Synthetic bytes', revisionLabel: 'V1', uploadedBy: 'synthetic-uploader', content: bytes, text: 'Revision: V1', fileName: '../../synthetic.bin', mediaType: 'application/octet-stream' });
  assert.equal(result.version.contentHash, sha(bytes)); bytes[0] = 77;
  review(e, result.version); const release = build(e);
  assert.equal(Buffer.from(release.documents[0].contentBase64, 'base64')[0], 0);
  assert.ok(!release.manifest[0].archivePath.includes('../'));
});

test('cosmetic third revision cannot erase an unresolved engineering review of approved second revision', () => {
  const e = approveAll(createDemo()), second = revise(e);
  review(e, second.version); // Source approved, engineering has not reviewed 600 V yet.
  const third = revise(e, 'synthetic-switchgear', fixture.switchgearV2.replace('V2', 'V3') + '\nSynthetic note', 'V3');
  assert.equal(third.comparison.changes.some(c => c.field === 'voltageV'), false);
  assert.equal(third.impacts.tasks.length, 1);
  assert.ok(third.impacts.tasks[0].changedFields.includes('voltageV'));
  review(e, third.version);
  assert.ok(codes(ready(e)).includes('CHANGED_SOURCE'));
  review(e, e.getLatestVersion('synthetic-plan'), 'approved', [third.impacts.tasks[0].id]);
  assert.equal(ready(e).readyForHumanSignoff, true);
});

test('text-only AI adapter cannot invent page-number citations', async () => {
  const text = 'Voltage rating: 480 V';
  await assert.rejects(() => extractWithAdapter({ extract: async () => [{ field: 'voltageV', value: 480, evidence: { excerpt: text, start: 0, end: text.length, line: 1, page: 999 } }] }, { versionId: 'v', text }), { code: 'INVALID_EVIDENCE' });
});
