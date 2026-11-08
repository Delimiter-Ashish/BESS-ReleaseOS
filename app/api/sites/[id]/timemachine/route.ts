import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { handle } from "@/lib/http";
import { timeMachine } from "@/lib/guardian/timemachine";
import { getRelease, getSite, StoreError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Project Time Machine: GET ?releaseId= → frozen release vs current candidate state (read-only). EQORE users only. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle(() => {
    requireCap(req, "memory");
    const site = getSite(params.id);
    if (!site) throw new StoreError(404, "site not found");
    const rel = getRelease(new URL(req.url).searchParams.get("releaseId") ?? "");
    if (!rel || rel.siteId !== site.id || !rel.snapshot) throw new StoreError(404, "release not found");
    return NextResponse.json({ ok: true, report: timeMachine(site, rel) });
  });
}
