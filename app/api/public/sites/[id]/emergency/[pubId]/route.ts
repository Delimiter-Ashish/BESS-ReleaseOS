import { handle } from "@/lib/http";
import { getFile, getSite, findRevision, StoreError } from "@/lib/store";
import { latestApproved } from "@/lib/release";
import { sha256 } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public download of ONE explicitly published emergency document. Served only while the publication is active, the
 * revision is still the current approved one, and the stored bytes still hash to the published sha256.
 */
export async function GET(_req: Request, { params }: { params: { id: string; pubId: string } }) {
  return handle(() => {
    const site = getSite(params.id);
    const pub = site?.lifecycle?.publications.find((p) => p.id === params.pubId && p.status === "published");
    if (!site || !pub) throw new StoreError(404, "not published");
    const rev = findRevision(site, pub.revisionId);
    if (!rev || rev.status !== "approved" || latestApproved(site, rev.requirementId)?.id !== rev.id) throw new StoreError(410, "This information was superseded and is pending re-publication by EQORE");
    const file = rev.fileId ? getFile(rev.fileId) : undefined;
    if (!file || sha256(file.bytes) !== pub.sha256) throw new StoreError(410, "Published content could not be verified");
    return new Response(new Uint8Array(file.bytes), { headers: { "Content-Type": file.mediaType, "Content-Disposition": `inline; filename="${rev.fileName.replace(/[^\w.\- ]/g, "_")}"`, "X-Sha256": pub.sha256, "Cache-Control": "no-store" } });
  });
}
