// Pure project-memory checks used by the release gate (lib/release.ts). No I/O.
// ONLY items a human confirmed (status "confirmed"/"resolved", blocking=true, applicable package) take part.
import type { Site } from "../types";
import type { Advisory, IssueSource, MemoryItem } from "./types";

export const memoryOf = (site: Site): MemoryItem[] => site.memory ?? [];

/** Confirmed (or already resolved) blocking items that apply to this package. Suggestions are never included. */
export function applicableItems(site: Site, templateId: string) {
  return memoryOf(site).filter((m) => (m.status === "confirmed" || m.status === "resolved") && m.blocking && m.templateIds.includes(templateId));
}

/** Document types added to a package checklist by confirmed requirements (requirementId → items asking for it). */
export function memoryRequiredDocs(site: Site, templateId: string) {
  const map = new Map<string, MemoryItem[]>();
  for (const m of applicableItems(site, templateId)) if (m.kind === "requirement" && m.requirementId) map.set(m.requirementId, [...(map.get(m.requirementId) ?? []), m]);
  return map;
}

/** The earliest date a source asked for this (an "updated" revision must be uploaded after it). */
export const requestedAt = (m: MemoryItem) => m.sources.map((s) => s.sentAt).sort()[0] ?? m.createdAt;

export function memorySource(m: MemoryItem): IssueSource {
  const s = m.sources[0];
  return {
    kind: "project_memory",
    label: `${KIND_LABEL[m.kind]} confirmed by ${m.confirmedBy ?? "EQORE"} from ${s ? `${s.channel === "ahj_comment" ? "AHJ comment" : s.channel.replace("_", " ")} — ${s.sender}, ${s.sentAt.slice(0, 10)}` : "manual entry"}`,
    memoryItemId: m.id, communicationId: s?.communicationId, sender: s?.sender, sentAt: s?.sentAt, evidence: s?.evidence,
  };
}

export const KIND_LABEL: Record<MemoryItem["kind"], string> = { requirement: "Requirement", decision: "Decision", action_item: "Action item", question: "Open question" };

/** Non-blocking notices: AI suggestions that a human has not confirmed yet. */
export function memoryAdvisories(site: Site, templateId: string): Advisory[] {
  return memoryOf(site)
    .filter((m) => m.status === "suggested" && (m.templateIds.includes(templateId) || m.templateIds.length === 0))
    .map((m) => m.duplicateOfId
      ? { code: "POSSIBLE_DUPLICATE" as const, memoryItemId: m.id, message: `Possible duplicate of ${m.duplicateOfId}: “${m.title}” — confirm to merge or dismiss` }
      : { code: "UNCONFIRMED_SUGGESTION" as const, memoryItemId: m.id, message: `${m.origin === "openai" ? "AI" : "Rules"} suggestion awaiting confirmation (not blocking): “${m.title}”` });
}
