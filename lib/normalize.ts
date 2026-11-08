// Unit normalization (pure; safe for client and server).
import { UNIT_RULES } from "./facts";
import type { Fact } from "./types";

export interface Normalized {
  ok: boolean;
  number?: number;
  unit: string;
  text: string; // display form in canonical unit, or cleaned text
}

const cleanText = (s: string) => s.toLowerCase().replace(/[\s,;:._\-()/]+/g, " ").replace(/\btype\b/g, "").replace(/\s+/g, " ").trim();
const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(10))));

/** Convert a fact to its canonical unit (0.6 kV → 600 V, 65,000 A → 65 kA). Non-numeric facts get cleaned text. */
export function normalizeFact(f: Pick<Fact, "key" | "value" | "unit">): Normalized {
  const rule = UNIT_RULES[f.key];
  const raw = `${f.value ?? ""}`.trim();
  if (!rule) return { ok: true, unit: "", text: cleanText(raw) };
  // Accept "600", "600 VAC", "65,000 A symmetrical", value+separate unit.
  const m = /(-?\d[\d,]*(?:\.\d+)?)\s*([a-zA-Z ]{0,8})?/.exec(raw);
  if (!m) return { ok: false, unit: rule.canonical, text: cleanText(raw) };
  const num = Number(m[1].replace(/,/g, ""));
  const unitRaw = (f.unit || m[2] || "").toLowerCase().replace(/symmetrical|sym\b|rms|3-?phase|continuous/g, "").trim();
  const mult = rule.units[unitRaw] ?? rule.units[unitRaw.replace(/\s+/g, "")] ?? (unitRaw === "" ? 1 : undefined);
  if (!Number.isFinite(num) || mult === undefined) return { ok: false, unit: rule.canonical, text: cleanText(raw + (f.unit ? ` ${f.unit}` : "")) };
  const n = num * mult;
  return { ok: true, number: n, unit: rule.canonical, text: `${fmtNum(n)}${rule.canonical ? ` ${rule.canonical}` : ""}` };
}

