import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { handle } from "@/lib/http";
import { compareSnapshots } from "@/lib/release";
import { getRelease, StoreError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Compare two historical releases from their frozen snapshots: ?from=R1id&to=R2id */
export async function GET(req: Request) {
  return handle(() => {
    requireCap(req, "read_private");
    const u = new URL(req.url);
    const a = getRelease(u.searchParams.get("from") ?? ""), b = getRelease(u.searchParams.get("to") ?? "");
    if (!a || !b) throw new StoreError(404, "release not found");
    if (a.siteId !== b.siteId || a.templateId !== b.templateId) throw new StoreError(400, "Compare releases of the same site and package");
    return NextResponse.json({ ok: true, from: a.id, to: b.id, ...compareSnapshots(a, b) });
  });
}
