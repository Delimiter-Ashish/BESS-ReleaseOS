import { ResourceLimitError } from "./resource-limits";
import { NextResponse } from "next/server";
import { AuthError } from "./auth";
import { UploadError } from "./pdf";
import { StoreError } from "./store";

/** Uniform JSON error mapping for route handlers. Never leaks stack traces. */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    // Let Next.js control-flow errors (dynamic bailout, redirects, notFound) propagate.
    if (e && typeof e === "object" && "digest" in e) throw e;
    if (e instanceof ResourceLimitError || e instanceof AuthError || e instanceof StoreError || e instanceof UploadError) {
      return NextResponse.json({ ok: false, error: e.message, details: e instanceof StoreError ? e.details : undefined }, { status: e.status });
    }
    console.error("[api] unexpected error", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

export async function readBody(req: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new UploadError(413, "Request body too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function jsonBody(req: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const text = new TextDecoder().decode(await readBody(req, maxBytes));
  try {
    const v = JSON.parse(text || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new UploadError(400, "Invalid JSON body");
  }
}

export const asString = (v: unknown, max = 1000) => (typeof v === "string" ? v.slice(0, max) : undefined);
export const asStringArray = (v: unknown, n = 20) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, n) : []);
