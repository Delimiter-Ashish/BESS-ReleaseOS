import { NextResponse } from "next/server";
import { handle } from "@/lib/http";
import { publicEmergency } from "@/lib/lifecycle/ops";
import { StoreError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public (QR) — ONLY emergency information an engineer explicitly published. No contacts, notes, or internal records. */
export async function GET(_req: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  return handle(() => {
    const data = publicEmergency(params.id);
    if (!data) throw new StoreError(404, "site not found");
    return NextResponse.json({ ok: true, ...data, notice: "Published emergency information only. Not a substitute for on-site signage or incident command." });
  });
}
