import { zipSync } from 'fflate';
import type { ReleaseSnapshot } from './models.js';
import { bytesHash, canonicalJson, checksum, immutable, IntelligenceError } from './utils.js';

/** Integrity validation, not a signature or a legal compliance attestation. */
export function verifyReleaseSnapshot(release: ReleaseSnapshot): boolean {
  try {
    const { sha256, ...body } = release;
    if (release.schemaVersion !== 1 || checksum(body) !== sha256 || !release.documents.length || release.manifest.length !== release.documents.length) return false;
    const ids = new Set<string>(), paths = new Set<string>();
    for (const entry of release.manifest) {
      if (ids.has(entry.versionId) || paths.has(entry.archivePath) || !/^documents\/\d+-[a-zA-Z0-9_.-]+$/.test(entry.archivePath)) return false;
      ids.add(entry.versionId); paths.add(entry.archivePath);
      const version = release.documents.find(d => d.id === entry.versionId);
      if (!version || version.siteId !== release.siteId || version.documentId !== entry.documentId || version.contentHash !== entry.sha256 || version.approvalStatus !== 'approved' || bytesHash(Buffer.from(version.contentBase64, 'base64')) !== entry.sha256) return false;
      if (!release.reviewerApprovals.some(d => d.versionId === version.id && d.contentHash === version.contentHash && d.decision === 'approved')) return false;
    }
    return true;
  } catch { return false; }
}
/** Seal an externally assembled snapshot body (e.g. from an application's own store). Result is frozen and must verify. */
export function sealReleaseSnapshot(body: Omit<ReleaseSnapshot, 'sha256'>): ReleaseSnapshot {
  const release = immutable({ ...body, sha256: checksum(body) }) as ReleaseSnapshot;
  if (!verifyReleaseSnapshot(release)) throw new IntelligenceError('INVALID_RELEASE', 'Snapshot failed integrity validation; every manifest entry needs approved original bytes and a matching approval record');
  return release;
}
const reservedPaths = new Set(['manifest.json', 'snapshot.json']);
/** ZIP contains portable manifest metadata and exact original document bytes. Extra entries cannot replace reserved or document paths. */
export function createReleaseZip(release: ReleaseSnapshot, extraEntries: Readonly<Record<string, Uint8Array>> = {}): Uint8Array {
  if (!verifyReleaseSnapshot(release)) throw new IntelligenceError('INVALID_RELEASE', 'Release integrity check failed');
  const entries: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  const { documents, ...manifest } = release;
  // Full snapshot enables independent checksum validation; manifest is a convenient package index.
  entries['manifest.json'] = Buffer.from(canonicalJson(manifest));
  entries['snapshot.json'] = Buffer.from(canonicalJson(release));
  for (const entry of release.manifest) entries[entry.archivePath] = Buffer.from(documents.find(d => d.id === entry.versionId)!.contentBase64, 'base64');
  for (const [path, bytes] of Object.entries(extraEntries)) {
    if (reservedPaths.has(path) || path in entries || !/^[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+)*$/.test(path) || path.split('/').includes('..')) throw new IntelligenceError('INVALID_ARCHIVE_PATH', `Extra archive entry ${path} is not allowed`);
    entries[path] = bytes;
  }
  // Fixed archive metadata makes the ZIP reproducible for the same release.
  return zipSync(entries, { level: 6, mtime: new Date('2000-01-01T00:00:00Z') });
}
