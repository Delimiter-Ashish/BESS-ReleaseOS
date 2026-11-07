import { NextResponse } from "next/server";
import { submitRevision } from "@/lib/store";

/** Step 2 of intake: file the revision as IN REVIEW and open a review task. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const b = await req.json();
  try {
    const out = submitRevision(params.id, {
      requirementId: b.requirementId,
      fileId: b.fileId,
      fileName: b.fileName,
      sha256: b.sha256,
      facts: b.facts ?? [],
      effectiveDate: b.effectiveDate,
      source: b.source,
      uploadedBy: b.uploadedBy,
      summary: b.summary,
      aiConfidence: b.aiConfidence,
      engine: b.engine,
      synthetic: b.synthetic,
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
