import { NextResponse } from "next/server";
import { decideReview } from "@/lib/store";

/** Engineer decision on a review task: { decision: "approve" | "reject", by, note } */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const b = await req.json();
  try {
    const out = decideReview(params.id, b.decision, b.by || "EQORE engineer", b.note);
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
