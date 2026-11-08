import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { asString, handle, jsonBody } from "@/lib/http";
import { resolveEngineeringTask } from "@/lib/store";

export const runtime = "nodejs";

/** Engineer resolves a dependency review by confirming the dependent document remains valid: { note }. */
export async function POST(req: Request, { params: paramsPromise }: { params: Promise<{ id: string; taskId: string }> }) {
  const params = await paramsPromise;
  return handle(async () => {
    const session = requireCap(req, "review");
    const b = await jsonBody(req);
    const out = resolveEngineeringTask(params.id, params.taskId, session, asString(b.note));
    return NextResponse.json({ ok: true, ...out });
  });
}
