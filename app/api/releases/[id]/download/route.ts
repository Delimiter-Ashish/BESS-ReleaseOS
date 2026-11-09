import { NextResponse } from "next/server";
import { AuthError, requireCap } from "@/lib/auth";
import { canDownloadRelease } from "@/lib/studio/release-access";
import { handle } from "@/lib/http";
import { getRelease, releaseZip, StoreError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Frozen release download. Everything comes from the sealed snapshot captured at build time.
 *   (default)        ZIP: documents + manifest.json + snapshot.json (release-core) + MANIFEST.json + INDEX.txt
 *   ?format=json     frozen human-readable manifest
 *   ?format=snapshot sealed snapshot metadata (document bytes omitted)
 */
export async function GET(req: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  return handle(() => {
    const session = requireCap(req, "read_private");
    const rel = getRelease(params.id);
    if (!rel?.snapshot) throw new StoreError(404, "release not found");
    // Access policy: EQORE, or the external recipient of a studio package whose documents were all authorized for it.
    if (!canDownloadRelease(session, rel)) throw new AuthError(403, `${session.name} is not authorized to download this release`);
    const format = new URL(req.url).searchParams.get("format");
    if (format === "json") return NextResponse.json(rel.snapshot.annotations?.manifest ?? {});
    if (format === "snapshot") return NextResponse.json({ ...rel.snapshot, documents: rel.snapshot.documents.map(({ contentBase64: _c, text: _t, ...d }) => { void _c; void _t; return d; }) });
    const zip = releaseZip(rel.id);
    return new Response(Buffer.from(zip.bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zip.fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "X-Release-Snapshot-Sha256": rel.snapshot.sha256,
        "X-Zip-Sha256": zip.sha256,
        "Cache-Control": "no-store",
      },
    });
  });
}
