import { NextResponse } from "next/server";
import { AuthError, requireCap } from "@/lib/auth";
import { handle } from "@/lib/http";
import { affectedDependents, compareFacts, materialChanges, ruleImpact } from "@/lib/intelligence";
import { canViewRevision, audiencesOf, ruleFor } from "@/lib/studio/access";
import { latestApproved } from "@/lib/release";
import { REQ_BY_ID } from "@/lib/requirements";
import { getExtraction, getSite, StoreError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-run the deterministic comparison when the user corrects the document type. ?requirementId=... */
export async function GET(req: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  return handle(() => {
    const session = requireCap(req, "upload");
    const ex = getExtraction(params.id);
    if (!ex || ex.createdBy !== session.userId) throw new StoreError(404, "extraction not found");
    const rid = new URL(req.url).searchParams.get("requirementId") ?? "";
    if (!REQ_BY_ID[rid]) throw new StoreError(400, "unknown document type");
    const site = getSite(ex.siteId)!;
    const prev = latestApproved(site, rid);
    if (prev ? !canViewRevision(session, site, prev) : !ruleFor(site, rid).view.some((a) => audiencesOf(session).includes(a))) throw new AuthError(403, "Not authorized to compare this document type");
    const changes = prev ? compareFacts(prev.facts, ex.result.facts) : [];
    const material = materialChanges(changes);
    const preview = changes.map((c) => (c.significance === "material" ? { ...c, impact: (rid === ex.result.requirementId && ex.impacts[c.key]?.impact) || ruleImpact(c.key), impactSource: rid === ex.result.requirementId && ex.impacts[c.key] ? ex.impacts[c.key].source : "rules" } : c));
    const deps = material.length ? affectedDependents(rid, material.map((c) => c.key)) : [];
    return NextResponse.json({
      ok: true,
      previous: prev ? { revLabel: prev.revLabel, fileName: prev.fileName, id: prev.id } : null,
      diffPreview: preview,
      dependentsPreview: deps.map((d) => ({ id: d.id, name: d.name, onFile: site.documents.some((r) => r.requirementId === d.id && r.status === "approved" && canViewRevision(session, site, r)) })),
    });
  });
}
