// Project Time Machine (pure, read-only): a FROZEN release snapshot vs the current candidate state.
// Release data comes only from the sealed snapshot (integrity re-verified); nothing historical is regenerated.
import { verifyReleaseSnapshot } from "@releaseos/release-core";
import { compareFacts } from "../intelligence";
import { latestApproved, packageReadiness, pendingRevision } from "../release";
import { REQ_BY_ID, TEMPLATE_BY_ID } from "../requirements";
import type { PinnedItem, Release, Revision, Site } from "../types";
import type { TimeMachineReport } from "./types";

export function timeMachine(site: Site, release: Release): TimeMachineReport {
  const s = release.snapshot;
  if (!s) throw new Error("release has no frozen snapshot");
  const t = TEMPLATE_BY_ID[release.templateId];
  const a = (s.annotations ?? {}) as { revisions?: Revision[]; pinnedItems?: PinnedItem[]; projectMemory?: { id: string }[] };
  const frozenRevs = a.revisions ?? [];
  const pinned = a.pinnedItems ?? release.items;
  const builtAt = s.builtAt;
  const ready = packageReadiness(site, t);
  const pinnedReqs = new Set(pinned.map((p) => p.requirementId));
  const frozenMemory = new Set((a.projectMemory ?? []).map((m) => m.id));

  const newRequirements = (site.memory ?? [])
    .filter((m) => !frozenMemory.has(m.id) && m.status !== "dismissed" && m.status !== "merged" && (m.templateIds.includes(t.id) || (m.status === "suggested" && !m.templateIds.length)) && (m.confirmedAt ?? m.createdAt) > builtAt)
    .map((m) => ({ memoryItemId: m.id, title: m.title, status: m.status === "suggested" ? "suggested (not authoritative)" : m.status, confirmedAt: m.confirmedAt, source: m.sources[0] ? `${m.sources[0].sender}, ${m.sources[0].sentAt.slice(0, 10)}` : undefined, requirementId: m.requirementId }));

  const addedChecklistDocuments = ready.items.filter((i) => !pinnedReqs.has(i.requirementId)).map((i) => {
    const asked = (site.memory ?? []).filter((m) => i.requiredBy.includes(m.id));
    return { requirementId: i.requirementId, name: i.name, reason: asked.length ? `Required by confirmed requirement ${asked.map((m) => `“${m.title}”`).join(", ")}` : "Added to the package checklist" };
  });

  const replacedDocuments = pinned.flatMap((p) => {
    const frozen = frozenRevs.find((r) => r.id === p.revisionId);
    const approved = latestApproved(site, p.requirementId);
    const pending = pendingRevision(site, p.requirementId);
    const name = REQ_BY_ID[p.requirementId]?.name ?? p.requirementId;
    const out: TimeMachineReport["replacedDocuments"] = [];
    if (approved && approved.id !== p.revisionId) {
      out.push({ requirementId: p.requirementId, name, releasedRev: p.revLabel, releasedSha256: p.sha256, currentRev: approved.revLabel, currentStatus: "approved", currentRevisionId: approved.id, factChanges: compareFacts(frozen?.facts ?? [], approved.facts).filter((c) => c.significance !== "informational").map((c) => ({ label: c.label, before: c.before, after: c.after, significance: c.significance })) });
    }
    if (pending) {
      out.push({ requirementId: p.requirementId, name, releasedRev: p.revLabel, releasedSha256: p.sha256, currentRev: pending.revLabel, currentStatus: "pending", currentRevisionId: pending.id, factChanges: compareFacts((approved ?? frozen)?.facts ?? [], pending.facts).filter((c) => c.significance !== "informational").map((c) => ({ label: c.label, before: c.before, after: c.after, significance: c.significance })) });
    }
    return out;
  });

  const reqs = new Set(ready.items.map((i) => i.requirementId));
  const newEngineeringTasks = (site.engTasks ?? []).filter((x) => x.createdAt > builtAt && reqs.has(x.dependentRequirementId))
    .map((x) => ({ id: x.id, kind: x.kind ?? "dependency", status: x.status, explanation: x.explanation, createdAt: x.createdAt }));

  const resolvedSinceRelease = [
    ...(site.engTasks ?? []).filter((x) => x.status === "resolved" && (x.resolvedAt ?? "") > builtAt && reqs.has(x.dependentRequirementId)).map((x) => ({ id: x.id, kind: x.kind === "consistency" ? "consistency review" : "dependency review", label: `${REQ_BY_ID[x.dependentRequirementId]?.name}: ${x.resolutionNote ?? ""}`, resolvedBy: x.resolvedBy, resolvedAt: x.resolvedAt })),
    ...(site.memory ?? []).filter((m) => m.status === "resolved" && (m.resolvedAt ?? "") > builtAt && m.templateIds.includes(t.id)).map((m) => ({ id: m.id, kind: m.kind.replace("_", " "), label: `${m.title}: ${m.resolutionNote ?? ""}`, resolvedBy: m.resolvedBy, resolvedAt: m.resolvedAt })),
    ...site.documents.filter((d) => d.status === "approved" && (d.approvedAt ?? "") > builtAt && reqs.has(d.requirementId)).map((d) => ({ id: d.id, kind: "revision approval", label: `${REQ_BY_ID[d.requirementId]?.name} Rev ${d.revLabel} approved`, resolvedBy: d.approvedBy, resolvedAt: d.approvedAt })),
  ];

  const reasons: string[] = [];
  for (const r of replacedDocuments.filter((x) => x.currentStatus === "approved")) reasons.push(`${r.name}: R${release.number} pins Rev ${r.releasedRev}; Rev ${r.currentRev} is now approved${r.factChanges.some((c) => c.significance === "material") ? ` with material changes (${r.factChanges.filter((c) => c.significance === "material").map((c) => `${c.label} ${c.before ?? "—"} → ${c.after ?? "—"}`).join("; ")})` : ""}.`);
  for (const r of replacedDocuments.filter((x) => x.currentStatus === "pending")) reasons.push(`${r.name}: Rev ${r.currentRev} is uploaded and awaiting engineer review.`);
  for (const d of addedChecklistDocuments) reasons.push(`${d.name} was not in R${release.number}. ${d.reason}.`);
  for (const m of newRequirements.filter((x) => !x.status.startsWith("suggested"))) reasons.push(`New ${m.status} requirement since R${release.number}: “${m.title}”${m.source ? ` (${m.source})` : ""}.`);
  const openNew = newEngineeringTasks.filter((x) => x.status === "open");
  if (openNew.length) reasons.push(`${openNew.length} engineering review task(s) raised since R${release.number} are still open.`);
  const fresh = replacedDocuments.some((x) => x.currentStatus === "approved") || addedChecklistDocuments.length > 0 || newRequirements.some((x) => !x.status.startsWith("suggested"));

  return {
    siteId: site.id, templateId: t.id,
    release: { id: release.id, number: release.number, builtAt, builtBy: release.builtBy, snapshotSha256: s.sha256, integrityVerified: verifyReleaseSnapshot(s) },
    comparedAt: new Date().toISOString(),
    newRequirements, addedChecklistDocuments, replacedDocuments, newEngineeringTasks, resolvedSinceRelease,
    currentBlockers: ready.issues.map((i) => ({ code: i.code, message: i.message })),
    attentionReasons: reasons.length ? reasons : [`Nothing has changed for this package since R${release.number}.`],
    freshSubmissionRecommended: fresh,
  };
}
