// Small single-process safeguards for the public synthetic demo; not a distributed rate limiter.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, persistenceEnabled } from "./persistence";

export class ResourceLimitError extends Error {
  constructor(public status: 413 | 429 | 503, message: string) { super(message); }
}
export const publicDemo = () => process.env.RELEASEOS_PUBLIC_DEMO === "1";
export function positiveLimit(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
const state = globalThis as unknown as {
  __rosLimits?: Map<string, { start: number; count: number }>;
  __rosUploads?: number;
  __rosAiUsage?: { day: string; count: number };
};

export function takeRate(key: string, max: number, windowMs: number, now = Date.now()) {
  const buckets = state.__rosLimits ??= new Map();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= windowMs) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  if (bucket.count >= max) throw new ResourceLimitError(429, "Demo request limit reached. Please wait before trying again.");
  bucket.count++;
}
export function limitMutation(req: Request, userId: string) {
  if (!publicDemo() || req.method === "GET" || req.method === "HEAD") return;
  takeRate("mutations:all", 600, 60_000);
  takeRate(`mutations:${userId}`, 240, 60_000);
}
export function limitLogin() {
  // Global bound cannot be bypassed by rotating forged forwarding headers or demo usernames.
  if (publicDemo()) takeRate("login", 60, 60_000);
}
export function beginUpload() {
  if (!publicDemo()) return () => {};
  takeRate("uploads", positiveLimit("DEMO_UPLOADS_PER_HOUR", 60), 3600_000);
  if ((state.__rosUploads ?? 0) >= 4) throw new ResourceLimitError(429, "Four uploads are already processing. Please try again shortly.");
  state.__rosUploads = (state.__rosUploads ?? 0) + 1;
  let done = false;
  return () => { if (!done) { state.__rosUploads!--; done = true; } };
}
export function checkStorageQuota(existingBytes: number, additionalBytes: number) {
  if (publicDemo() && existingBytes + additionalBytes > positiveLimit("DEMO_STORAGE_MB", 100) * 1024 * 1024)
    throw new ResourceLimitError(413, "Demo file storage limit reached. Ask the operator to review storage.");
}

/** Reserve BEFORE a paid call, including failed calls. Persist independently of demo resets. */
export function reserveAiCall(now = new Date()) {
  if (!publicDemo()) return;
  const day = now.toISOString().slice(0, 10);
  const path = join(dataDir(), "ai-usage.json");
  let usage = state.__rosAiUsage;
  if (persistenceEnabled()) {
    try {
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, "utf8"));
        if (typeof raw.day !== "string" || !Number.isSafeInteger(raw.count) || raw.count < 0) throw new Error("invalid counter");
        usage = raw;
      }
    } catch { throw new ResourceLimitError(503, "AI budget counter unavailable; deterministic fallback is available."); }
  }
  if (!usage || usage.day !== day) usage = { day, count: 0 };
  if (usage.count >= positiveLimit("DEMO_AI_CALLS_PER_DAY", 100)) throw new ResourceLimitError(429, "Daily demo AI limit reached; deterministic fallback is available.");
  usage = { day, count: usage.count + 1 };
  if (persistenceEnabled()) {
    try {
      mkdirSync(dataDir(), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(usage), { mode: 0o600 });
      renameSync(tmp, path);
    } catch { throw new ResourceLimitError(503, "AI budget counter unavailable; deterministic fallback is available."); }
  }
  state.__rosAiUsage = usage;
}
