import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { openaiExplain } from "@/lib/ai/openai";
import { extractDocument, selectedProvider } from "@/lib/extract";
import { beginUpload } from "@/lib/resource-limits";
import { handle, readBody } from "@/lib/http";
import { affectedDependents, compareFacts, materialChanges, ruleImpact } from "@/lib/intelligence";
import { LIMITS, readTextLayer, sniffMedia, UploadError } from "@/lib/pdf";
import { canViewRevision, audiencesOf, ruleFor } from "@/lib/studio/access";
import { latestApproved } from "@/lib/release";
import { REQ_BY_ID } from "@/lib/requirements";
import { getSite, putFile, saveExtraction, type ExtractionRecord } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Step 1 of intake: validate + store bytes (server-side sha256), read the text layer, run AI/rules extraction,
 * ground evidence, compare against the approved revision and preview dependency impacts. Nothing is filed yet.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const session = requireCap(req, "upload");
    const finish = beginUpload();
    try {
    const len = Number(req.headers.get("content-length") || 0);
    if (len > LIMITS.maxUploadBytes + 64 * 1024) throw new UploadError(413, `File exceeds ${LIMITS.maxUploadBytes / 1024 / 1024} MB limit`);
    const body = await readBody(req, LIMITS.maxUploadBytes + 64 * 1024);
    const form = await new Request(req.url, { method: "POST", headers: req.headers, body }).formData();
    const file = form.get("file");
    const site = getSite(String(form.get("siteId") ?? ""));
    if (!(file instanceof File) || !site) throw new UploadError(400, "file and valid siteId required");
    if (session.role === "supplier" && !(site.accessPolicy ?? []).some((r) => ruleFor(site, r.requirementId).view.some((a) => audiencesOf(session).includes(a)))) throw new UploadError(403, "This project is not shared with your role");
    if (file.size === 0) throw new UploadError(400, "Empty file");
    if (file.size > LIMITS.maxUploadBytes) throw new UploadError(413, `File exceeds ${LIMITS.maxUploadBytes / 1024 / 1024} MB limit`);
    const fileName = file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 160) || "upload";
    const bytes = Buffer.from(await file.arrayBuffer());
    const media = sniffMedia(bytes, fileName);
    if (!media) throw new UploadError(415, "Unsupported or mismatched file type. Upload a PDF, PNG, JPEG, WEBP or UTF-8 .txt file.");

    let layer;
    try {
      layer = await readTextLayer(media, bytes);
    } catch (e) {
      if (e instanceof UploadError) throw e;
      throw new UploadError(422, "Could not parse this PDF (corrupt or encrypted).");
    }
    const { fileId, sha256 } = putFile(fileName, media, bytes);
    const duplicateOf = site.documents.find((d) => d.sha256 === sha256 && canViewRevision(session, site, d));
    const siteFacts = `address ${site.address}; utility ${site.utility}; AHJ ${site.ahj}; system ${site.vendor}${site.inverter ? ` + ${site.inverter}` : ""}, ${site.powerKw} kW / ${site.energyKwh} kWh, ${site.chemistry}`;

    const t0 = Date.now();
    const result = await extractDocument({ fileName, media, bytes, layer, siteName: site.name, siteFacts });
    const extractMs = Date.now() - t0;

    // Deterministic comparison against the approved revision of the classified type.
    const baseline = result.requirementId !== "unknown" ? latestApproved(site, result.requirementId) : undefined;
    const prev = baseline && canViewRevision(session, site, baseline) ? baseline : undefined;
    const changes = prev ? compareFacts(prev.facts, result.facts) : [];
    const material = materialChanges(changes);
    const dependents = material.length ? affectedDependents(result.requirementId, material.map((c) => c.key)) : [];

    // Advisory explanations: OpenAI when it is the active provider and extraction succeeded, else rule text.
    const impacts: ExtractionRecord["impacts"] = {};
    let aiSummary: ExtractionRecord["aiSummary"];
    let explainError: string | undefined;
    for (const c of material) impacts[c.key] = { impact: ruleImpact(c.key), source: "rules" };
    if (material.length && result.provider === "openai" && !result.fallback) {
      try {
        const ex = await openaiExplain({ documentName: REQ_BY_ID[result.requirementId]?.name ?? result.requirementId, fromRev: prev?.revLabel, toRev: result.revisionLabel ?? "new", changes: material, dependents: dependents.map((d) => ({ id: d.id, name: d.name })) });
        aiSummary = { text: ex.summary, source: "openai" };
        for (const c of ex.changes) if (impacts[c.key]) impacts[c.key] = { impact: c.impact, source: "openai", suggested: c.suggestedRequirementIds };
      } catch (e) {
        explainError = `AI explanation unavailable (${(e as Error).message.slice(0, 120)}); rule-based notes shown.`;
      }
    }
    if (!aiSummary && material.length) aiSummary = { text: `${material.length} material change(s) detected by deterministic comparison: ${material.map((c) => `${c.label} ${c.before ?? "—"} → ${c.after ?? "—"}`).join("; ")}.`, source: "rules" };

    const rec = saveExtraction({ siteId: site.id, fileId, sha256, fileName, mediaType: media, textLayer: layer.joined, pageCount: layer.pageCount, result, impacts, aiSummary, createdBy: session.userId });
    const preview = changes.map((c) => (impacts[c.key] && c.significance === "material" ? { ...c, impact: impacts[c.key].impact, impactSource: impacts[c.key].source } : c));
    return NextResponse.json({
      ok: true,
      extractionId: rec.id,
      ...result,
      configuredProvider: selectedProvider(),
      fileId, sha256, fileName, mediaType: media, hasTextLayer: layer.hasText,
      duplicateOf: duplicateOf ? `Rev ${duplicateOf.revLabel} (${duplicateOf.fileName})` : null,
      previous: prev ? { revLabel: prev.revLabel, fileName: prev.fileName, id: prev.id } : null,
      diffPreview: preview,
      dependentsPreview: dependents.map((d) => ({ id: d.id, name: d.name, onFile: site.documents.some((r) => r.requirementId === d.id && r.status === "approved" && canViewRevision(session, site, r)) })),
      aiSummary, explainError,
      ms: Date.now() - t0, extractMs,
    });
    } finally { finish(); }
  });
}
