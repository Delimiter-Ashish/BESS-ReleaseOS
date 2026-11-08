import { verifyReleaseSnapshot } from "@releaseos/release-core";
import { requireCap } from "@/lib/auth";
import { handle } from "@/lib/http";
import { canDownloadRelease } from "@/lib/studio/release-access";
import { getFile, getRelease, StoreError, studioOf } from "@/lib/store";
import { AuthError } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Frozen combined PDF of a Submission Studio release: ?output=<groupId>. Integrity-checked; access-policy enforced. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle(() => {
    const session = requireCap(req, "read_private");
    const rel = getRelease(params.id);
    const st = rel && studioOf(rel);
    if (!rel?.snapshot || !st) throw new StoreError(404, "studio release not found");
    if (!canDownloadRelease(session, rel)) throw new AuthError(403, `${session.name} is not authorized to receive this package`);
    if (!verifyReleaseSnapshot(rel.snapshot)) throw new StoreError(500, "Release snapshot failed integrity verification");
    const id = new URL(req.url).searchParams.get("output") ?? st.outputs[0]?.groupId;
    const o = st.outputs.find((x) => x.groupId === id);
    if (!o) throw new StoreError(404, "output not found");
    const f = getFile(o.fileId);
    if (!f || f.sha256 !== o.sha256) throw new StoreError(500, "Combined PDF does not match its frozen sha256");
    return new Response(new Uint8Array(f.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${o.fileName}"`, "X-Sha256": o.sha256, "X-Page-Count": String(o.pageCount), "X-Release-Snapshot-Sha256": rel.snapshot.sha256, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
  });
}
