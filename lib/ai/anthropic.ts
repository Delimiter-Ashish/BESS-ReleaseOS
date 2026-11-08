import { publicDemo, reserveAiCall } from "../resource-limits";
// Optional Anthropic provider (Kaushik's original multimodal extractor), used ONLY when AI_PROVIDER=anthropic.
import Anthropic from "@anthropic-ai/sdk";
import type { AllowedMedia, TextLayer } from "../pdf";
import { SYSTEM_INSTRUCTIONS, userPrompt } from "./schema";

export const ANTHROPIC_MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

export async function anthropicExtract(opts: { fileName: string; media: AllowedMedia; bytes: Buffer; layer: TextLayer; siteName: string; siteFacts: string }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ timeout: 90_000, maxRetries: publicDemo() ? 0 : 1 });
  const content: Anthropic.ContentBlockParam[] = [];
  const b64 = opts.bytes.toString("base64");
  if (opts.media === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } });
  else if (opts.media.startsWith("image/")) content.push({ type: "image", source: { type: "base64", media_type: opts.media as "image/png" | "image/jpeg" | "image/webp", data: b64 } });
  content.push({ type: "text", text: `${userPrompt(opts.siteName, opts.siteFacts, opts.layer.hasText ? opts.layer.joined : undefined)}\n\nRespond with ONLY a JSON object with keys: requirementId, docTypeConfidence, title, documentNumber, revisionLabel, effectiveDate, manufacturer, summary, isScannedOrImageBased, facts[{key,label,value,unit,evidence,page,confidence,status,note}], missingItems, warnings, embeddedInstructionsDetected.` });
  reserveAiCall();
  const msg = await client.messages.create({ model: ANTHROPIC_MODEL(), max_tokens: 4000, system: SYSTEM_INSTRUCTIONS, messages: [{ role: "user", content }] });
  const out = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const start = out.indexOf("{"), end = out.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Anthropic returned no JSON");
  return { raw: JSON.parse(out.slice(start, end + 1)) as unknown, model: ANTHROPIC_MODEL() };
}
