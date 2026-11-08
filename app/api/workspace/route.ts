import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { handle } from "@/lib/http";
import { findings, readiness, reviewQueue, todayMetrics } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * READ-ONLY projection of the store used by the Project Assurance screens (same functions the pages render from).
 * ?readiness=SITE:TEMPLATE adds one readiness view. No mutations here — all writes go through the existing APIs.
 */
export async function GET(req: Request) {
  return handle(() => {
    const s = requireCap(req, "read_private");
    const m = todayMetrics();
    const q = reviewQueue(s);
    const f = findings(s);
    const rd = new URL(req.url).searchParams.get("readiness");
    const [site, tpl] = rd?.split(":") ?? [];
    return NextResponse.json({
      ok: true,
      metrics: { activeProjects: m.activeProjects, documentsReceived: m.documentsReceived, liveUploads: m.liveUploads, pendingReviews: m.pendingReviews, openDependencies: m.openDependencies, blockedSubmissions: m.blockedSubmissions.length },
      projects: m.projects,
      reviews: q.map(({ evidenceNew, evidencePrev, ...r }) => ({ ...r, evidence: [evidenceNew, evidencePrev].filter(Boolean).map((e) => ({ revisionId: e!.revisionId, fileId: e!.fileId, page: e!.page, quote: e!.quote })) })),
      findings: f.map(({ evidence, ...x }) => ({ ...x, evidenceCount: evidence.length })),
      readiness: site && tpl ? readiness(site, tpl) ?? null : undefined,
    });
  });
}
