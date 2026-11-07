import JSZip from "jszip";
import { REQ_BY_ID } from "@/lib/requirements";
import { buildManifest } from "@/lib/release";
import { placeholderContent } from "@/lib/seed";
import { getFile, getRelease, getReleases, getSite } from "@/lib/store";

export const runtime = "nodejs";

/** Version-locked ZIP: pinned files + MANIFEST.json + INDEX.txt. ?format=json returns the manifest only. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const rel = getRelease(params.id);
  const site = rel && getSite(rel.siteId);
  if (!rel || !site) return new Response("not found", { status: 404 });
  const prev = getReleases(site.id).find((r) => r.templateId === rel.templateId && r.number === rel.number - 1);
  const manifest = buildManifest(site, rel, prev);
  if (new URL(req.url).searchParams.get("format") === "json") return Response.json(manifest);

  const zip = new JSZip();
  const lines = [`${manifest.package} — ${site.name} — R${rel.number}`, `Built ${rel.builtAt} by ${rel.builtBy}`, manifest.status, "", "INDEX"];
  rel.items.forEach((it, i) => {
    const rev = site.documents.find((d) => d.id === it.revisionId)!;
    const stored = rev.fileId ? getFile(rev.fileId) : undefined;
    const n = String(i + 1).padStart(2, "0");
    const name = stored ? `${n}_${it.fileName}` : `${n}_${it.fileName}.SYNTHETIC-PLACEHOLDER.txt`;
    zip.file(`documents/${name}`, stored ? stored.bytes : placeholderContent(rev));
    lines.push(`${n}. ${REQ_BY_ID[it.requirementId]?.name} — Rev ${it.revLabel} — ${it.fileName}`, `    sha256 ${it.sha256}`);
  });
  if (rel.openFlags.length) lines.push("", "ENGINEERING FLAGS (acknowledged)", ...rel.openFlags.map((f) => `- ${f}`));
  zip.file("MANIFEST.json", JSON.stringify(manifest, null, 2));
  zip.file("INDEX.txt", lines.join("\n"));
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${site.id}_${rel.templateId}_R${rel.number}.zip"` },
  });
}
