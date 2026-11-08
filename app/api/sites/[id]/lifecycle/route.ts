import { NextResponse } from "next/server";
import { AuthError, sessionFromRequest } from "@/lib/auth";
import { handle, jsonBody } from "@/lib/http";
import { clockMode, clockNow, localDate, parseAsOf } from "@/lib/lifecycle/clock";
import { lifecycleAction, siteAndLifecycle } from "@/lib/lifecycle/ops";
import { lifecycleView } from "@/lib/lifecycle/status";
import type { LifecycleAction } from "@/lib/lifecycle/types";
import { persist, StoreError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS: LifecycleAction["action"][] = ["set_stage", "settings", "add_obligation", "set_due", "propose_change", "confirm_change", "dismiss_change", "resolve_impact", "record_event", "verify_completion", "publish_emergency", "withdraw_emergency"];

/**
 * GET /api/sites/:id/lifecycle[?asOf=YYYY-MM-DD|ISO] → { ok, lifecycle: LifecycleView }
 * Signed-in users only. EQORE sees everything; facility / AHJ / supplier see only obligations whose document type the
 * access policy lets them view, without internal notes, change records or evidence quotes. asOf is read-only.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle(() => {
    const s = sessionFromRequest(req);
    if (s.role === "public") throw new AuthError(401, "Sign in required");
    const { site, lc, created } = siteAndLifecycle(params.id);
    if (created) persist();
    const raw = new URL(req.url).searchParams.get("asOf");
    const asOf = raw ? parseAsOf(raw, lc.timezone) : localDate(clockNow(), lc.timezone);
    if (!asOf) throw new StoreError(400, "asOf must be YYYY-MM-DD or an ISO date-time");
    return NextResponse.json({ ok: true, lifecycle: lifecycleView(site, lc, asOf, clockMode(), s) });
  });
}

/** POST /api/sites/:id/lifecycle  body: LifecycleAction (lib/lifecycle/types.ts). Role checks are server-side per action. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const s = sessionFromRequest(req);
    if (s.role === "public") throw new AuthError(401, "Sign in required");
    const body = await jsonBody(req);
    if (!ACTIONS.includes(body.action as LifecycleAction["action"])) throw new StoreError(400, `action must be one of ${ACTIONS.join(", ")}`);
    const result = await lifecycleAction(params.id, body as unknown as LifecycleAction, s);
    const { site, lc } = siteAndLifecycle(params.id);
    return NextResponse.json({ ok: true, ...result, lifecycle: lifecycleView(site, lc, localDate(clockNow(), lc.timezone), clockMode(), s) });
  });
}
