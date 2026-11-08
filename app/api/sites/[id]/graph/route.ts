import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { handle } from "@/lib/http";
import { findConsistency } from "@/lib/guardian/consistency";
import { buildEvidenceGraph, neighborhood } from "@/lib/guardian/graph";
import { getReleases, getSite, StoreError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cross-source evidence graph: GET [?focus=<nodeId>&depth=2]. EQORE users only. */
export async function GET(req: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  return handle(() => {
    requireCap(req, "memory");
    const site = getSite(params.id);
    if (!site) throw new StoreError(404, "site not found");
    const g = buildEvidenceGraph(site, getReleases(site.id), findConsistency(site, { view: "candidate" }).findings);
    const u = new URL(req.url);
    const focus = u.searchParams.get("focus");
    const graph = focus ? neighborhood(g, focus, Math.min(4, Number(u.searchParams.get("depth") ?? 2) || 2)) : g;
    return NextResponse.json({ ok: true, graph });
  });
}
