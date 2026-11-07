// In-memory store seeded with synthetic data. Fine for a demo on one server process
// (`npm run dev` / `npm start`). For multi-instance hosting swap these functions for
// Postgres/Supabase — the rest of the app only calls these.
import { REQ_BY_ID, TEMPLATE_BY_ID } from "./requirements";
import { dependentsOf, diffFacts, latestApproved, latestRelease, packageReadiness } from "./release";
import { buildSeed, sha256, type SeedData } from "./seed";
import type { Fact, Release, Revision, ReviewTask, Site } from "./types";

interface StoredFile { name: string; mediaType: string; bytes: Buffer; sha256: string }
const g = globalThis as unknown as { __eqore?: SeedData & { files: Map<string, StoredFile> } };

function db() {
  if (!g.__eqore) g.__eqore = { ...buildSeed(), files: new Map() };
  return g.__eqore;
}
const nowIso = () => new Date().toISOString();
const LABELS = "ABCDEFGHIJKLMNOP";

export const getSites = (): Site[] => db().sites;
export const getSite = (id: string) => db().sites.find((s) => s.id === id);
export const getReviews = (siteId?: string) => db().reviews.filter((r) => !siteId || r.siteId === siteId);
export const getReview = (id: string) => db().reviews.find((r) => r.id === id);
export const getReleases = (siteId?: string) => db().releases.filter((r) => !siteId || r.siteId === siteId);
export const getRelease = (id: string) => db().releases.find((r) => r.id === id);
export const getFile = (fileId: string) => db().files.get(fileId);

export function putFile(name: string, mediaType: string, bytes: Buffer) {
  const hash = sha256(bytes);
  const fileId = `f_${hash.slice(0, 16)}`;
  db().files.set(fileId, { name, mediaType, bytes, sha256: hash });
  return { fileId, sha256: hash };
}

/** Upload → new revision IN REVIEW + a review task. Never touches existing releases. */
export function submitRevision(
  siteId: string,
  input: { requirementId: string; fileId?: string; fileName: string; sha256: string; facts: Fact[]; effectiveDate?: string; source?: Revision["source"]; uploadedBy?: string; summary?: string; aiConfidence?: number; engine?: Revision["engine"]; synthetic?: boolean },
) {
  const site = getSite(siteId);
  if (!site) throw new Error("site not found");
  if (!REQ_BY_ID[input.requirementId]) throw new Error("unknown document type");
  const existing = site.documents.filter((d) => d.requirementId === input.requirementId);
  const duplicate = existing.find((d) => d.sha256 === input.sha256);
  if (duplicate) throw new Error(`Duplicate: identical file already on record as Rev ${duplicate.revLabel}`);
  const version = existing.length ? Math.max(...existing.map((d) => d.version)) + 1 : 1;
  const today = nowIso().slice(0, 10);
  const rev: Revision = {
    id: `${siteId}-${input.requirementId}-r${LABELS[version - 1]}-${Date.now()}`,
    siteId,
    requirementId: input.requirementId,
    revLabel: LABELS[version - 1],
    version,
    fileName: input.fileName,
    fileId: input.fileId,
    sha256: input.sha256,
    source: input.source ?? "supplier",
    uploadedBy: input.uploadedBy ?? "Uploader",
    uploadedAt: today,
    effectiveDate: input.effectiveDate || today,
    status: "in_review",
    facts: input.facts ?? [],
    summary: input.summary,
    aiConfidence: input.aiConfidence,
    engine: input.engine,
    synthetic: input.synthetic,
  };
  site.documents.push(rev);

  const prev = latestApproved(site, input.requirementId);
  const affectedReleaseIds = Object.keys(TEMPLATE_BY_ID)
    .map((t) => latestRelease(db().releases, siteId, t))
    .filter((r): r is Release => !!r && r.items.some((i) => i.requirementId === input.requirementId))
    .map((r) => r.id);
  const task: ReviewTask = {
    id: `RV-${siteId}-${Date.now()}`,
    siteId,
    revisionId: rev.id,
    previousRevisionId: prev?.id,
    requirementId: input.requirementId,
    changes: diffFacts(prev?.facts, rev.facts),
    affectedReleaseIds,
    affectedRequirementIds: dependentsOf(input.requirementId),
    assignee: "EQORE engineer",
    status: "open",
    createdAt: nowIso(),
  };
  db().reviews.push(task);
  return { revision: rev, review: task };
}

export function decideReview(taskId: string, decision: "approve" | "reject", by: string, note?: string) {
  const task = getReview(taskId);
  if (!task) throw new Error("review not found");
  if (task.status !== "open") throw new Error("review already decided");
  const site = getSite(task.siteId)!;
  const rev = site.documents.find((d) => d.id === task.revisionId)!;
  const at = nowIso();
  task.status = decision === "approve" ? "approved" : "rejected";
  task.decidedBy = by;
  task.decidedAt = at;
  task.note = note;
  rev.status = decision === "approve" ? "approved" : "rejected";
  if (decision === "approve") {
    rev.approvedBy = by;
    rev.approvedAt = at;
  }
  return { task, revision: rev };
}

/** Build a version-locked release from APPROVED revisions only. */
export function buildRelease(siteId: string, templateId: string, by: string, note?: string, acknowledgeFlags = false) {
  const site = getSite(siteId);
  const t = TEMPLATE_BY_ID[templateId];
  if (!site || !t) throw new Error("site or package not found");
  const ready = packageReadiness(site, t);
  if (!ready.canBuild) throw new Error(`Blocked: ${ready.blockers.map((b) => `${b.name} (${b.state.replace("_", " ")})`).join(", ")}`);
  if (ready.flags.length && !acknowledgeFlags) throw new Error("Engineering flags open — an engineer must acknowledge them (with a note) before building");
  const prev = latestRelease(db().releases, siteId, templateId);
  const items = ready.items.map((i) => ({
    requirementId: i.requirementId,
    revisionId: i.approved!.id,
    revLabel: i.approved!.revLabel,
    fileName: i.approved!.fileName,
    sha256: i.approved!.sha256,
    approvedBy: i.approved!.approvedBy,
    approvedAt: i.approved!.approvedAt,
  }));
  const rel: Release = {
    id: `${siteId}-${templateId}-R${(prev?.number ?? 0) + 1}`,
    siteId,
    templateId,
    number: (prev?.number ?? 0) + 1,
    items,
    openFlags: ready.flags.map((f) => `${f} — acknowledged by ${by}${note ? `: ${note}` : ""}`),
    builtBy: by,
    builtAt: nowIso(),
    note,
    manifestSha256: sha256(JSON.stringify(items)),
  };
  db().releases.push(rel);
  return rel;
}

export function resetStore() {
  g.__eqore = { ...buildSeed(), files: new Map() };
}
