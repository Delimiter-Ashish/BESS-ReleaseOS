// ===== Document intelligence router (server-only) =====
// AI_PROVIDER=openai     → OpenAI Responses API (vision-capable; PDFs, scans, photos)  [default when OPENAI_API_KEY is set]
// AI_PROVIDER=anthropic  → Kaushik's Anthropic extractor (never called when openai is selected)
// AI_PROVIDER=rules      → deterministic text-layer rules only
// Any AI failure or missing key falls back to the deterministic engine, and the result is LABELED as a fallback.
import { anthropicExtract } from "./ai/anthropic";
import { openaiExtract } from "./ai/openai";
import { groundExtraction } from "./ai/schema";
import { FACT_KEYS } from "./facts";
import type { AllowedMedia, TextLayer } from "./pdf";
import { REQ_BY_ID } from "./requirements";
import type { Fact } from "./types";

export { FACT_KEYS } from "./facts";

export type Provider = "openai" | "anthropic" | "rules";

export function selectedProvider(): Provider {
  const p = (process.env.AI_PROVIDER || "").toLowerCase();
  if (p === "openai" || p === "anthropic" || p === "rules") return p;
  return process.env.OPENAI_API_KEY ? "openai" : "rules";
}

export interface ExtractionResult {
  requirementId: string;
  docTypeConfidence: number;
  title: string;
  documentNumber?: string;
  effectiveDate?: string;
  revisionLabel?: string;
  manufacturer?: string;
  summary: string;
  facts: Fact[];
  missingItems: string[];
  warnings: string[];
  engine: "openai" | "claude" | "rules";
  provider: Provider;
  fallback: boolean;
  fallbackReason?: string;
  model?: string;
  isScanned: boolean;
  embeddedInstructions: string[];
  textChars?: number;
  pageCount: number;
}

export async function extractDocument(opts: { fileName: string; media: AllowedMedia; bytes: Buffer; layer: TextLayer; siteName: string; siteFacts: string }): Promise<ExtractionResult> {
  const provider = selectedProvider();
  let fallbackReason: string | undefined;
  if (provider === "openai" || provider === "anthropic") {
    const keyVar = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    if (!process.env[keyVar]) fallbackReason = `${keyVar} is not configured`;
    else {
      try {
        const out = provider === "openai" ? await openaiExtract(opts) : await anthropicExtract(opts);
        const g = groundExtraction(out.raw, opts.layer, provider);
        return { ...g, engine: provider === "openai" ? "openai" : "claude", provider, fallback: false, model: out.model, textChars: opts.layer.joined.length, pageCount: opts.layer.pageCount };
      } catch (e) {
        fallbackReason = `${provider} extraction failed: ${sanitize((e as Error).message)}`;
      }
    }
  }
  const rules = rulesExtract(opts.fileName, opts.layer);
  if (fallbackReason) rules.warnings.unshift(`Deterministic fallback used — ${fallbackReason}.`);
  return { ...rules, provider, fallback: provider !== "rules", fallbackReason };
}

const sanitize = (m: string) => m.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***").slice(0, 240);

// ---------- Deterministic rules engine (labeled fallback) ----------
const TYPE_RULES: [string, RegExp][] = [
  ["plan_set", /plan set|sheet index|ess-1\.0|engineer of record/i],
  ["switchgear_datasheet", /switchgear|ac disconnect|disconnect switch/i],
  ["ul9540a_report", /9540a/i],
  ["ul9540_listing", /ul\s*9540(?!a)/i],
  ["inverter_datasheet", /inverter|pcs|mps125/i],
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

const ALWAYS_KEYS = ["revision.label", "doc.date", "doc.number", "equipment.manufacturer", "equipment.model", "equipment.quantity", "listing.standard", "enclosure.rating"];

// Patterns in priority order: labeled ratings-table lines first, generic mentions last.
const FACT_RULES: [string, RegExp[], string?][] = [
  ["equipment.manufacturer", [/^\s*manufacturer\s*:\s*([^\n(]{2,60}?)\s*(?:\(|$)/im]],
  ["equipment.model", [/^\s*model(?: number| no\.?)?\s*[:#]\s*([A-Z0-9][A-Za-z0-9\-]{2,24}(?: [A-Z0-9][A-Za-z0-9\-]{1,12})?)/im, /model(?: number| no\.?)?\s*[:#]?\s*([A-Z0-9][A-Za-z0-9\-]{2,24})/i]],
  ["rating.voltage_v", [/^\s*rated voltage\s*:\s*(\d[\d,.]*)\s*(VAC|VDC|kV|V)\b/im, /rated[^\n\d]{0,20}voltage[^\n\d]{0,20}(\d[\d,.]*)\s*(VAC|VDC|kV|V)\b/i, /voltage[^\n\d]{0,20}(\d{3})\s*(VAC|V)\b/i]],
  ["rating.current_a", [/^\s*rated (?:continuous )?current\s*:\s*(\d[\d,]*)\s*(A)\b/im, /(?:rated[^\n\d]{0,40}current|continuous current|ampacity)[^\n\d]{0,20}(\d{2,4})\s*(A)\b/i]],
  ["rating.interrupting_ka", [/interrupting rating\s*:\s*(\d[\d,]*)\s*(kA|A)\b/i, /interrupting[^\n\d]{0,30}(\d{2,3})\s*(kA)/i]],
  ["rating.frequency_hz", [/^\s*frequency\s*:\s*(\d{2})\s*(Hz)/im]],
  ["rating.energy_kwh", [/(?:DC system size|energy|capacity)\s*:\s*(\d[\d,.]*)\s*(kWh|MWh)/i, /(\d{2,5}(?:\.\d+)?)\s*(kWh)/i]],
  ["rating.power_kw", [/(?:AC system size|power rating|rated power)\s*:\s*(\d[\d,.]*)\s*(kW|MW)\b/i, /(\d{2,5}(?:\.\d+)?)\s*(kW)(?!h)/i]],
  ["equipment.quantity", [/^\s*quantity\s*:\s*(\d{1,4})\s*$/im]],
  ["enclosure.rating", [/^\s*enclosure(?: rating)?\s*:\s*(NEMA[^\n]{0,20})/im]],
  ["revision.label", [/^\s*revision\s*:\s*([A-Z0-9]{1,3})\b/im, /\brev(?:ision)?\.?\s*[:#]?\s*([A-Z])\b/i]],
  ["doc.date", [/^\s*date\s*:\s*(\d{4}-\d{2}-\d{2})/im, /(?:date|issued|effective)[^\n\d]{0,15}(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i]],
  ["doc.number", [/document no\.?\s*:\s*([A-Z0-9][A-Z0-9\-]{3,30})/i]],
  ["meter.serial", [/serial(?: number| no\.?)?\s*[:#]?\s*(\d{6,})/i]],
  ["listing.standard", [/\b(UL\s*\d{3,4}[A-Z]?)\b/i]],
];

export function rulesExtract(fileName: string, layer: TextLayer): Omit<ExtractionResult, "provider" | "fallback" | "fallbackReason"> {
  const text = layer.hasText ? layer.pages.join("\n") : "";
  const hay = `${fileName}\n${text}`;
  const t = TYPE_RULES.find(([, re]) => re.test(hay));
  const facts: Fact[] = [];
  // Only look for facts relevant to the classified type (avoids reading project context as equipment ratings).
  const keyFacts = t ? REQ_BY_ID[t[0]]?.keyFacts : undefined;
  const allowed = keyFacts ? new Set([...keyFacts, ...ALWAYS_KEYS]) : undefined;
  if (layer.hasText) {
    for (const [key, patterns] of FACT_RULES) {
      if (allowed && !allowed.has(key)) continue;
      let hit: { m: RegExpExecArray; page: number; pageText: string } | undefined;
      outer: for (const re of patterns) {
        for (let p = 0; p < layer.pages.length; p++) {
          const m = re.exec(layer.pages[p]);
          if (m) { hit = { m, page: p + 1, pageText: layer.pages[p] }; break outer; }
        }
      }
      if (!hit) continue;
      const { m, page, pageText } = hit;
      const ls = pageText.lastIndexOf("\n", m.index + (m[0].match(/^\s*/)?.[0].length ?? 0)) + 1;
      const le = pageText.indexOf("\n", m.index + m[0].length);
      const line = pageText.slice(ls, le > -1 ? le : undefined).trim();
      facts.push({ key, label: FACT_KEYS[key] ?? key, value: m[1].trim(), unit: m[2], evidence: line.slice(0, 160), page, pageVerified: true, evidenceVerified: true, confidence: 0.8, status: "found", origin: "rules" });
    }
  }
  let effectiveDate = facts.find((f) => f.key === "doc.date")?.value;
  if (effectiveDate?.includes("/")) {
    const [mm, dd, yy] = effectiveDate.split("/");
    effectiveDate = `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const warnings: string[] = [];
  if (!layer.hasText) warnings.push("No text layer (scanned/image document) — the deterministic engine cannot read it. Configure OPENAI_API_KEY for vision extraction, or enter facts manually.");
  return {
    requirementId: t?.[0] ?? "unknown",
    docTypeConfidence: t ? 0.7 : 0.2,
    title: fileName,
    documentNumber: facts.find((f) => f.key === "doc.number")?.value,
    effectiveDate,
    revisionLabel: facts.find((f) => f.key === "revision.label")?.value,
    manufacturer: facts.find((f) => f.key === "equipment.manufacturer")?.value,
    summary: `Deterministic rules engine: ${facts.length} labeled fact(s) read from the PDF text layer${layer.hasText ? "" : " (no text found)"}. Not AI.`,
    facts,
    missingItems: [],
    warnings,
    engine: "rules",
    isScanned: !layer.hasText,
    embeddedInstructions: [],
    textChars: text.length,
    pageCount: layer.pageCount,
  };
}
