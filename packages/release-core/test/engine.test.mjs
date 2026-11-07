import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReleaseEngine, ReleaseCoreError, canonicalJson, checksum, diffLines, verifyRelease } from '../dist/index.js';
const input = (overrides = {}) => ({ title: 'Synthetic specification', content: 'Rated output: 100 kW\nSynthetic data only', authorId: 'author', ...overrides });
function setup(policy) {
  let id = 0;
  const engine = new ReleaseEngine({ policy, clock: () => new Date('2026-01-01T00:00:00Z'), idFactory: () => `synthetic-${++id}` });
  engine.registerEngineer({ id: 'reviewer', name: 'Synthetic Engineer', roles: ['engineer'], active: true });
  return engine;
}
const approve = (e, v, engineerId = 'reviewer', decision = 'approved') => e.recordApproval({ documentId: v.documentId, versionId: v.id, engineerId, decision });
const codes = r => r.issues.map(i => i.code);
const release = (e, ids) => e.generateRelease({ name: 'Synthetic release', createdBy: 'operator', documentIds: ids, expectedVersionIds: e.checkReadiness(ids).versionIds });

test('versions preserve history, detach inputs, freeze outputs, and reject write conflicts', () => {
  const e = setup(), metadata = { tags: ['synthetic'] };
  const v1 = e.createDocument(input({ documentId: 'spec', metadata }));
  metadata.tags.push('changed');
  assert.deepEqual(v1.metadata.tags, ['synthetic']);
  assert.throws(() => { v1.metadata.tags.push('illegal'); }, TypeError);
  const v2 = e.reviseDocument('spec', input({ content: 'Updated synthetic output' }), v1.id);
  assert.equal(e.getDocument('spec').versions.length, 2);
  assert.equal(e.getVersion('spec', v1.id).content, input().content);
  assert.equal(v2.revision, 2);
  assert.throws(() => e.reviseDocument('spec', input(), v1.id), { code: 'VERSION_CONFLICT' });
  assert.throws(() => e.createDocument(input({ documentId: 'spec' })), { code: 'DOCUMENT_EXISTS' });
  assert.throws(() => e.getVersion('absent'), { code: 'DOCUMENT_NOT_FOUND' });
  assert.throws(() => e.getVersion('spec', 'absent'), { code: 'VERSION_NOT_FOUND' });
});

test('comparison describes content, title, metadata and dependency changes', () => {
  const e = setup(), a = e.createDocument(input({ content: 'a\nb\nc' }));
  const b = e.reviseDocument(a.documentId, input({ title: 'New title', content: 'a\nB\nc', metadata: { revised: true }, dependencies: [{ documentId: 'missing', versionId: 'v1' }] }), a.id);
  const comparison = e.compareRevisions(a.documentId, a.id, b.id);
  assert.equal(comparison.changed, true);
  assert.equal(comparison.titleChanged, true); assert.equal(comparison.metadataChanged, true); assert.equal(comparison.dependenciesChanged, true);
  assert.equal(comparison.addedLines, 1); assert.equal(comparison.removedLines, 1);
  assert.equal(e.compareRevisions(a.documentId, a.id, a.id).changed, false);
});

test('line diffs reconstruct both inputs including empty content and trailing newlines', () => {
  const cases = ['', 'a', 'a\n', '\n', 'a\nb\na', 'b\na', 'x\n'.repeat(1100)];
  for (const before of cases) for (const after of cases) {
    const diff = diffLines(before, after);
    assert.equal(diff.filter(l => l.type !== 'added').map(l => l.text).join('\n'), before);
    assert.equal(diff.filter(l => l.type !== 'removed').map(l => l.text).join('\n'), after);
  }
});

test('dependency closure, build order and transitive impact', () => {
  const e = setup(), a = e.createDocument(input({ documentId: 'a' }));
  const b = e.createDocument(input({ documentId: 'b', dependencies: [{ documentId: 'a', versionId: a.id }] }));
  const c = e.createDocument(input({ documentId: 'c', dependencies: [{ documentId: 'b', versionId: b.id }] }));
  assert.deepEqual(e.analyzeDependencies(['c']).buildOrder, ['a', 'b', 'c']);
  assert.deepEqual(e.analyzeImpact('a'), ['b', 'c']);
  for (const v of [a, b, c]) approve(e, v);
  assert.equal(e.checkReadiness(['c']).ready, true);
  const revised = e.reviseDocument('a', input({ content: 'New base specification' }), a.id);
  approve(e, revised);
  assert.ok(codes(e.checkReadiness(['c'])).includes('STALE_DEPENDENCY'));
  assert.throws(() => release(e, ['c']), { code: 'NOT_READY' });
});

test('missing documents, unknown pinned versions and cycles block readiness', () => {
  const e = setup();
  assert.ok(codes(e.checkReadiness(['absent'])).includes('MISSING_DOCUMENT'));
  assert.ok(codes(e.checkReadiness([])).includes('EMPTY_SUBMISSION'));
  const a = e.createDocument(input({ documentId: 'a', dependencies: [{ documentId: 'missing', versionId: 'v1' }] }));
  assert.ok(codes(e.checkReadiness(['a'])).includes('MISSING_DEPENDENCY'));
  const b = e.createDocument(input({ documentId: 'b', dependencies: [{ documentId: 'a', versionId: 'wrong' }] }));
  assert.ok(codes(e.checkReadiness(['b'])).includes('MISSING_DEPENDENCY_VERSION'));
  e.reviseDocument('a', input({ dependencies: [{ documentId: 'b', versionId: b.id }] }), a.id);
  assert.ok(codes(e.checkReadiness(['a'])).includes('DEPENDENCY_CYCLE'));
  assert.deepEqual(e.analyzeImpact('a'), ['b']);
});

test('approvals require active registered engineers and prevent self approval', () => {
  const e = setup(), a = e.createDocument(input({ authorId: 'reviewer' }));
  assert.throws(() => approve(e, a), { code: 'SELF_APPROVAL' });
  assert.throws(() => approve(e, a, 'unknown'), { code: 'UNAUTHORIZED_ENGINEER' });
  e.registerEngineer({ id: 'inactive', name: 'Synthetic inactive engineer', roles: ['engineer'], active: false });
  assert.throws(() => approve(e, a, 'inactive'), { code: 'UNAUTHORIZED_ENGINEER' });
  const permissive = setup({ allowAuthorApproval: true });
  const own = permissive.createDocument(input({ authorId: 'reviewer' }));
  approve(permissive, own); assert.equal(permissive.checkReadiness([own.documentId]).ready, true);
});

test('approval counts use distinct engineers and latest decisions; revisions invalidate approvals', () => {
  const e = setup({ minimumApprovals: 2, requiredRoles: ['engineer', 'lead'] }), a = e.createDocument(input());
  approve(e, a); approve(e, a);
  assert.ok(codes(e.checkReadiness([a.documentId])).includes('INSUFFICIENT_APPROVALS'));
  e.registerEngineer({ id: 'lead', name: 'Synthetic Lead', roles: ['lead'], active: true });
  approve(e, a, 'lead'); assert.equal(e.checkReadiness([a.documentId]).ready, true);
  approve(e, a, 'reviewer', 'rejected');
  assert.ok(codes(e.checkReadiness([a.documentId])).includes('APPROVAL_REJECTED'));
  approve(e, a); assert.equal(e.checkReadiness([a.documentId]).ready, true);
  const b = e.reviseDocument(a.documentId, input({ content: 'Changed' }), a.id);
  assert.equal(e.checkReadiness([a.documentId]).ready, false);
  assert.throws(() => approve(e, a), { code: 'STALE_VERSION' });
  approve(e, b); approve(e, b, 'lead');
  assert.equal(e.checkReadiness([a.documentId]).ready, true);
  e.registerEngineer({ id: 'lead', name: 'Synthetic Lead', roles: ['other'], active: true });
  assert.ok(codes(e.checkReadiness([a.documentId])).includes('MISSING_ROLE'));
  e.registerEngineer({ id: 'reviewer', name: 'Synthetic Reviewer', roles: ['engineer'], active: false });
  assert.ok(codes(e.checkReadiness([a.documentId])).includes('INSUFFICIENT_APPROVALS'));
});

test('release captures dependency closure and remains immutable after all subsequent changes', () => {
  const e = setup(), a = e.createDocument(input({ documentId: 'a' }));
  const b = e.createDocument(input({ documentId: 'b', dependencies: [{ documentId: 'a', versionId: a.id }] }));
  approve(e, a); approve(e, b);
  const r = release(e, ['b']); const serialized = JSON.stringify(r);
  assert.equal(r.documents.length, 2); assert.equal(r.approvals.length, 2); assert.ok(verifyRelease(r));
  assert.throws(() => { r.documents[0].content = 'tampered'; }, TypeError);
  e.reviseDocument('a', input({ content: 'Revised' }), a.id);
  e.registerEngineer({ id: 'reviewer', name: 'Synthetic Engineer', roles: [], active: false });
  assert.equal(JSON.stringify(e.getRelease(r.id)), serialized);
  assert.equal(e.listReleases().length, 1);
  assert.equal(verifyRelease({ ...r, name: 'tampered' }), false);
  const tampered = structuredClone(r); tampered.documents[0].content = 'tampered';
  const { checksum: ignored, ...body } = tampered; tampered.checksum = checksum(body);
  assert.equal(verifyRelease(tampered), false);
  assert.equal(verifyRelease(null), false);
  assert.throws(() => e.getRelease('missing'), { code: 'RELEASE_NOT_FOUND' });
});

test('release requires current readiness versions and blocks empty content', () => {
  const e = setup(), a = e.createDocument(input()); approve(e, a);
  const readiness = e.checkReadiness([a.documentId]);
  const b = e.reviseDocument(a.documentId, input({ content: 'new' }), a.id); approve(e, b);
  assert.throws(() => e.generateRelease({ name: 'Synthetic', createdBy: 'operator', documentIds: [a.documentId], expectedVersionIds: readiness.versionIds }), { code: 'VERSION_CONFLICT' });
  const empty = e.createDocument(input({ content: ' \n' })); approve(e, empty);
  assert.ok(codes(e.checkReadiness([empty.documentId])).includes('EMPTY_CONTENT'));
  assert.throws(() => release(e, [empty.documentId]), error => error instanceof ReleaseCoreError && error.issues.some(i => i.code === 'EMPTY_CONTENT'));
});

test('audit events form a frozen contiguous hash chain', () => {
  const e = setup(), a = e.createDocument(input()); approve(e, a); release(e, [a.documentId]);
  let previous = '', sequence = 1;
  for (const event of e.getAuditTrail()) {
    const { hash, ...body } = event;
    assert.equal(event.previousHash, previous); assert.equal(event.sequence, sequence++);
    assert.equal(hash, checksum(body)); previous = hash;
    assert.ok(Object.isFrozen(event));
  }
});

test('canonical hashing rejects unsupported values and is insensitive to key order', () => {
  assert.equal(checksum({ b: 2, a: 1 }), checksum({ a: 1, b: 2 }));
  const cyclic = {}; cyclic.self = cyclic;
  for (const bad of [undefined, NaN, Infinity, new Date(), cyclic, { value: undefined }, [undefined], new Array(1)]) assert.throws(() => canonicalJson(bad), { code: 'INVALID_JSON' });
  assert.throws(() => new ReleaseEngine({ policy: { minimumApprovals: 0 } }), { code: 'INVALID_POLICY' });
  const e = setup();
  assert.throws(() => e.createDocument(input({ dependencies: [{ documentId: 'a', versionId: 'v1' }, { documentId: 'a', versionId: 'v2' }] })), { code: 'INVALID_INPUT' });
});
