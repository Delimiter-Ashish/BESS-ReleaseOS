// ===== AI layer (owner: Kaushik) =====
// Two engines behind one interface:
//  - "ai": multimodal (PDF + scanned images) via OpenAI API, if OPENAI_API_KEY is set
//  - "rules": deterministic text + regex fallback (works offline; text PDFs / .txt only)
// Both return canonical Facts so revisions can be diffed.
import { REQUIREMENTS } from "./requirements";
import type { Fact } from "./types";

export const FACT_KEYS: Record<string, string> = {
  "equipment.model": "Model",
  "rating.current_a": "Rated current (A)",
  "rating.voltage_v": "Rated voltage (V)",
  "rating.interrupting_ka": "Interrupting rating (kA)",
  "rating.power_kw": "Power (kW)",
  "rating.energy_kwh": "Energy (kWh)",
  chemistry: "Battery chemistry",
  "revision.label": "Revision",
  "doc.date": "Document date",
  "meter.serial": "Revenue meter serial",
  "pole.number": "Utility pole number",
  "permit.number": "Permit number",
  "listing.standard": "Listing standard (UL)",
  "site.address": "Site address",
  "utility.account": "Utility account",
};

export interface ExtractionResult {
  requirementId: string;
  docTypeConfidence: number;
  title: string;
  effectiveDate?: string;
  revisionLabel?: string;
  summary: string;
  facts: Fact[];
  missingItems: string[];
  warnings: string[];
  engine: "ai" | "rules";
  textChars?: number;
}

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

function prompt(siteName: string, siteFacts: string) {
  const catalog = REQUIREMENTS.map((r) => `- ${r.id}: ${r.name} [${r.codeRef}] — must include: ${r.mustInclude}`).join("\n");
  const keys = Object.entries(FACT_KEYS).map(([k, v]) => `${k} (${v})`).join(", ");
  return `You are a document controller for commercial battery energy storage (BESS) projects.
A document was uploaded for site "${siteName}". Known site facts: ${siteFacts}

1) Classify it into exactly one document type id (or "unknown"):
${catalog}

2) Extract facts using ONLY these canonical keys where they apply: ${keys}.
Normalize numbers: value is the bare number, unit separate ("600" + "A"). For EVERY fact give a short VERBATIM evidence quote (max 12 words) and page number. Confidence 0..1, lower for blurry/handwritten/ambiguous. NEVER invent a value that is not in the document — omit it instead.

3) missingItems: required content (per "must include") that the document lacks.
4) warnings: conflicts with the known site facts, wrong site, unsigned, illegible parts, superseded markings.

Respond with ONLY JSON:
{"requirementId": string, "docTypeConfidence": number, "title": string, "effectiveDate": "YYYY-MM-DD"|null, "revisionLabel": string|null,
 "summary": string, "facts": [{"key": string, "label": string, "value": string, "unit": string|null, "evidence": string, "page": number, "confidence": number}],
 "missingItems": string[], "warnings": string[]}`;
}

export async function extractDocument(opts: { fileName: string; mediaType: string; bytes: Buffer; siteName: string; siteFacts: string }): Promise<ExtractionResult> {
  const text = await getText(opts.fileName, opts.mediaType, opts.bytes);
  if (!process.env.OPENAI_API_KEY) return rulesExtract(opts.fileName, text);

  // Build the user message. Text PDFs / txt: send extracted text (fast, cheap, reliable).
  // Scanned PDFs and images: send the file itself so the vision model can read it.
  type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } } | { type: "file"; file: { filename: string; file_data: string } };
  const content: Part[] = [];
  const b64 = opts.bytes.toString("base64");
  if (text && text.trim().length > 40) content.push({ type: "text", text: `Document text (${opts.fileName}):\n${text}` });
  else if (opts.mediaType === "application/pdf") content.push({ type: "file", file: { filename: opts.fileName, file_data: `data:application/pdf;base64,${b64}` } });
  else if (opts.mediaType.startsWith("image/")) content.push({ type: "image_url", image_url: { url: `data:${opts.mediaType};base64,${b64}` } });
  else content.push({ type: "text", text: `Document text (${opts.fileName}):\n${text ?? ""}` });
  content.push({ type: "text", text: prompt(opts.siteName, opts.siteFacts) });

  // Never crash the demo: on any network/API/parse failure fall back to the offline engine and say why.
  const fallback = (why: string) => {
    const r = rulesExtract(opts.fileName, text);
    r.warnings.unshift(`OpenAI call failed (${why}); used offline rules engine instead.`);
    return r;
  };
  let p;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: MODEL, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "user", content }] }),
    });
    if (!res.ok) return fallback(`HTTP ${res.status}`);
    const data = await res.json();
    const out: string = data.choices?.[0]?.message?.content ?? "{}";
    p = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  } catch (e) {
    return fallback(e instanceof Error ? e.message : "network error");
  }
  return {
    requirementId: p.requirementId ?? "unknown",
    docTypeConfidence: Number(p.docTypeConfidence ?? 0.5),
    title: p.title ?? opts.fileName,
    effectiveDate: p.effectiveDate ?? undefined,
    revisionLabel: p.revisionLabel ?? undefined,
    summary: p.summary ?? "",
    facts: (Array.isArray(p.facts) ? p.facts : []).map((f: Fact) => ({ ...f, label: f.label || FACT_KEYS[f.key] || f.key, unit: f.unit ?? undefined, confidence: Number(f.confidence ?? 0.5) })),
    missingItems: Array.isArray(p.missingItems) ? p.missingItems : [],
    warnings: Array.isArray(p.warnings) ? p.warnings : [],
    engine: "ai",
    textChars: text?.length,
  };
}

async function getText(fileName: string, mediaType: string, bytes: Buffer): Promise<string | undefined> {
  if (mediaType.startsWith("text/") || /\.(txt|md|csv|json)$/i.test(fileName)) return bytes.toString("utf8");
  if (mediaType === "application/pdf") {
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractText(pdf, { mergePages: false });
      return (text as string[]).map((t, i) => `\f[page ${i + 1}]\n${t}`).join("\n");
    } catch {
      return undefined;
    }
  }
  return undefined; // images: no text layer → needs the vision model
}

// ---------- Deterministic rules engine ----------
const TYPE_RULES: [string, RegExp][] = [
  ["switchgear_datasheet", /switchgear|ac disconnect|disconnect switch/i],
  ["ul9540a_report", /9540a/i],
  ["ul9540_listing", /ul\s*9540(?!a)/i],
  ["inverter_datasheet", /inverter|pcs|mps125/i],
  ["plan_set", /plan set|sheet index|ess-1\.0|engineer of record/i],
  ["battery_datasheet", /battery|bess datasheet|kwh/i],
  ["sds", /safety data sheet|\bsds\b/i],
  ["cx_report", /commission\w*.*report/i],
  ["cx_plan", /commission\w*.*plan/i],
  ["eop", /emergency operations plan/i],
  ["om_manual", /operations and maintenance|o&m manual/i],
  ["ops_record", /service log|maintenance log|operations record/i],
  ["pto", /permission to operate/i],
  ["permit_fire", /fire (department )?permit/i],
  ["permit_electrical", /electrical permit/i],
  ["permit_building", /building permit/i],
  ["ix_application", /interconnection application/i],
  ["utility_bill", /eversource|national grid|amount due|billing/i],
  ["site_photos", /revenue meter|pole number|nameplate/i],
];

const FACT_RULES: [string, RegExp, string?][] = [
  ["rating.current_a", /(?:rated[^\n\d]{0,40}current|continuous current|ampacity|amperage)[^\n\d]{0,20}(\d{2,4})\s*A\b/i, "A"],
  ["rating.voltage_v", /(?:rated[^\n\d]{0,20}voltage|voltage)[^\n\d]{0,20}(\d{3})\s*V/i, "V"],
  ["rating.interrupting_ka", /interrupting[^\n\d]{0,30}(\d{2,3})\s*kA/i, "kA"],
  ["rating.energy_kwh", /(\d{2,5}(?:\.\d+)?)\s*kWh/i, "kWh"],
  ["rating.power_kw", /(\d{2,5}(?:\.\d+)?)\s*kW(?!h)/i, "kW"],
  ["equipment.model", /model(?: number| no\.?)?\s*[:#]?\s*([A-Z0-9][A-Za-z0-9\-]{2,24}(?: [A-Z0-9][A-Za-z0-9\-]{1,12})?)/i],
  ["revision.label", /\brev(?:ision)?\.?\s*[:#]?\s*([A-Z])\b/i],
  ["doc.date", /(?:date|issued|effective)[^\n\d]{0,15}(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i],
  ["meter.serial", /serial(?: number| no\.?)?\s*[:#]?\s*(\d{6,})/i],
  ["listing.standard", /\b(UL\s*\d{4}[A-Z]?)\b/i],
];

export function rulesExtract(fileName: string, text?: string): ExtractionResult {
  const hay = `${fileName}\n${text ?? ""}`;
  const t = TYPE_RULES.find(([, re]) => re.test(hay));
  const facts: Fact[] = [];
  if (text) {
    for (const [key, re, unit] of FACT_RULES) {
      const m = re.exec(text);
      if (!m) continue;
      const line = text.slice(Math.max(0, text.lastIndexOf("\n", m.index) + 1), text.indexOf("\n", m.index + m[0].length) > -1 ? text.indexOf("\n", m.index + m[0].length) : undefined).trim();
      const page = (text.slice(0, m.index).match(/\f\[page (\d+)\]/g) ?? []).length || 1;
      facts.push({ key, label: FACT_KEYS[key] ?? key, value: m[1].trim(), unit, evidence: line.slice(0, 90), page, confidence: 0.8 });
    }
  }
  let effectiveDate = facts.find((f) => f.key === "doc.date")?.value;
  if (effectiveDate?.includes("/")) {
    const [mm, dd, yy] = effectiveDate.split("/");
    effectiveDate = `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const warnings: string[] = [];
  if (!text) warnings.push("No text layer (scanned image) — rules engine cannot read it. Add OPENAI_API_KEY for the vision model, or enter facts manually.");
  return {
    requirementId: t?.[0] ?? "unknown",
    docTypeConfidence: t ? 0.75 : 0.2,
    title: fileName,
    effectiveDate,
    revisionLabel: facts.find((f) => f.key === "revision.label")?.value,
    summary: `Deterministic rules engine: ${facts.length} fact(s) from text${text ? "" : " (no text found)"}.`,
    facts,
    missingItems: [],
    warnings,
    engine: "rules",
    textChars: text?.length,
  };
}
