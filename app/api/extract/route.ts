import { NextResponse } from "next/server";
import { extractDocument } from "@/lib/extract";
import { diffFacts, latestApproved } from "@/lib/release";
import { getSite, putFile } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Step 1 of intake: store bytes (sha256), AI/rules extraction, preview diff vs approved revision. Nothing is filed yet. */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const site = getSite(String(form.get("siteId") ?? ""));
  if (!file || !site) return NextResponse.json({ error: "file and valid siteId required" }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const lower = file.name.toLowerCase();
  const mediaType =
    file.type ||
    (lower.endsWith(".pdf") ? "application/pdf" : lower.match(/\.(png|jpe?g|webp)$/) ? `image/${lower.split(".").pop()!.replace("jpg", "jpeg")}` : "text/plain");
  const { fileId, sha256 } = putFile(file.name, mediaType, bytes);
  const duplicateOf = site.documents.find((d) => d.sha256 === sha256);
  const siteFacts = `address ${site.address}; utility ${site.utility}; AHJ ${site.ahj}; system ${site.vendor}${site.inverter ? ` + ${site.inverter}` : ""}, ${site.powerKw} kW / ${site.energyKwh} kWh, ${site.chemistry}`;

  const t0 = Date.now();
  try {
    const result = await extractDocument({ fileName: file.name, mediaType, bytes, siteName: site.name, siteFacts });
    const prev = latestApproved(site, result.requirementId);
    return NextResponse.json({
      ...result,
      fileId,
      sha256,
      fileName: file.name,
      duplicateOf: duplicateOf ? `Rev ${duplicateOf.revLabel} (${duplicateOf.fileName})` : null,
      previous: prev ? { revLabel: prev.revLabel, fileName: prev.fileName } : null,
      diffPreview: diffFacts(prev?.facts, result.facts),
      ms: Date.now() - t0,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
