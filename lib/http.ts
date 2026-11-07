import { NextResponse } from "next/server";
import { AuthError } from "./auth";
import { UploadError } from "./pdf";
import { StoreError } from "./store";

/** Uniform JSON error mapping for route handlers. Never leaks stack traces. */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthError || e instanceof StoreError || e instanceof UploadError) {
      return NextResponse.json({ ok: false, error: e.message, details: e instanceof StoreError ? e.details : undefined }, { status: e.status });
    }
    console.error("[api] unexpected error", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

export async function jsonBody(req: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > maxBytes) throw new UploadError(413, "Request body too large");
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
