import { AuthError, requireCap } from "@/lib/auth";
import { canReadFile } from "@/lib/studio/release-access";
import { handle } from "@/lib/http";
import { getFile, StoreError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Original uploaded bytes (signed-in roles only). Served as an attachment to avoid rendering untrusted content inline. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle(() => {
    const session = requireCap(req, "read_private");
    const f = getFile(params.id);
    if (!f) throw new StoreError(404, "file not found");
    // Access policy: internal documents are not readable by suppliers/authorities unless the policy allows it.
    if (!canReadFile(session, params.id)) throw new AuthError(403, `${session.name} is not authorized to view this document`);
    const inline = new URL(req.url).searchParams.get("inline") === "1" && f.mediaType === "application/pdf";
    return new Response(new Uint8Array(f.bytes), {
      headers: {
        "Content-Type": f.mediaType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.name.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "X-Sha256": f.sha256,
      },
    });
  });
}
