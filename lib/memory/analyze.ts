// Provider router for communication intelligence (server-only).
// OpenAI when selected/configured; otherwise (or on any failure) the deterministic scanner, LABELED as a fallback.
import { openaiAnalyzeCommunication } from "../ai/openai";
import { selectedProvider } from "../extract";
import { COMM_INSTRUCTIONS, COMM_SCHEMA, commPrompt, groundCommunication, type GroundedAnalysis } from "./schema";
import { rulesAnalyzeCommunication } from "./rules";
import type { CommunicationChannel } from "./types";

export interface AnalysisResult extends GroundedAnalysis {
  engine: "openai" | "rules";
  model?: string;
  fallback: boolean;
}

export async function analyzeCommunication(body: string, ctx: { siteName: string; siteAhj: string; utility: string; channel: CommunicationChannel; sender: string; sentAt: string; subject?: string }): Promise<AnalysisResult> {
  const provider = selectedProvider();
  let reason: string | undefined;
  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    try {
      const { raw, model } = await openaiAnalyzeCommunication(COMM_INSTRUCTIONS, commPrompt(ctx, body), COMM_SCHEMA as unknown as Record<string, unknown>);
      return { ...groundCommunication(raw, body), engine: "openai", model, fallback: false };
    } catch (e) {
      reason = `openai analysis failed: ${(e as Error).message?.slice(0, 200)}`;
      console.warn("[memory] OpenAI analysis failed, using deterministic fallback:", reason);
    }
  } else if (provider === "openai") {
    reason = "OPENAI_API_KEY is not set";
  } else if (provider === "anthropic") {
    reason = "communication intelligence is implemented for OpenAI only";
  }
  const g = groundCommunication(rulesAnalyzeCommunication(body, { channel: ctx.channel, sender: ctx.sender }), body);
  if (reason) g.warnings.unshift(`Deterministic fallback used — ${reason}. Suggestions come from keyword rules, not AI.`);
  return { ...g, engine: "rules", fallback: !!reason };
}
