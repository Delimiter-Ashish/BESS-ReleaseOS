// Adapter: application contracts (Revision, Fact, PinnedItem, DecisionRecord, EngineeringTask)
// ⇄ release-core domain models (DocumentVersion, ExtractedFact, ReviewDecision, ReviewTask, ReleaseSnapshot).
// The application store stays authoritative; release-core seals, verifies, zips and compares frozen snapshots.
// Lossless: every original app record is frozen verbatim into snapshot.annotations.
import { createHash } from "node:crypto";
import {
  sealReleaseSnapshot,
  type Dependency as CoreDependency,
  type DocumentVersion as CoreVersion,
  type ExtractedFact as CoreFact,
  type FactField,
  type PackageTemplate as CoreTemplate,
  type ReleaseSnapshot,
  type ReviewDecision as CoreDecision,
  type ReviewTask as CoreTask,
} from "@releaseos/release-core";
import { normalizeFact } from "./normalize";
import { REQ_BY_ID, REQUIREMENTS, type PackageTemplate } from "./requirements";
import type { DecisionRecord, EngineeringTask, Fact, PinnedItem, Revision, Site } from "./types";

/** App fact key → core FactField. Keys without a core field are preserved in annotations only. */
export const KEY_TO_FIELD: Record<string, FactField> = {
  "rating.voltage_v": "voltageV",
  "rating.current_a": "currentA",
  "rating.power_kw": "powerRatingKW",
  "rating.energy_kwh": "batteryCapacityKWh",
  "rating.frequency_hz": "frequencyHz",
  "equipment.model": "equipmentModel",
  "equipment.manufacturer": "manufacturer",
  "equipment.quantity": "inverterQuantity",
  "revision.label": "revisionLabel",
};
const NUMERIC: Partial<Record<FactField, string | null>> = { voltageV: "V", currentA: "A", powerRatingKW: "kW", batteryCapacityKWh: "kWh", frequencyHz: "Hz", inverterQuantity: null };

export const documentIdFor = (siteId: string, requirementId: string) => `${siteId}:${requirementId}`;

function locate(text: string, excerpt: string | undefined) {
  if (!excerpt || !text) return null;
  const start = text.indexOf(excerpt);
  if (start < 0) return null;
  return { start, end: start + excerpt.length, line: text.slice(0, start).split("\n").length };
}


/** Map app facts to core ExtractedFacts. Values are canonical-unit normalized so core comparisons are unit-aware. */
export function toCoreFacts(versionId: string, facts: Fact[], text = ""): CoreFact[] {
  const out: CoreFact[] = [];
  for (const f of facts) {
    const field = KEY_TO_FIELD[f.key];
    if (!field) continue;
    const n = normalizeFact(f);
    const numericUnit = NUMERIC[field];
    const value: string | number = numericUnit !== undefined ? (n.number ?? NaN) : n.text;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    const loc = locate(text, f.evidence);
    out.push({
      field, value, unit: numericUnit !== undefined ? numericUnit : null,
      evidence: { documentVersionId: versionId, excerpt: f.evidence ?? "", start: loc?.start ?? 0, end: loc?.end ?? 0, line: loc?.line ?? 0, ...(f.page && f.pageVerified !== false ? { page: f.page } : {}) },
      confidence: Math.max(0, Math.min(1, f.confidence ?? 0)),
      verification: f.evidenceVerified || f.origin === "rules" ? "source-supported" : "needs-verification",
      origin: f.origin === "rules" ? "deterministic" : f.origin === "seed" ? "structured" : "ai",
    });
  }
  return out;
}

export function toCoreFactsOnly(versionId: string, facts: Fact[]) {
  const core = toCoreFacts(versionId, facts);
  return { facts: core, keysFor: (field: FactField) => facts.filter((f) => KEY_TO_FIELD[f.key] === field).map((f) => f.key) };
}

const coreStatus = (r: Revision): CoreVersion["approvalStatus"] => (r.status === "approved" ? "approved" : r.status === "rejected" ? "rejected" : "pending");

export function toCoreVersion(r: Revision, bytes: Buffer): CoreVersion {
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== r.sha256) throw new Error(`Stored bytes for ${r.id} do not match recorded sha256`);
  const text = r.textLayer ?? "";
  return {
    id: r.id, documentId: documentIdFor(r.siteId, r.requirementId), siteId: r.siteId, family: r.requirementId,
    supplierId: null, componentId: null, title: REQ_BY_ID[r.requirementId]?.name ?? r.requirementId,
    versionNumber: r.version, revisionLabel: r.revLabel, uploadedAt: r.uploadedAt, uploadedBy: r.uploadedBy,
    fileName: r.fileName, mediaType: r.mediaType ?? guessMedia(r.fileName), contentHash: r.sha256,
    contentBase64: bytes.toString("base64"), text, approvalStatus: coreStatus(r), facts: toCoreFacts(r.id, r.facts, text),
  };
}

const guessMedia = (n: string) => (/\.pdf$/i.test(n) ? "application/pdf" : /\.png$/i.test(n) ? "image/png" : /\.jpe?g$/i.test(n) ? "image/jpeg" : "text/plain");

export function toCoreDecision(d: DecisionRecord): CoreDecision {
  return {
    id: d.id, versionId: d.revisionId ?? "", contentHash: d.contentSha256 ?? "", reviewerId: d.reviewerId, reviewerName: d.reviewerName,
    reviewerRoles: d.reviewerRoles, decision: d.decision === "rejected" ? "rejected" : "approved", timestamp: d.at, notes: d.note, resolvedTaskIds: d.taskIds,
  };
}

export function toCoreTask(t: EngineeringTask, site: Site): CoreTask {
  const fields = Array.from(new Set(t.changedKeys.map((k) => KEY_TO_FIELD[k]).filter(Boolean)));
  void site;
  return {
    id: t.id, siteId: t.siteId, sourceVersionId: t.sourceRevisionId, sourceDocumentId: documentIdFor(t.siteId, t.sourceRequirementId),
    dependentDocumentId: documentIdFor(t.siteId, t.dependentRequirementId), dependencyPath: [documentIdFor(t.siteId, t.sourceRequirementId), documentIdFor(t.siteId, t.dependentRequirementId)],
    changedFields: fields, explanation: t.explanation, status: t.status, resolvedByDecisionId: t.resolvedByDecisionId ?? null,
  };
}

export function toCoreTemplate(t: PackageTemplate, stage: string): CoreTemplate {
  return {
    id: t.id, name: t.name, stage, packageType: t.id,
    requirements: t.required.map((rid) => ({ id: rid, family: rid, label: REQ_BY_ID[rid]?.name ?? rid, minimumCount: 1 })),
    jurisdictionRequirements: [], consistencyChecks: [],
  };
}

export function coreDependencies(siteId: string, requirementIds: string[]): CoreDependency[] {
  const inSet = new Set(requirementIds);
  return REQUIREMENTS.filter((r) => inSet.has(r.id) && r.dependsOn?.length).flatMap((r) =>
    r.dependsOn!.filter((src) => inSet.has(src)).map((src) => ({
      id: `dep:${siteId}:${src}->${r.id}`, siteId, sourceDocumentId: documentIdFor(siteId, src), dependentDocumentId: documentIdFor(siteId, r.id),
      relevantFields: Array.from(new Set((r.dependencyFields ?? []).map((k) => KEY_TO_FIELD[k]).filter(Boolean))),
      explanation: `${r.name} depends on ${REQ_BY_ID[src]?.name ?? src}`,
    })),
  );
}

const safeName = (n: string) => n.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "_").slice(0, 120) || "document.bin";

/** Assemble and seal a frozen ReleaseSnapshot from app records. Throws if integrity validation fails. */
export function sealRelease(input: {
  id: string;
  site: Site;
  template: PackageTemplate;
  pinned: Revision[];
  bytesFor: (r: Revision) => Buffer;
  decisions: DecisionRecord[];
  tasks: EngineeringTask[];
  builtAt: string;
  builtById: string;
  signoffNotes: string;
  readinessToken: string;
  annotations: Record<string, unknown>;
}): ReleaseSnapshot {
  const { site } = input;
  const ordered = [...input.pinned].sort((a, b) => (documentIdFor(a.siteId, a.requirementId) < documentIdFor(b.siteId, b.requirementId) ? -1 : 1));
  const documents = ordered.map((r) => toCoreVersion(r, input.bytesFor(r)));
  const approvals = ordered.map((r) => {
    const d = [...input.decisions].reverse().find((x) => x.kind === "revision_review" && x.revisionId === r.id && x.decision === "approved");
    if (!d) throw new Error(`No approval record for ${r.id}`);
    return toCoreDecision(d);
  });
  const reqIds = ordered.map((r) => r.requirementId);
  const { siteRecord, ...rest } = input.annotations;
  // Strict canonical JSON: drop undefined fields (JSON round-trip) before sealing.
  return sealReleaseSnapshot(JSON.parse(JSON.stringify({
    schemaVersion: 1, id: input.id, siteId: site.id, templateId: input.template.id, packageType: input.template.id, stage: site.stage,
    builtAt: input.builtAt, builtBy: input.builtById, signoffNotes: input.signoffNotes,
    site: { id: site.id, name: site.name, jurisdiction: site.ahj },
    template: toCoreTemplate(input.template, site.stage),
    manifest: documents.map((d, i) => ({ documentId: d.documentId, versionId: d.id, family: d.family, componentId: d.componentId, revisionLabel: d.revisionLabel, fileName: d.fileName, mediaType: d.mediaType, sha256: d.contentHash, archivePath: `documents/${String(i + 1).padStart(3, "0")}-${safeName(d.fileName)}` })),
    documents, reviewerApprovals: approvals,
    dependencies: coreDependencies(site.id, reqIds), reviewTasks: input.tasks.map((t) => toCoreTask(t, site)),
    readinessToken: input.readinessToken,
    annotations: { ...rest, siteRecord },
  })));
}

/** Read pinned items back out of a frozen snapshot (never from live data). */
export function pinnedFromSnapshot(s: ReleaseSnapshot): PinnedItem[] {
  const frozen = (s.annotations?.pinnedItems as PinnedItem[] | undefined) ?? [];
  if (frozen.length) return frozen;
  return s.manifest.map((m) => ({ requirementId: m.family, revisionId: m.versionId, revLabel: m.revisionLabel, fileName: m.fileName, sha256: m.sha256 }));
}
