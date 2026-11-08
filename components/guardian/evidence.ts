// Maps Guardian evidence references (lib/guardian/types.ts EvidenceRef) onto the shared evidence drawer's refs.
// Documents resolve to the revision's real stored file; communications to the stored verbatim text.
// Anything without an original (task, checklist, release) is NOT turned into a fake document.
import type { EvidenceRef as GuardianRef, PreflightFinding } from "@/lib/guardian/types";
import type { EvidenceRef } from "@/lib/workspace";

export type RevisionEvidence = Record<string, EvidenceRef>;

export function toDrawerRef(g: GuardianRef, site: { id: string; name: string }, byRev: RevisionEvidence): EvidenceRef | undefined {
  if (g.kind === "document") {
    const base = byRev[g.sourceId];
    if (!base) return undefined;
    return { ...base, key: `${base.key}|${g.quote ?? ""}|${g.page ?? ""}`, page: g.page ?? base.page, quote: g.quote ?? base.quote, factLabel: g.label, factValue: undefined };
  }
  if (g.kind === "communication") {
    return {
      key: `com:${g.sourceId}:${g.quote ?? ""}`, projectId: site.id, projectName: site.name, docName: "Communication", fileName: g.label, mediaType: "text/plain",
      quote: g.quote, provenance: g.verified ? "Stored original · quote verified" : "Stored original · quote NOT verified — check before relying on it",
      communication: { siteId: site.id, id: g.sourceId, verified: g.verified },
    };
  }
  return undefined;
}

/** All drawer-openable evidence for one finding: quoted sources first, then affected files. */
export function findingEvidence(f: PreflightFinding, site: { id: string; name: string }, byRev: RevisionEvidence): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  const seen = new Set<string>();
  for (const e of f.evidence) {
    const r = toDrawerRef(e, site, byRev);
    if (r && !seen.has(r.key)) { seen.add(r.key); out.push(r); }
  }
  for (const a of f.affectedFiles) {
    const r = byRev[a.revisionId];
    if (r && !out.some((x) => x.revisionId === a.revisionId)) out.push(r);
  }
  return out;
}

export const CATEGORY_LABEL: Record<PreflightFinding["category"], string> = {
  missing_document: "Missing document", outdated_revision: "Outdated revision", pending_review: "Pending engineer review", dependency: "Engineering dependency",
  consistency: "Cross-document conflict", requirement: "Requirement (Project Memory)", action: "Open action", question: "Open question", decision: "Open decision",
  change_since_release: "Changed since last release",
};
