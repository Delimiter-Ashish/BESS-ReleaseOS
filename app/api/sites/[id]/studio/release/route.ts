import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { asString, handle, jsonBody } from "@/lib/http";
import { selectionFrom } from "@/lib/studio/check";
import { generateStudioRelease } from "@/lib/studio/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Engineer signoff → combined PDF(s) + sealed release: { purpose, templateId?, recipient?, groups, note, token }.
 * Re-verified before generation and again (synchronously, by token) before the release is sealed.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const session = requireCap(req, "release");
    const b = await jsonBody(req, 128 * 1024);
    const { release, outputs } = await generateStudioRelease(params.id, selectionFrom(b), session, asString(b.note), asString(b.token, 128));
    const { snapshot, ...rest } = release;
    return NextResponse.json({ ok: true, release: { ...rest, snapshotSha256: snapshot?.sha256 }, outputs: outputs.map(({ fileId: _f, ...o }) => { void _f; return { ...o, href: `/api/releases/${encodeURIComponent(release.id)}/pdf?output=${encodeURIComponent(o.groupId)}` }; }) });
  });
}
