import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { asString, handle, jsonBody } from "@/lib/http";
import { runPreflight } from "@/lib/guardian/preflight";
import { TEMPLATE_BY_ID } from "@/lib/requirements";
import { getReleases, getSite, StoreError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Run Preflight (read-only): { templateId, ai?: boolean } → PreflightReport.
 * Blocking findings are exactly the release gate; AI reviews (ai=true) are advisory and never change gating.
 * EQORE users only (the report quotes internal communications).
 */
export async function POST(req: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  return handle(async () => {
    requireCap(req, "memory");
    const site = getSite(params.id);
    if (!site) throw new StoreError(404, "site not found");
    const b = await jsonBody(req);
    const templateId = asString(b.templateId, 60) ?? "";
    if (!TEMPLATE_BY_ID[templateId]) throw new StoreError(400, "unknown package template");
    const report = await runPreflight(site, templateId, getReleases(site.id), { ai: b.ai === true });
    return NextResponse.json({ ok: true, report });
  });
}
