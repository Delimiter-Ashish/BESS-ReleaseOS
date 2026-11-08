// THE single authoritative application store (in-memory working set, one server process).
// Durability: every mutation writes an atomic JSON snapshot + content-addressed upload bytes (lib/persistence.ts),
// loaded and integrity-checked on startup. LIMITATION (explicit): single process only — multiple
// instances/serverless workers do not share state. Swap these functions for Postgres later; the rest of the app only calls them.
//
// Mutations enforce the deterministic rules: AI output never approves, never resolves, never releases.
import { createReleaseZip, verifyReleaseSnapshot } from "@releaseos/release-core";
import { randomUUID } from "node:crypto";
import type { Session } from "./auth";
import { pinnedFromSnapshot, sealRelease } from "./engine-adapter";
import type { ExtractionResult } from "./extract";
import { affectedDependents, compareFacts, dependencyExplanation, materialChanges } from "./intelligence";
import { REQ_BY_ID, TEMPLATE_BY_ID } from "./requirements";
import { syncConsistencyTasks } from "./guardian/sync";
import { applicableItems } from "./memory/readiness";
import { buildManifest, latestApproved, latestRelease, packageReadiness, revisionsOf } from "./release";
import { clearState, loadState, saveBlob, saveState, type StoredFile } from "./persistence";
import { buildSeed, placeholderContent, sha256, type SeedData } from "./seed";
import type { DecisionRecord, EngineeringTask, FactChange, PinnedItem, Release, Revision, ReviewTask, Site } from "./types";

export interface ExtractionRecord {
  id: string;
  siteId: string;
  fileId: string;
  sha256: string;
  fileName: string;
  mediaType: string;
  textLayer: string;
  pageCount: number;
  result: ExtractionResult;
  /** AI/rule explanations computed against the then-approved revision, keyed by fact key. */
  impacts: Record<string, { impact: string; source: "openai" | "rules"; suggested?: string[] }>;
  aiSummary?: { text: string; source: "openai" | "rules" };
  createdBy: string;
  createdAt: string;
}
type DB = SeedData & { files: Map<string, StoredFile>; extractions: Map<string, ExtractionRecord>; startedAt: string };
const g = globalThis as unknown as { __eqore?: DB };

function init(): DB {
  const saved = loadState();
  if (saved) return { ...saved, extractions: new Map() };
  const seed = buildSeed();
  const db: DB = { ...seed, extractions: new Map(), startedAt: new Date().toISOString() };
  finalizeSeed(db);
  return db;
}
function db(): DB {
  if (!g.__eqore) g.__eqore = init();
  return g.__eqore;
}
const nowIso = () => new Date().toISOString();
/** Durably record the current state (called at the end of every successful mutation). */
export function persist() {
  saveState(db());
}
const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export class StoreError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const storeStartedAt = () => db().startedAt;
export const getSites = (): Site[] => db().sites;
export const getSite = (id: string) => db().sites.find((s) => s.id === id);
export const getReviews = (siteId?: string) => db().reviews.filter((r) => !siteId || r.siteId === siteId);
export const getReview = (id: string) => db().reviews.find((r) => r.id === id);
export const getReleases = (siteId?: string) => db().releases.filter((r) => !siteId || r.siteId === siteId);
export const getRelease = (id: string) => db().releases.find((r) => r.id === id);
export const getFile = (fileId: string) => db().files.get(fileId);
export const getExtraction = (id: string) => db().extractions.get(id);
export const getEngTasks = (siteId: string) => getSite(siteId)?.engTasks ?? [];
export const getDecisions = (siteId: string) => getSite(siteId)?.decisions ?? [];
export const findRevision = (site: Site, id: string) => site.documents.find((d) => d.id === id);

export function putFile(name: string, mediaType: string, bytes: Buffer) {
  const hash = sha256(bytes); // computed server-side from the actual bytes
  const fileId = `f_${hash.slice(0, 24)}`;
  db().files.set(fileId, { name, mediaType, bytes, sha256: hash });
  saveBlob(hash, bytes); // uploaded evidence is durable as soon as it is received
  return { fileId, sha256: hash };
}

/** Original bytes for a revision (uploaded file, or the deterministic synthetic placeholder for seed rows). Hash-checked. */
export function bytesFor(rev: Revision): Buffer {
  const stored = rev.fileId ? getFile(rev.fileId) : undefined;
  const bytes = stored ? stored.bytes : Buffer.from(placeholderContent(rev));
  if (sha256(bytes) !== rev.sha256) throw new StoreError(500, `Integrity error: bytes for ${rev.id} do not match recorded sha256`);
  return bytes;
}

export function saveExtraction(rec: Omit<ExtractionRecord, "id" | "createdAt">) {
  const id = `ex_${randomUUID()}`;
  const full = { ...rec, id, createdAt: nowIso() };
  db().extractions.set(id, full);
  // Bound memory: keep the 200 most recent previews.
  if (db().extractions.size > 200) db().extractions.delete(db().extractions.keys().next().value as string);
  return full;
}

function record(site: Site, d: Omit<DecisionRecord, "id" | "at" | "siteId">): DecisionRecord {
  const rec: DecisionRecord = { ...d, id: `DEC-${randomUUID().slice(0, 8)}`, siteId: site.id, at: nowIso() };
  (site.decisions ??= []).push(rec);
  return rec;
}
const reviewerFields = (s: Session) => ({ reviewerId: s.userId, reviewerName: s.name, reviewerRoles: s.roles });
function requireEngineer(s: Session) {
  if (!s.engineer) throw new StoreError(403, `${s.name} is not an authorized engineer`);
}
function requireNote(note: string | undefined, what: string) {
  const n = (note ?? "").trim();
  if (n.length < 3) throw new StoreError(400, `${what} requires a written note`);
  return n.slice(0, 1000);
}

/** File an extracted upload as a new revision IN REVIEW. Facts come from the server-side extraction record, never the client. */
export function submitRevision(siteId: string, input: { extractionId: string; requirementId: string; effectiveDate?: string; source?: Revision["source"] }, session: Session) {
  const site = getSite(siteId);
  if (!site) throw new StoreError(404, "site not found");
  const ex = getExtraction(input.extractionId);
  if (!ex || ex.siteId !== siteId) throw new StoreError(400, "Unknown or expired extraction — upload the file again");
  if (ex.createdBy !== session.userId) throw new StoreError(403, "Only the uploader can file this extraction");
  if (!REQ_BY_ID[input.requirementId]) throw new StoreError(400, "Choose a valid document type");
  const file = getFile(ex.fileId);
  if (!file || sha256(file.bytes) !== ex.sha256) throw new StoreError(500, "Stored file missing or altered");
  const existing = revisionsOf(site, input.requirementId);
  const duplicate = existing.find((d) => d.sha256 === ex.sha256);
  if (duplicate) throw new StoreError(409, `Duplicate: identical file already on record as Rev ${duplicate.revLabel}`);

  const version = existing.length ? Math.max(...existing.map((d) => d.version)) + 1 : 1;
  const docLabel = ex.result.revisionLabel?.toUpperCase();
  const used = new Set(existing.map((d) => d.revLabel));
  const revLabel = docLabel && /^[A-Z0-9]{1,3}$/.test(docLabel) && !used.has(docLabel) ? docLabel : LABELS[version - 1] ?? String(version);
  const date = input.effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate) ? input.effectiveDate : ex.result.effectiveDate ?? nowIso().slice(0, 10);
  const SOURCES: Revision["source"][] = ["supplier", "engineer", "eqore", "ahj", "utility", "facility"];
  const rev: Revision = {
    id: `${siteId}-${input.requirementId}-r${revLabel}-${Date.now()}`,
    siteId, requirementId: input.requirementId, revLabel, version,
    fileName: ex.fileName, fileId: ex.fileId, sha256: ex.sha256, mediaType: ex.mediaType,
    source: SOURCES.includes(input.source as Revision["source"]) ? (input.source as Revision["source"]) : session.role === "supplier" ? "supplier" : "eqore",
    uploadedBy: session.name, uploadedById: session.userId, uploadedAt: nowIso(), effectiveDate: date,
    status: "in_review", facts: ex.result.facts, summary: ex.result.summary, aiConfidence: ex.result.docTypeConfidence,
    engine: ex.result.engine, model: ex.result.model, textLayer: ex.textLayer, pageCount: ex.pageCount,
    extractionWarnings: ex.result.warnings, missingItems: ex.result.missingItems,
    synthetic: /sample|synthetic/i.test(ex.fileName),
  };

  // Older pending uploads of the same document are superseded (only the latest upload can be reviewed).
  for (const old of existing.filter((d) => d.status === "in_review" || d.status === "uploaded")) {
    old.status = "rejected"; old.rejectedBy = "system: superseded by newer upload"; old.rejectedAt = nowIso();
    for (const t of db().reviews) if (t.revisionId === old.id && t.status === "open") { t.status = "rejected"; t.decidedBy = "system"; t.decidedAt = nowIso(); t.note = `Superseded by Rev ${revLabel} before review`; }
  }
  site.documents.push(rev);

  const prev = latestApproved(site, input.requirementId);
  let changes: FactChange[] = prev ? compareFacts(prev.facts, rev.facts) : [];
  changes = changes.map((c) => (ex.impacts[c.key] && c.significance === "material" ? { ...c, impact: ex.impacts[c.key].impact, impactSource: ex.impacts[c.key].source } : c));
  const material = materialChanges(changes);

  // Carry forward still-open dependency reviews raised by an earlier revision of this source (core semantics).
  const tasks = (site.engTasks ??= []);
  const inherited = tasks.filter((t) => t.sourceRequirementId === input.requirementId && t.status === "open");
  const inheritedKeys = inherited.flatMap((t) => t.changedKeys);
  inherited.forEach((t) => (t.status = "superseded"));
  const changedKeys = Array.from(new Set([...material.map((c) => c.key), ...inheritedKeys]));

  const dependents = changedKeys.length ? affectedDependents(input.requirementId, changedKeys) : [];
  const created: EngineeringTask[] = [];
  const missingDependents: string[] = [];
  for (const dep of dependents) {
    const depApproved = latestApproved(site, dep.id);
    if (!depApproved) { missingDependents.push(dep.id); continue; }
    const relevant = material.filter((c) => !dep.dependencyFields?.length || dep.dependencyFields.includes(c.key));
    const keys = Array.from(new Set([...relevant.map((c) => c.key), ...inheritedKeys.filter((k) => !dep.dependencyFields?.length || dep.dependencyFields.includes(k))]));
    const suggested = Object.values(ex.impacts).some((i) => i.suggested?.includes(dep.id));
    const t: EngineeringTask = {
      id: `ENG-${randomUUID().slice(0, 8)}`, siteId, sourceRevisionId: rev.id, sourceRequirementId: input.requirementId,
      dependentRequirementId: dep.id, dependentRevisionId: depApproved.id, changedKeys: keys,
      explanation: dependencyExplanation(input.requirementId, revLabel, dep.id, relevant.length ? relevant : material),
      aiImpact: relevant.map((c) => c.impact).filter(Boolean).join(" ") || undefined,
      status: "open", createdAt: nowIso(),
    };
    if (suggested) t.aiImpact = `${t.aiImpact ?? ""} (AI also flagged this document.)`.trim();
    tasks.push(t);
    created.push(t);
  }

  const affectedReleaseIds = Object.keys(TEMPLATE_BY_ID)
    .map((t) => latestRelease(db().releases, siteId, t))
    .filter((r): r is Release => !!r && r.items.some((i) => i.requirementId === input.requirementId || created.some((t) => t.dependentRequirementId === i.requirementId)))
    .map((r) => r.id);
  const review: ReviewTask = {
    id: `RV-${siteId}-${Date.now()}`, siteId, revisionId: rev.id, previousRevisionId: prev?.id, requirementId: input.requirementId,
    changes, affectedReleaseIds, affectedRequirementIds: created.map((t) => t.dependentRequirementId),
    assignee: "EQORE engineer", status: "open", createdAt: nowIso(),
    materialChangeCount: material.length, aiSummary: ex.aiSummary?.text, aiSummarySource: ex.aiSummary?.source, potentiallyAffectedMissing: missingDependents,
  };
  db().reviews.push(review);
  persist();
  return { revision: rev, review, engineeringTasks: created };
}

/** Engineer approves/rejects a revision. Optional: resolve dependency tasks that target THIS document (new revision path). */
export function decideReview(taskId: string, decision: "approve" | "reject", session: Session, note: string | undefined, resolveTaskIds: string[] = []) {
  requireEngineer(session);
  const text = requireNote(note, decision === "approve" ? "Approval" : "Rejection");
  const task = getReview(taskId);
  if (!task) throw new StoreError(404, "review not found");
  if (task.status !== "open") throw new StoreError(409, "review already decided");
  const site = getSite(task.siteId)!;
  const rev = findRevision(site, task.revisionId)!;
  if (rev.uploadedById && rev.uploadedById === session.userId) throw new StoreError(403, "Self-approval blocked: the uploader cannot decide their own revision");
  const newest = revisionsOf(site, rev.requirementId)[0];
  if (newest.id !== rev.id) throw new StoreError(409, "A newer upload exists; review the current revision");
  const resolving = resolveTaskIds.map((id) => (site.engTasks ?? []).find((t) => t.id === id));
  if (resolving.length && decision !== "approve") throw new StoreError(400, "Only an approval can resolve dependency reviews");
  for (const t of resolving) {
    if (!t || t.status !== "open" || t.dependentRequirementId !== rev.requirementId) throw new StoreError(400, "Dependency task must be open and target this document");
    assertSourceApproved(site, t);
  }
  const at = nowIso();
  const dec = record(site, { kind: "revision_review", revisionId: rev.id, contentSha256: rev.sha256, taskIds: resolving.map((t) => t!.id), decision: decision === "approve" ? "approved" : "rejected", ...reviewerFields(session), note: text });
  task.status = decision === "approve" ? "approved" : "rejected";
  task.decidedBy = session.name; task.decidedAt = at; task.note = text;
  rev.status = decision === "approve" ? "approved" : "rejected";
  if (decision === "approve") { rev.approvedBy = session.name; rev.approvedAt = at; }
  else {
    rev.rejectedBy = session.name; rev.rejectedAt = at;
    // A rejected source revision will never be selected: its dependency reviews are moot.
    for (const t of site.engTasks ?? []) if (t.sourceRevisionId === rev.id && t.status === "open") t.status = "superseded";
  }
  for (const t of resolving) Object.assign(t!, { status: "resolved", resolvedBy: session.name, resolvedAt: at, resolution: "new_revision_approved", resolutionNote: text, resolvedByDecisionId: dec.id });
  // Project Guardian: the approved document set changed — re-run the deterministic cross-document check.
  const consistency = decision === "approve" ? syncConsistencyTasks(site, at) : undefined;
  persist();
  return { task, revision: rev, decision: dec, consistency };
}

function assertSourceApproved(site: Site, t: EngineeringTask) {
  const src = findRevision(site, t.sourceRevisionId);
  const approved = latestApproved(site, t.sourceRequirementId);
  if (!src || src.status !== "approved" || approved?.id !== src.id) throw new StoreError(409, `Approve ${REQ_BY_ID[t.sourceRequirementId]?.name ?? "the source"} Rev ${src?.revLabel ?? "?"} before resolving dependent reviews`);
}

/** Engineer confirms a dependent document remains valid after a source change (recorded, note required). */
export function resolveEngineeringTask(siteId: string, taskId: string, session: Session, note: string | undefined) {
  requireEngineer(session);
  const text = requireNote(note, "Resolving a dependency review");
  const site = getSite(siteId);
  if (!site) throw new StoreError(404, "site not found");
  const t = (site.engTasks ?? []).find((x) => x.id === taskId);
  if (!t) throw new StoreError(404, "task not found");
  if (t.status !== "open") throw new StoreError(409, `task is ${t.status}`);
  assertSourceApproved(site, t);
  const dependent = latestApproved(site, t.dependentRequirementId);
  const dec = record(site, { kind: "dependency_resolution", revisionId: dependent?.id, contentSha256: dependent?.sha256, taskIds: [t.id], decision: "resolved", ...reviewerFields(session), note: text });
  Object.assign(t, { status: "resolved", resolvedBy: session.name, resolvedAt: dec.at, resolution: "confirmed_no_change", resolutionNote: text, resolvedByDecisionId: dec.id });
  persist();
  return { task: t, decision: dec };
}

/** Build an immutable, version-locked release from APPROVED revisions only. All metadata frozen into a sealed snapshot. */
export function buildRelease(siteId: string, templateId: string, session: Session, note: string | undefined, expectedToken: string | undefined) {
  requireEngineer(session);
  const text = requireNote(note, "Release signoff");
  const site = getSite(siteId);
  const t = TEMPLATE_BY_ID[templateId];
  if (!site || !t) throw new StoreError(404, "site or package not found");
  const ready = packageReadiness(site, t);
  if (!expectedToken || expectedToken !== ready.token) throw new StoreError(409, "Package changed since readiness was checked — refresh before signing", { token: ready.token });
  if (!ready.canBuild) throw new StoreError(409, `Blocked: ${ready.issues.map((i) => i.message).join("; ")}`, { issues: ready.issues });
  const rel = createRelease(site, templateId, session, text, ready.token, nowIso());
  persist();
  return rel;
}

function createRelease(site: Site, templateId: string, s: Pick<Session, "userId" | "name" | "roles">, note: string, token: string, builtAt: string, seeded = false) {
  const t = TEMPLATE_BY_ID[templateId];
  const ready = packageReadiness(site, t);
  const prev = latestRelease(db().releases, site.id, templateId);
  const number = (prev?.number ?? 0) + 1;
  const id = `${site.id}-${templateId}-R${number}`;
  const pinned = ready.items.map((i) => i.approved!);
  const items: PinnedItem[] = pinned.map((r) => ({ requirementId: r.requirementId, revisionId: r.id, revLabel: r.revLabel, fileName: r.fileName, sha256: r.sha256, approvedBy: r.approvedBy, approvedAt: r.approvedAt }));
  const signoff: DecisionRecord = seeded
    ? { id: `DEC-seed-${id}`, siteId: site.id, kind: "release_signoff", releaseId: id, taskIds: [], decision: "signed_off", reviewerId: s.userId, reviewerName: s.name, reviewerRoles: s.roles, note, at: builtAt, seeded: true }
    : record(site, { kind: "release_signoff", releaseId: id, taskIds: [], decision: "signed_off", ...reviewerFields(s as Session), note });
  if (seeded) (site.decisions ??= []).push(signoff);
  const pinnedIds = new Set(pinned.map((r) => r.id));
  const reqs = new Set(pinned.map((r) => r.requirementId));
  const decisions = (site.decisions ?? []).filter((d) => (d.revisionId && pinnedIds.has(d.revisionId)) || d.id === signoff.id || (site.engTasks ?? []).some((et) => et.resolvedByDecisionId === d.id && reqs.has(et.dependentRequirementId)));
  const tasks = (site.engTasks ?? []).filter((et) => et.status === "resolved" && reqs.has(et.dependentRequirementId));
  const draft: Release = { id, siteId: site.id, templateId, number, items, openFlags: [], builtBy: s.name, builtById: s.userId, builtAt, note, manifestSha256: "" };
  const manifest = buildManifest(site, draft, prev); // computed once, frozen into the snapshot
  const { documents: _docs, engTasks: _t, decisions: _d, communications: _c, memory: _m, ...siteRecord } = site;
  void _docs; void _t; void _d; void _c; void _m;
  // Project-memory items that applied to this package are frozen with their sources (omitted when none, e.g. seeded R1).
  const projectMemory = applicableItems(site, templateId).map((m) => ({ id: m.id, kind: m.kind, title: m.title, status: m.status, requirementId: m.requirementId, sources: m.sources, confirmedBy: m.confirmedBy, confirmedAt: m.confirmedAt, resolvedBy: m.resolvedBy, resolvedAt: m.resolvedAt, resolutionNote: m.resolutionNote, resolvedRevisionId: m.resolvedRevisionId, resolvedRevisionSha256: m.resolvedRevisionSha256 }));
  const snapshot = sealRelease({
    id, site, template: t, pinned, bytesFor, decisions, tasks, builtAt, builtById: s.userId, signoffNotes: note, readinessToken: token,
    annotations: {
      app: "BESS ReleaseOS", disclaimer: "Ready for engineer signoff — not a certification of code compliance. Synthetic demo data.",
      releaseNumber: number, templateName: t.name, audience: t.audience, basis: t.basis, previousReleaseId: prev?.id ?? null,
      signoff: { id: s.userId, name: s.name, roles: s.roles, note, at: builtAt },
      siteRecord: JSON.parse(JSON.stringify(siteRecord)),
      pinnedItems: items,
      revisions: pinned.map(({ textLayer: _x, ...r }) => { void _x; return r; }),
      decisions, engineeringTasks: tasks, manifest,
      ...(projectMemory.length ? { projectMemory } : {}),
    },
  });
  const rel: Release = { ...draft, manifestSha256: snapshot.sha256, snapshot };
  db().releases.push(rel);
  return rel;
}

/** ZIP of a frozen release (release-core verifies integrity first). Nothing is regenerated from live data. */
export function releaseZip(releaseId: string) {
  const rel = getRelease(releaseId);
  if (!rel?.snapshot) throw new StoreError(404, "release not found");
  const s = rel.snapshot;
  const a = (s.annotations ?? {}) as { manifest?: unknown; templateName?: string; releaseNumber?: number; signoff?: { name: string; note: string }; disclaimer?: string };
  const pins = pinnedFromSnapshot(s);
  const lines = [
    `${a.templateName ?? s.templateId} — ${s.site.name} — R${a.releaseNumber ?? rel.number}`,
    `Built ${s.builtAt} by ${a.signoff?.name ?? s.builtBy}: ${a.signoff?.note ?? s.signoffNotes}`,
    a.disclaimer ?? "", `snapshot sha256 ${s.sha256}`, "", "INDEX",
    ...s.manifest.flatMap((m, i) => [`${String(i + 1).padStart(2, "0")}. ${REQ_BY_ID[m.family]?.name ?? m.family} — Rev ${m.revisionLabel} — ${m.fileName}`, `    ${m.archivePath}`, `    sha256 ${m.sha256}`, `    approved by ${pins.find((p) => p.revisionId === m.versionId)?.approvedBy ?? "?"}`]),
  ];
  const bytes = createReleaseZip(s, { "MANIFEST.json": Buffer.from(JSON.stringify(a.manifest ?? {}, null, 2)), "INDEX.txt": Buffer.from(lines.join("\n")) });
  return { fileName: `${s.siteId}_${s.templateId}_R${rel.number}.zip`, bytes, sha256: sha256(Buffer.from(bytes)) };
}

export const verifyRelease = (rel: Release) => (rel.snapshot ? verifyReleaseSnapshot(rel.snapshot) : false);

export function resetStore() {
  clearState();
  g.__eqore = init();
  persist();
}

/** Test/ops hook: drop the in-memory working set so the next access reloads from disk (simulates a restart). */
export function reloadFromDisk() {
  g.__eqore = undefined;
  return db().startedAt;
}

// ---------- seed finalization: real decisions, explicit tasks, sealed R1 ----------
const SEED_ENGINEER = { userId: "seed-engineer", name: "EQORE engineer (seeded history)", roles: ["eqore", "engineer"] };
function finalizeSeed(d: DB) {
  for (const site of d.sites) {
    site.decisions ??= [];
    site.engTasks ??= [];
    for (const r of site.documents) {
      if (r.status !== "approved") continue;
      site.decisions.push({ id: `DEC-seed-${r.id}`, siteId: site.id, kind: "revision_review", revisionId: r.id, contentSha256: r.sha256, taskIds: [], decision: "approved", reviewerId: SEED_ENGINEER.userId, reviewerName: r.approvedBy ?? SEED_ENGINEER.name, reviewerRoles: SEED_ENGINEER.roles, note: "Seeded synthetic approval", at: `${r.approvedAt ?? r.effectiveDate}T12:00:00Z`, seeded: true });
    }
    // Legacy timestamp flags become explicit, resolvable dependency tasks (one mechanism everywhere).
    for (const req of Object.values(REQ_BY_ID)) {
      const doc = latestApproved(site, req.id);
      if (!req.dependsOn || !doc) continue;
      for (const dep of req.dependsOn) {
        const src = latestApproved(site, dep);
        if (src && (src.approvedAt ?? "") > (doc.approvedAt ?? "") && src.version > 1) {
          site.engTasks.push({ id: `ENG-seed-${site.id}-${req.id}-${dep}`, siteId: site.id, sourceRevisionId: src.id, sourceRequirementId: dep, dependentRequirementId: req.id, dependentRevisionId: doc.id, changedKeys: [], explanation: `${req.name} Rev ${doc.revLabel} predates ${REQ_BY_ID[dep].name} Rev ${src.revLabel} (approved ${String(src.approvedAt).slice(0, 10)}) — engineer to confirm or re-issue.`, status: "open", createdAt: `${src.approvedAt}T12:00:00Z` });
        }
      }
    }
  }
  // Seeded historical releases are re-created as sealed snapshots from the seed state.
  const legacy = d.releases;
  d.releases = [];
  g.__eqore = d; // allow createRelease → db() during finalization
  for (const r of legacy) {
    const site = d.sites.find((s) => s.id === r.siteId)!;
    const rel = createRelease(site, r.templateId, SEED_ENGINEER, r.note ?? "Seeded release", "seed", r.builtAt, true);
    if (rel.items.map((i) => i.revisionId).join() !== r.items.map((i) => i.revisionId).join()) throw new Error(`Seed release ${r.id} drifted from its pinned revisions`);
  }
}
