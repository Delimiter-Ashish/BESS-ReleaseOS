import { zipSync } from 'fflate';
import type { ReleaseSnapshot } from './models.js';
import { bytesHash, canonicalJson, checksum, IntelligenceError } from './utils.js';

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
/** ZIP contains portable manifest metadata and exact original document bytes. */
export function createReleaseZip(release: ReleaseSnapshot): Uint8Array {
  if (!verifyReleaseSnapshot(release)) throw new IntelligenceError('INVALID_RELEASE', 'Release integrity check failed');
  const entries: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  const { documents, ...manifest } = release;
  // Full snapshot enables independent checksum validation; manifest is a convenient package index.
  entries['manifest.json'] = Buffer.from(canonicalJson(manifest));
  entries['snapshot.json'] = Buffer.from(canonicalJson(release));
  for (const entry of release.manifest) entries[entry.archivePath] = Buffer.from(documents.find(d => d.id === entry.versionId)!.contentBase64, 'base64');
  // Fixed archive metadata makes the ZIP reproducible for the same release.
  return zipSync(entries, { level: 6, mtime: new Date('2000-01-01T00:00:00Z') });
}
