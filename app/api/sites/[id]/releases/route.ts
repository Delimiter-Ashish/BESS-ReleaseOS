import { NextResponse } from "next/server";
import { buildRelease } from "@/lib/store";

/** Build a version-locked release: { templateId, by, note, acknowledgeFlags } */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const b = await req.json();
  try {
    const release = buildRelease(params.id, b.templateId, b.by || "EQORE engineer", b.note, !!b.acknowledgeFlags);
    return NextResponse.json({ ok: true, release });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
