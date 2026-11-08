import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { handle } from "@/lib/http";
import { policyTable, RECIPIENT_LABEL, RECIPIENTS } from "@/lib/studio/access";
import { availableDocuments, defaultGroups, PURPOSES, resolvePurpose } from "@/lib/studio/check";
import type { PurposeId } from "@/lib/studio/types";
import { PACKAGE_TEMPLATES } from "@/lib/requirements";
import { bytesFor, getSite, StoreError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Submission Studio data: ?purpose=ahj|planning|interconnection|custom[&templateId=&recipient=]. EQORE users only. */
export async function GET(req: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  return handle(() => {
    requireCap(req, "memory");
    const site = getSite(params.id);
    if (!site) throw new StoreError(404, "site not found");
    const u = new URL(req.url).searchParams;
    let purpose;
    try { purpose = resolvePurpose({ purpose: (u.get("purpose") ?? "ahj") as PurposeId, templateId: u.get("templateId") ?? undefined, recipient: (u.get("recipient") ?? undefined) as never }); }
    catch { throw new StoreError(400, "unknown submission purpose"); }
    return NextResponse.json({
      ok: true, purpose, purposes: PURPOSES,
      templates: PACKAGE_TEMPLATES.map((t) => ({ id: t.id, name: t.name })),
      recipients: RECIPIENTS.map((r) => ({ id: r, label: RECIPIENT_LABEL[r] })),
      documents: availableDocuments(site, purpose, bytesFor),
      defaultGroups: defaultGroups(site, purpose),
      policy: policyTable(site),
    });
  });
}
