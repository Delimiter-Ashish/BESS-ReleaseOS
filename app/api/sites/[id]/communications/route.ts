import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { asString, asStringArray, handle, jsonBody } from "@/lib/http";
import { analyzeCommunication } from "@/lib/memory/analyze";
import { parseEmailHeaders } from "@/lib/memory/email";
import { findDuplicateCommunication, getMemory, recordCommunication, validateImport } from "@/lib/memory/register";
import type { CommunicationChannel } from "@/lib/memory/types";
import { getSite, StoreError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Imported communications for a site (EQORE only: internal correspondence). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle(() => {
    requireCap(req, "memory");
    return NextResponse.json({ ok: true, communications: getMemory(params.id).communications });
  });
}

/**
 * Import a pasted/uploaded communication: { body, channel?, sender?, sentAt?, subject?, recipients?, senderOrg? }.
 * Missing sender/date/subject are read from the email's own header block. The original text is stored verbatim.
 * Re-importing the same text returns the existing record (duplicate: true) without a second AI call.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const session = requireCap(req, "memory");
    const site = getSite(params.id);
    if (!site) throw new StoreError(404, "site not found");
    const b = await jsonBody(req, 256 * 1024);
    const body = asString(b.body, 60_000) ?? "";
    const h = parseEmailHeaders(body);
    const input = validateImport({
      body, channel: asString(b.channel, 30) as CommunicationChannel,
      sender: asString(b.sender, 200) || h.from, senderOrg: asString(b.senderOrg, 200),
      sentAt: asString(b.sentAt, 60) || h.date, subject: asString(b.subject, 300) || h.subject,
      recipients: asStringArray(b.recipients).length ? asStringArray(b.recipients) : h.to,
    });
    const dup = findDuplicateCommunication(params.id, input.body);
    if (dup) return NextResponse.json({ ok: true, duplicate: true, communication: dup, items: (site.memory ?? []).filter((m) => dup.itemIds.includes(m.id)) });
    const analysis = await analyzeCommunication(input.body, { siteName: site.name, siteAhj: site.ahj, utility: site.utility, channel: input.channel, sender: input.sender, sentAt: input.sentAt, subject: input.subject });
    const res = recordCommunication(params.id, input, analysis, session);
    return NextResponse.json({ ok: true, ...res });
  });
}
