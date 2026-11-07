import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { createReleaseZip, sealReleaseSnapshot, verifyReleaseSnapshot } from '../dist/index.js';
import { runDemo } from '../demo/scenario.mjs';

const bodyOf = ({ sha256, ...body }) => body;

test('sealReleaseSnapshot reproduces engine checksums and covers annotations', () => {
  const { release1 } = runDemo();
  const resealed = sealReleaseSnapshot(bodyOf(release1));
  assert.equal(resealed.sha256, release1.sha256);
  const annotated = sealReleaseSnapshot({ ...bodyOf(release1), annotations: { manifest: { note: 'frozen' } } });
  assert.notEqual(annotated.sha256, release1.sha256);
  assert.ok(verifyReleaseSnapshot(annotated));
  assert.equal(verifyReleaseSnapshot({ ...annotated, annotations: { manifest: { note: 'edited later' } } }), false);
  assert.throws(() => { annotated.annotations.manifest.note = 'x'; }, TypeError);
});

test('sealReleaseSnapshot rejects documents without approval records or with mismatched bytes', () => {
  const { release1 } = runDemo();
  assert.throws(() => sealReleaseSnapshot({ ...bodyOf(release1), reviewerApprovals: [] }), /integrity/);
  const docs = release1.documents.map((d, i) => i === 0 ? { ...d, contentBase64: Buffer.from('tampered').toString('base64') } : d);
  assert.throws(() => sealReleaseSnapshot({ ...bodyOf(release1), documents: docs }), /integrity/);
});

test('createReleaseZip adds safe extra entries but refuses reserved, document or traversal paths', () => {
  const { release1 } = runDemo();
  const files = unzipSync(createReleaseZip(release1, { 'MANIFEST.json': Buffer.from('{}'), 'INDEX.txt': Buffer.from('index') }));
  assert.equal(Buffer.from(files['INDEX.txt']).toString(), 'index');
  assert.ok(files['snapshot.json']);
  for (const bad of ['snapshot.json', 'manifest.json', release1.manifest[0].archivePath, '../evil.txt', '/abs.txt', 'a/../b.txt']) {
    assert.throws(() => createReleaseZip(release1, { [bad]: Buffer.from('x') }), /not allowed/);
  }
  assert.deepEqual(createReleaseZip(release1, { 'INDEX.txt': Buffer.from('i') }), createReleaseZip(release1, { 'INDEX.txt': Buffer.from('i') }));
});
