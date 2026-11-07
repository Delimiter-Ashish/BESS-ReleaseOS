import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { asString, handle, jsonBody } from "@/lib/http";
import { submitRevision } from "@/lib/store";
import type { Revision } from "@/lib/types";

export const runtime = "nodejs";

/** Step 2 of intake: file the server-side extraction as a revision IN REVIEW. Client hashes/facts are never accepted. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const session = requireCap(req, "upload");
    const b = await jsonBody(req);
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
