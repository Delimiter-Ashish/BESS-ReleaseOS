// OpenAI provider (official SDK, Responses API, strict Structured Outputs). Server-only.
import OpenAI from "openai";
import type { FactChange } from "../types";
import type { AllowedMedia, TextLayer } from "../pdf";
import { EXPLAIN_INSTRUCTIONS, EXPLAIN_SCHEMA, EXTRACTION_SCHEMA, SYSTEM_INSTRUCTIONS, userPrompt } from "./schema";

export const OPENAI_MODEL = () => process.env.OPENAI_MODEL || "gpt-5.5";
const TIMEOUT_MS = () => Number(process.env.OPENAI_TIMEOUT_MS || 90_000);

function client() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  // OPENAI_BASE_URL is honored by the SDK (used for the offline contract test).
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: TIMEOUT_MS(), maxRetries: 1 });
}

function parseOutput(res: { status?: string | null; output_text?: string; incomplete_details?: { reason?: string } | null }) {
  if (res.status && res.status !== "completed") throw new Error(`OpenAI response ${res.status}${res.incomplete_details?.reason ? ` (${res.incomplete_details.reason})` : ""}`);
  const text = res.output_text ?? "";
  if (!text.trim()) throw new Error("OpenAI returned an empty response (possible refusal)");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("OpenAI returned malformed JSON");
  }
}

export async function openaiExtract(opts: { fileName: string; media: AllowedMedia; bytes: Buffer; layer: TextLayer; siteName: string; siteFacts: string }) {
  const b64 = opts.bytes.toString("base64");
  type Part = OpenAI.Responses.ResponseInputContent;
  const parts: Part[] = [];
  if (opts.media === "application/pdf") parts.push({ type: "input_file", filename: opts.fileName.replace(/[^\w.\- ]/g, "_").slice(0, 100) || "document.pdf", file_data: `data:application/pdf;base64,${b64}` });
  else if (opts.media.startsWith("image/")) parts.push({ type: "input_image", image_url: `data:${opts.media};base64,${b64}`, detail: "high" });
  parts.push({ type: "input_text", text: userPrompt(opts.siteName, opts.siteFacts, opts.layer.hasText ? opts.layer.joined : undefined) });

  const res = await client().responses.create({
    model: OPENAI_MODEL(),
    instructions: SYSTEM_INSTRUCTIONS,
    input: [{ role: "user", content: parts }],
    text: { format: { type: "json_schema", name: "bess_document_extraction", schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>, strict: true } },
    max_output_tokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 12_000),
    store: false,
  });
  return { raw: parseOutput(res), model: res.model ?? OPENAI_MODEL(), usage: res.usage };
}

export async function openaiExplain(input: { documentName: string; fromRev?: string; toRev: string; changes: FactChange[]; dependents: { id: string; name: string }[] }) {
  const payload = {
    document: input.documentName, fromRevision: input.fromRev ?? null, toRevision: input.toRev,
    detectedChanges: input.changes.map((c) => ({ key: c.key, label: c.label, before: c.before ?? null, after: c.after ?? null, normalizedBefore: c.normalizedBefore ?? null, normalizedAfter: c.normalizedAfter ?? null, evidenceBefore: c.evidenceBefore ?? null, evidenceAfter: c.evidenceAfter ?? null, pageAfter: c.pageAfter ?? null })),
    dependencyGraphDependents: input.dependents,
  };
  const res = await client().responses.create({
    model: OPENAI_MODEL(),
    instructions: EXPLAIN_INSTRUCTIONS,
    input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(payload) }] }],
    text: { format: { type: "json_schema", name: "bess_change_explanation", schema: EXPLAIN_SCHEMA as unknown as Record<string, unknown>, strict: true } },
    max_output_tokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 12_000),
    store: false,
  });
  const raw = parseOutput(res) as { summary?: unknown; changes?: { key?: unknown; impact?: unknown; suggestedRequirementIds?: unknown }[] };
  if (typeof raw.summary !== "string" || !Array.isArray(raw.changes)) throw new Error("Malformed explanation response");
  return {
    summary: raw.summary.slice(0, 1200),
    changes: raw.changes.filter((c) => typeof c.key === "string" && typeof c.impact === "string").map((c) => ({
      key: c.key as string, impact: (c.impact as string).slice(0, 800),
      suggestedRequirementIds: Array.isArray(c.suggestedRequirementIds) ? (c.suggestedRequirementIds as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 10) : [],
    })),
  };
}

/** Communication intelligence (project memory). Text-only input; output is re-validated by groundCommunication. */
export async function openaiAnalyzeCommunication(instructions: string, prompt: string, schema: Record<string, unknown>) {
  const res = await client().responses.create({
    model: OPENAI_MODEL(),
    instructions,
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
    text: { format: { type: "json_schema", name: "bess_communication_memory", schema, strict: true } },
    max_output_tokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 12_000),
    store: false,
  });
  return { raw: parseOutput(res), model: res.model ?? OPENAI_MODEL(), usage: res.usage };
}
