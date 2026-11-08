import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { asString, asStringArray, handle, jsonBody } from "@/lib/http";
import { decideReview, StoreError } from "@/lib/store";

export const runtime = "nodejs";

/** Engineer decision: { decision: "approve" | "reject", note, resolveTaskIds? }. Reviewer identity comes from the signed session only. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const session = requireCap(req, "review");
    const b = await jsonBody(req);
    if (b.decision !== "approve" && b.decision !== "reject") throw new StoreError(400, "decision must be approve or reject");
    const out = decideReview(params.id, b.decision, session, asString(b.note), asStringArray(b.resolveTaskIds));
    const { textLayer: _t, ...revision } = out.revision;
    void _t;
    // consistency: Project Guardian result of re-checking the approved document set (created / attached / superseded review tasks)
    return NextResponse.json({ ok: true, task: out.task, revision, decision: out.decision, consistency: out.consistency ? { created: out.consistency.created.map((t) => t.id), attached: out.consistency.attached, superseded: out.consistency.superseded } : undefined });
  });
}
