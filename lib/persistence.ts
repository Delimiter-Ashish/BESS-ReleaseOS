// Minimal durable persistence for the single application store (server-only, one process).
//
// What is persisted: sites (documents/revisions, decisions, engineering tasks, communications, project memory),
// review tasks, releases (sealed snapshots), and uploaded file bytes. What is NOT: upload previews
// (an extraction not yet filed must be re-uploaded after a restart) and sessions (unless SESSION_SECRET is set).
//
// Layout (RELEASEOS_DATA_DIR, default ./.data):
//   state.json            whole-store JSON snapshot, written atomically (tmp + rename) after every mutation
//   files/<sha256>.bin    content-addressed upload bytes; re-hashed on load, never trusted blindly
// On load every release snapshot is re-verified with release-core; a corrupt state is quarantined, not used.
// Set RELEASEOS_PERSIST=off to run purely in memory (unit tests).
import { verifyReleaseSnapshot } from "@releaseos/release-core";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Release, ReviewTask, Site } from "./types";

export interface StoredFile { name: string; mediaType: string; bytes: Buffer; sha256: string }
export interface PersistedStore { sites: Site[]; reviews: ReviewTask[]; releases: Release[]; files: Map<string, StoredFile>; startedAt: string }

interface StateFileV1 {
  format: "bess-releaseos-state";
  version: 1;
  savedAt: string;
  startedAt: string;
  sites: Site[];
  reviews: ReviewTask[];
  releases: Release[];
  files: { fileId: string; name: string; mediaType: string; sha256: string }[];
}

export const persistenceEnabled = () => process.env.RELEASEOS_PERSIST !== "off";
export const dataDir = () => resolve(process.env.RELEASEOS_DATA_DIR || join(process.cwd(), ".data"));
const statePath = () => join(dataDir(), "state.json");
const blobPath = (sha: string) => join(dataDir(), "files", `${sha}.bin`);
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function atomicWrite(path: string, data: string | Buffer) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

/** Write upload bytes once, keyed by their server-computed hash. */
export function saveBlob(hash: string, bytes: Buffer) {
  if (!persistenceEnabled()) return;
  mkdirSync(join(dataDir(), "files"), { recursive: true });
  const p = blobPath(hash);
  if (!existsSync(p)) atomicWrite(p, bytes);
}

export function saveState(s: PersistedStore) {
  if (!persistenceEnabled()) return;
  mkdirSync(dataDir(), { recursive: true });
  const files: StateFileV1["files"] = [];
  s.files.forEach((f, fileId) => {
    saveBlob(f.sha256, f.bytes);
    files.push({ fileId, name: f.name, mediaType: f.mediaType, sha256: f.sha256 });
  });
  const state: StateFileV1 = { format: "bess-releaseos-state", version: 1, savedAt: new Date().toISOString(), startedAt: s.startedAt, sites: s.sites, reviews: s.reviews, releases: s.releases, files };
  atomicWrite(statePath(), JSON.stringify(state));
}

/** Load persisted state, or null when none exists. A state that fails integrity checks is quarantined and ignored. */
export function loadState(): PersistedStore | null {
  if (!persistenceEnabled() || !existsSync(statePath())) return null;
  try {
    const raw = JSON.parse(readFileSync(statePath(), "utf8")) as StateFileV1;
    if (raw.format !== "bess-releaseos-state" || raw.version !== 1) throw new Error("unknown state format");
    const files = new Map<string, StoredFile>();
    for (const f of raw.files) {
      const bytes = readFileSync(blobPath(f.sha256));
      if (sha256(bytes) !== f.sha256) throw new Error(`file ${f.fileId} does not match its recorded sha256`);
      files.set(f.fileId, { name: f.name, mediaType: f.mediaType, bytes, sha256: f.sha256 });
    }
    for (const r of raw.releases) if (r.snapshot && !verifyReleaseSnapshot(r.snapshot)) throw new Error(`release ${r.id} snapshot failed verification`);
    return { sites: raw.sites, reviews: raw.reviews, releases: raw.releases, files, startedAt: raw.startedAt };
  } catch (e) {
    const q = `${statePath()}.corrupt-${Date.now()}`;
    try { renameSync(statePath(), q); } catch { /* ignore */ }
    console.error(`[persistence] persisted state rejected (${(e as Error).message}); moved to ${q} and starting from the seed`);
    return null;
  }
}

/** Remove persisted state (store reset). Blobs are content-addressed and harmless to keep, but are removed too. */
export function clearState() {
  if (!persistenceEnabled()) return;
  rmSync(statePath(), { force: true });
  rmSync(join(dataDir(), "files"), { recursive: true, force: true });
}
