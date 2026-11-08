// Typed client adapters for the backend routes (client-safe). Types come straight from Ashish's shared contracts
// (lib/guardian/types.ts, lib/memory/types.ts) — nothing here re-implements backend logic.
// Every call resolves to an explicit state so screens never confuse "unavailable" with "no findings".
import type { EvidenceGraph, PreflightReport, TimeMachineReport } from "@/lib/guardian/types";
import type { Communication } from "@/lib/memory/types";

export type ApiResult<T> =
  | { state: "ok"; data: T; ms: number }
  | { state: "forbidden"; error: string; ms: number }
  | { state: "unavailable"; error: string; ms: number } // route not deployed on this backend (404 without JSON body)
  | { state: "error"; error: string; status?: number; ms: number };

async function call<T>(url: string, init: RequestInit | undefined, pick: (j: Record<string, unknown>) => T): Promise<ApiResult<T>> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  try {
    const r = await fetch(url, { credentials: "same-origin", ...init });
    const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    if (r.status === 403 || r.status === 401) return { state: "forbidden", error: String(j?.error ?? "Not permitted for this identity"), ms: ms() };
    if (r.status === 404 && !j) return { state: "unavailable", error: `Endpoint not available: ${url.split("?")[0]}`, ms: ms() };
    if (!r.ok || !j || j.ok !== true) return { state: "error", error: String(j?.error ?? `HTTP ${r.status}`), status: r.status, ms: ms() };
    return { state: "ok", data: pick(j), ms: ms() };
  } catch (e) {
    return { state: "error", error: (e as Error).message || "Network error", ms: ms() };
  }
}
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** POST /api/sites/:id/preflight — Project Guardian preflight (read-only; blockers = the release gate). */
export const runPreflight = (siteId: string, templateId: string, ai = false) =>
  call<PreflightReport>(`/api/sites/${encodeURIComponent(siteId)}/preflight`, json({ templateId, ai }), (j) => j.report as PreflightReport);

/** GET /api/sites/:id/graph — cross-source evidence graph. */
export const fetchGraph = (siteId: string) => call<EvidenceGraph>(`/api/sites/${encodeURIComponent(siteId)}/graph`, undefined, (j) => j.graph as EvidenceGraph);

/** GET /api/sites/:id/timemachine?releaseId= — frozen release vs current state. */
export const fetchTimeMachine = (siteId: string, releaseId: string) =>
  call<TimeMachineReport>(`/api/sites/${encodeURIComponent(siteId)}/timemachine?releaseId=${encodeURIComponent(releaseId)}`, undefined, (j) => j.report as TimeMachineReport);

/** GET /api/sites/:id/communications — verbatim originals (EQORE only). */
export const fetchCommunications = (siteId: string) =>
  call<Communication[]>(`/api/sites/${encodeURIComponent(siteId)}/communications`, undefined, (j) => j.communications as Communication[]);

/** POST /api/sites/:id/communications — import an email / AHJ comment. */
export const importCommunication = (siteId: string, body: { body: string; channel?: string; sender?: string; sentAt?: string; subject?: string }) =>
  call<{ duplicate?: boolean; communication: Communication; items: unknown[] }>(`/api/sites/${encodeURIComponent(siteId)}/communications`, json(body), (j) => j as never);

export interface ReleaseResponse { id: string; siteId: string; templateId: string; number: number; builtBy: string; builtAt: string; note?: string; manifestSha256: string; snapshotSha256?: string; items: { requirementId: string; revisionId: string; revLabel: string; fileName: string; sha256: string }[] }
/** POST /api/sites/:id/releases — engineer signoff + sealed release (existing release engine). */
export const buildRelease = (siteId: string, templateId: string, note: string, readinessToken: string) =>
  call<ReleaseResponse>(`/api/sites/${encodeURIComponent(siteId)}/releases`, json({ templateId, note, readinessToken }), (j) => j.release as ReleaseResponse);

// ---------- Submission Studio: contracts NOT yet implemented by the backend ----------
// Documented in docs/FRONTEND_CONTRACTS.md. The UI shows these as "backend pending" and never simulates them.
export interface CombinedPdfRequest { releaseId: string; groups: { title: string; revisionIds: string[] }[] }
export interface CombinedPdfResponse { ok: true; files: { groupTitle: string; fileId: string; fileName: string; pages: number; sha256: string; url: string }[] }
export const COMBINED_PDF_ENDPOINT = "POST /api/releases/:id/combined-pdf";
export const RECIPIENT_CHECK_ENDPOINT = "POST /api/sites/:id/submissions/check-recipient";
