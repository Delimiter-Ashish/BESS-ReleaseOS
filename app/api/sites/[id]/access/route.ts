import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { asString, asStringArray, handle, jsonBody } from "@/lib/http";
import { AUDIENCE_LABEL, AUDIENCES, policyTable, RECIPIENT_LABEL, RECIPIENTS } from "@/lib/studio/access";
import { getSite, setAccessRule, StoreError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Document access policy (EQORE only): GET table; POST { requirementId, view[], releaseTo[], note } records a new rule. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle(() => {
    requireCap(req, "memory");
    const site = getSite(params.id);
    if (!site) throw new StoreError(404, "site not found");
    return NextResponse.json({ ok: true, policy: policyTable(site), audiences: AUDIENCES.map((a) => ({ id: a, label: AUDIENCE_LABEL[a] })), recipients: RECIPIENTS.map((r) => ({ id: r, label: RECIPIENT_LABEL[r] })) });
  });
}
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const session = requireCap(req, "memory");
    const b = await jsonBody(req);
    const rule = setAccessRule(params.id, { requirementId: asString(b.requirementId, 60), view: asStringArray(b.view), releaseTo: asStringArray(b.releaseTo), note: asString(b.note) }, session);
    return NextResponse.json({ ok: true, rule });
  });
}
