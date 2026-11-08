import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { handle, jsonBody } from "@/lib/http";
import { runPreflight } from "@/lib/guardian/preflight";
import { selectionFrom, studioCheck } from "@/lib/studio/check";
import type { StudioIssue } from "@/lib/studio/types";
import { bytesFor, getReleases, getSite, StoreError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verify a selection (read-only): release gate + selection + recipient authorization + Guardian preflight findings. */
export async function POST(req: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  return handle(async () => {
    requireCap(req, "memory");
    const site = getSite(params.id);
    if (!site) throw new StoreError(404, "site not found");
    const sel = selectionFrom(await jsonBody(req, 128 * 1024));
    let check;
    try { check = studioCheck(site, getReleases(site.id), sel, bytesFor); } catch (e) { throw new StoreError(400, (e as Error).message); }
    // Guardian preflight: evidence chains for blockers + non-blocking findings (consistency, changes since last release).
    const pf = await runPreflight(site, check.purpose.templateId, getReleases(site.id));
    const guardian: StudioIssue[] = pf.findings.filter((f) => !f.blocking && f.severity === "warning").map((f) => ({ code: "GUARDIAN_FINDING", severity: "warning", message: f.title, evidence: f.evidence.map((e) => e.quote).filter(Boolean).join(" ↔ ") || undefined, responsibleParty: f.responsibleRole, fix: f.nextAction }));
    return NextResponse.json({ ok: true, check: { ...check, warnings: [...check.warnings, ...guardian] }, preflight: { canBuild: pf.canBuild, findings: pf.findings.filter((f) => f.blocking || f.severity === "warning") } });
  });
}
