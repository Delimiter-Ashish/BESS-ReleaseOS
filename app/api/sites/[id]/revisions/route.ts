import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { asString, handle, jsonBody } from "@/lib/http";
import { getSite, StoreError, submitRevision } from "@/lib/store";
import { ruleFor } from "@/lib/studio/access";
import type { Revision } from "@/lib/types";

export const runtime = "nodejs";

/** Step 2 of intake: file the server-side extraction as a revision IN REVIEW. Client hashes/facts are never accepted. */
export async function POST(req: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  return handle(async () => {
    const session = requireCap(req, "upload");
    const b = await jsonBody(req);
    // Suppliers may only file document types the site's access policy shares with suppliers (server-enforced).
    const site = getSite(params.id);
    const rid = asString(b.requirementId, 60) ?? "";
    if (session.role === "supplier" && site && !ruleFor(site, rid).view.includes("supplier")) throw new StoreError(403, `${session.name} may not file ${rid || "this document type"} for this project`);
    const out = submitRevision(params.id, {
      extractionId: asString(b.extractionId, 80) ?? "",
      requirementId: asString(b.requirementId, 60) ?? "",
      effectiveDate: asString(b.effectiveDate, 10),
      source: asString(b.source, 20) as Revision["source"] | undefined,
    }, session);
    const { textLayer: _t, ...revision } = out.revision;
    void _t;
    return NextResponse.json({ ok: true, revision, review: out.review, engineeringTasks: out.engineeringTasks });
  });
}
