// Deterministic clock + site-local calendar dates for due-date logic.
// RELEASEOS_CLOCK (ISO instant) pins the process start to that instant for tests/demos; time then advances with
// real elapsed time (so records keep their order). Unset → system clock. Pure functions take explicit dates.
// All due dates are calendar dates in the SITE's time zone, so an instant near midnight UTC lands on the right day.

const g = globalThis as unknown as { __rosClockStart?: number };
export function clockNow(): Date {
  const f = process.env.RELEASEOS_CLOCK;
  if (f) {
    const base = Date.parse(f);
    if (!Number.isNaN(base)) {
      g.__rosClockStart ??= Date.now();
      return new Date(base + (Date.now() - g.__rosClockStart));
    }
  }
  return new Date();
}
export const clockMode = (): "system" | "frozen" => (process.env.RELEASEOS_CLOCK && !Number.isNaN(new Date(process.env.RELEASEOS_CLOCK).getTime()) ? "frozen" : "system");
export const nowIso = () => clockNow().toISOString();

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
export const defaultTimezone = (state: string) => (state === "CA" ? "America/Los_Angeles" : "America/New_York");

/** Calendar date (YYYY-MM-DD) of an instant in a time zone. Plain dates pass through unchanged. */
export function localDate(at: Date | string, tz: string): string {
  if (typeof at === "string" && DATE_RE.test(at)) return at;
  const d = typeof at === "string" ? new Date(at) : at;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD). Positive when `to` is later. */
export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** ?asOf= accepts a calendar date or an ISO instant (converted to the site-local date). */
export function parseAsOf(v: string | null | undefined, tz: string): string | null {
  if (!v) return null;
  if (isDate(v)) return v;
  if (DATE_RE.test(v) || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return null; // invalid calendar date or not an ISO instant
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : localDate(d, tz);
}
