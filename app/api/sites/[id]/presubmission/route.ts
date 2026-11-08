import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { handle } from "@/lib/http";
import { preSubmissionReport } from "@/lib/memory/presubmission";
import { PACKAGE_TEMPLATES } from "@/lib/requirements";
import { getSite, StoreError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pre-submission check for one package (?templateId=) or all packages. Evidence quotes are shown to EQORE users only. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle(() => {
    const session = requireCap(req, "memory"); // derived from internal correspondence: EQORE only
    const site = getSite(params.id);
    if (!site) throw new StoreError(404, "site not found");
    const tid = new URL(req.url).searchParams.get("templateId");
    const redactEvidence = session.role !== "eqore";
    if (tid) {
      const report = preSubmissionReport(site, tid, { redactEvidence });
      if (!report) throw new StoreError(404, "unknown package");
      return NextResponse.json({ ok: true, report });
    }
    return NextResponse.json({ ok: true, reports: PACKAGE_TEMPLATES.map((t) => preSubmissionReport(site, t.id, { redactEvidence })!) });
  });
}
