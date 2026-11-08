// Pre-submission check: the readiness gate presented as "what are we forgetting?" (pure, no I/O).
import { packageReadiness } from "../release";
import { TEMPLATE_BY_ID } from "../requirements";
import type { Site } from "../types";
import { CATEGORY_OF, type BlockerCategory, type PreSubmissionReport } from "./types";

const CATS: BlockerCategory[] = ["missing_document", "outdated_revision", "pending_review", "dependency", "consistency", "requirement", "action", "question", "decision"];

export function preSubmissionReport(site: Site, templateId: string, opts: { redactEvidence?: boolean } = {}): PreSubmissionReport | undefined {
  const t = TEMPLATE_BY_ID[templateId];
  if (!t) return undefined;
  const r = packageReadiness(site, t);
  const blockers = r.issues.map((i) => ({ ...i, category: CATEGORY_OF[i.code], ...(opts.redactEvidence && i.source ? { source: { ...i.source, evidence: undefined } } : {}) }));
  const counts = Object.fromEntries(CATS.map((c) => [c, blockers.filter((b) => b.category === c).length])) as Record<BlockerCategory, number>;
  return {
    siteId: site.id, templateId: t.id, templateName: t.name, audience: t.audience, checkedAt: new Date().toISOString(),
    canBuild: r.canBuild, token: r.token, blockers, advisories: r.advisories,
    counts: { ...counts, blockers: blockers.length, advisories: r.advisories.length },
    checklist: r.items.map((i) => ({ requirementId: i.requirementId, name: i.name, state: i.state, approvedRevision: i.approved?.revLabel, pendingRevision: i.pending?.revLabel, requiredBy: t.required.includes(i.requirementId) ? "package_template" : "project_memory", memoryItemIds: i.requiredBy })),
  };
}
