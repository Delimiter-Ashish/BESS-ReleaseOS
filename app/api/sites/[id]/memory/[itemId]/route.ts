import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { asString, asStringArray, handle, jsonBody } from "@/lib/http";
import { confirmItem, dismissItem, resolveItem } from "@/lib/memory/register";
import { StoreError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * { action: "confirm", note, blocking?, templateIds?, requirementId?, responsibleParty?, dueDate?, requiresUpdatedRevision?, asNew? }
 * { action: "dismiss", note }
 * { action: "resolve", note, revisionId? }   (requirements: engineer only, checked against an approved revision)
 * Identity always comes from the session cookie.
 */
export async function POST(req: Request, { params: paramsPromise }: { params: Promise<{ id: string; itemId: string }> }) {
  const params = await paramsPromise;
  return handle(async () => {
    const session = requireCap(req, "memory");
    const b = await jsonBody(req);
    const action = asString(b.action, 20);
    const note = asString(b.note);
    if (action === "confirm") {
      return NextResponse.json({ ok: true, ...confirmItem(params.id, params.itemId, session, {
        note,
        blocking: typeof b.blocking === "boolean" ? b.blocking : undefined,
        templateIds: Array.isArray(b.templateIds) ? asStringArray(b.templateIds, 5) : undefined,
        requirementId: b.requirementId === null ? null : asString(b.requirementId, 60),
        responsibleParty: asString(b.responsibleParty, 120),
        dueDate: asString(b.dueDate, 10),
        requiresUpdatedRevision: typeof b.requiresUpdatedRevision === "boolean" ? b.requiresUpdatedRevision : undefined,
        asNew: b.asNew === true,
      }) });
    }
    if (action === "dismiss") return NextResponse.json({ ok: true, ...dismissItem(params.id, params.itemId, session, note) });
    if (action === "resolve") return NextResponse.json({ ok: true, ...resolveItem(params.id, params.itemId, session, { note, revisionId: asString(b.revisionId, 200) }) });
    throw new StoreError(400, "action must be confirm, dismiss or resolve");
  });
}
