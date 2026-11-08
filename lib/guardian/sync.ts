// Turns VERIFIED cross-document discrepancies between APPROVED current documents into engineer review tasks
// (the existing EngineeringTask mechanism, so they gate releases and are resolved through the existing endpoints).
// Called by the store after an approval. Deterministic; AI is never consulted here.
import { randomUUID } from "node:crypto";
import { REQ_BY_ID } from "../requirements";
import type { EngineeringTask, Site } from "../types";
import { findConsistency } from "./consistency";
import type { ConsistencyFinding } from "./types";

const KEY = { voltage: "rating.voltage_v", current: "rating.current_a", interrupting: "rating.interrupting_ka" } as const;
const snap = (f: ConsistencyFinding) => ({
  findingId: f.id, quantity: f.quantity, reason: f.reason,
  a: { revisionId: f.a.revisionId, display: f.a.display, evidence: f.a.evidence, page: f.a.page },
  b: { revisionId: f.b.revisionId, display: f.b.display, evidence: f.b.evidence, page: f.b.page },
});

export function syncConsistencyTasks(site: Site, now = new Date().toISOString()) {
  const verified = findConsistency(site, { view: "approved" }).findings.filter((f) => f.class === "verified_discrepancy");
  const tasks = (site.engTasks ??= []);
  const created: EngineeringTask[] = [], attached: string[] = [], superseded: string[] = [];
  for (const f of verified) {
    if (tasks.some((t) => t.findingIds?.includes(f.id) && t.status !== "superseded")) continue; // already under (or through) review
    const dep = tasks.find((t) => t.status === "open" && t.kind !== "consistency" &&
      ((t.sourceRevisionId === f.a.revisionId && t.dependentRequirementId === f.b.requirementId) || (t.sourceRevisionId === f.b.revisionId && t.dependentRequirementId === f.a.requirementId)));
    if (dep) {
      dep.findingIds = [...(dep.findingIds ?? []), f.id];
      dep.consistency = [...(dep.consistency ?? []), snap(f)];
      attached.push(dep.id);
      continue;
    }
    const t: EngineeringTask = {
      id: `ENG-${randomUUID().slice(0, 8)}`, siteId: site.id, kind: "consistency",
      sourceRevisionId: f.a.revisionId, sourceRequirementId: f.a.requirementId,
      dependentRequirementId: f.b.requirementId, dependentRevisionId: f.b.revisionId,
      changedKeys: [KEY[f.quantity]],
      explanation: `cross-document discrepancy — ${REQ_BY_ID[f.b.requirementId]?.name ?? f.b.requirementId} Rev ${f.b.revLabel} states ${f.b.display}, ${REQ_BY_ID[f.a.requirementId]?.name ?? f.a.requirementId} Rev ${f.a.revLabel} states ${f.a.display} (${f.quantity}, same equipment). ${f.reason}`,
      status: "open", createdAt: now, findingIds: [f.id], consistency: [snap(f)],
    };
    tasks.push(t);
    created.push(t);
  }
  // A consistency task whose discrepancy no longer exists (a document was re-issued) is superseded, not resolved.
  const live = new Set(verified.map((f) => f.id));
  for (const t of tasks) {
    if (t.status === "open" && t.kind === "consistency" && !(t.findingIds ?? []).some((id) => live.has(id))) {
      Object.assign(t, { status: "superseded", resolutionNote: "Discrepancy no longer present in the current approved documents", resolvedAt: now });
      superseded.push(t.id);
    }
  }
  return { created, attached, superseded };
}
