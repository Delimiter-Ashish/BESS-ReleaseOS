// Context-tagged electrical observations from one revision (pure, deterministic).
// Sources: (1) the PDF text layer, line by line, when the revision has one; (2) otherwise its recorded facts.
// For every value we record WHAT it refers to (equipment role, identifiers, interface side, rating vs nominal)
// and HOW that was determined, so cross-document comparisons only compare like with like.
import { classifyLines, REV_ENTRY } from "../sections";
import type { Revision } from "../types";
import type { EquipmentRole, InterfaceSide, Measure, Observation, Quantity } from "./types";

const ROLE_RULES: [EquipmentRole, RegExp][] = [
  ["transformer", /\btransformer\b|\bxfmr\b|\bstep-?up\b|\bT\d\b/i],
  ["switchgear", /\bswitchgear\b|\bac disconnect\b|\bdisconnect switch\b|\bNSG-\d+\b/i],
  ["inverter", /\binverter\b|\bpcs\b|\bMPS\d+\b/i],
  ["service", /\butility service\b|\bservice voltage\b|\bpoint of interconnection\b|\bPOI\b|\butility (primary|feeder|line)\b/i],
  ["battery", /\bbattery\b|\bdc bus\b|\bbess dc\b|\brack\b/i],
];
const DOC_ROLE: Record<string, EquipmentRole> = { switchgear_datasheet: "switchgear", inverter_datasheet: "inverter", battery_datasheet: "battery" };
const ID_RE = /\b(?!ESS-)(?:[A-Z]{2,5}-?\d{3,5}[A-Z]?|T\d)\b/g;

const QTY_RES: { q: Quantity; re: RegExp }[] = [
  { q: "voltage", re: /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(kV|kVAC|VAC|VDC|V)\b/gi },
  { q: "current", re: /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(kA|A)\b(?!C)/g },
];

function canonical(q: Quantity, n: number, unit: string) {
  const u = unit.toLowerCase();
  if (q === "voltage") return u.startsWith("k") ? n * 1000 : n;
  return u === "ka" ? n * 1000 : n;
}

/** Equipment named in the text; when several are named, the one mentioned FIRST is the subject of the line. */
function roleOf(text: string): { role: EquipmentRole; why: string } | undefined {
  let best: { role: EquipmentRole; why: string; at: number } | undefined;
  for (const [role, re] of ROLE_RULES) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.at)) best = { role, why: `“${m[0]}” in the line`, at: m.index };
  }
  return best && { role: best.role, why: best.why };
}

/** Side relative to the value's position: the nearest side keyword AFTER the value on the same line wins. */
function sideOf(line: string, at: number, len: number): InterfaceSide | undefined {
  const after = line.slice(at + len, at + len + 40).toLowerCase();
  const before = line.slice(Math.max(0, at - 50), at).toLowerCase();
  const pick = (s: string) => (/\bprimary\b/.test(s) ? "primary" : /\bsecondary\b/.test(s) ? "secondary" : /\butility\b/.test(s) ? "utility" : /\bvdc\b|\bdc\b/.test(s) ? "dc" : undefined);
  return pick(after.split(/[\/;,]/)[0]) ?? pick(before.split(/[\/;,]/).pop() ?? "");
}
const measureOf = (line: string): Measure => (/\brated\b|\brating\b|\bclass\b|\bmax(imum)?\b/i.test(line) ? "rating" : /\bnominal\b|\bservice\b|\bsystem\b|\boperating\b|\bat\b/i.test(line) ? "nominal" : "unspecified");

interface Carry { role: EquipmentRole; ids: string[]; line: string }

function observe(rev: Revision, line: string, page: number | undefined, kind: Observation["evidenceKind"], verified: boolean, docIds: string[], startIndex: number, carry?: Carry): Observation[] {
  const out: Observation[] = [];
  const clean = line.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 240) return out;
  if (REV_ENTRY.test(clean)) return out; // revision-block entries describe past changes, not current values
  const own = roleOf(clean);
  const lineRole = own ?? (carry ? { role: carry.role, why: `preceding line “${carry.line.slice(0, 60)}”` } : undefined);
  const ownIds = Array.from(new Set(clean.match(ID_RE) ?? []));
  const lineIds = ownIds.length ? ownIds : !own && carry ? carry.ids : [];
  for (const { q: q0, re } of QTY_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean))) {
      const unit = m[2];
      if (q0 === "voltage" && /^(kVA|kVAR)$/i.test(clean.slice(m.index + m[1].length).trim().slice(0, 4))) continue;
      const q: Quantity = q0 === "current" && /interrupt|aic|short[- ]circuit|withstand|symmetrical/i.test(clean) ? "interrupting" : q0;
      const n = Number(m[1].replace(/,/g, ""));
      if (!Number.isFinite(n) || n <= 0) continue;
      const docRole = DOC_ROLE[rev.requirementId];
      const role = lineRole?.role ?? docRole ?? "unknown";
      const ids = lineIds.length ? lineIds : role === docRole ? docIds : [];
      const side = sideOf(clean, m.index, m[0].length) ?? (/vdc/i.test(unit) ? "dc" : undefined);
      const why = [lineRole ? `equipment from ${lineRole.why}` : docRole ? `equipment from document type (${rev.requirementId})` : "no equipment named", ids.length ? `ids ${ids.join(", ")}` : "", side ? `side “${side}”` : ""].filter(Boolean).join("; ");
      out.push({
        id: `${rev.id}#${startIndex + out.length}`, revisionId: rev.id, requirementId: rev.requirementId, revLabel: rev.revLabel, fileName: rev.fileName,
        quantity: q, value: canonical(q, n, unit), display: `${m[1]} ${unit}`, equipment: role, identifiers: ids, side, measure: measureOf(clean),
        evidence: clean, page, evidenceKind: kind, evidenceVerified: verified, contextReason: why,
      });
    }
  }
  return out;
}

const RELEVANT_FACT = /^rating\.(voltage_v|current_a|interrupting_ka)$/;

export function observationsFor(rev: Revision): Observation[] {
  const docIds = Array.from(new Set(rev.facts.filter((f) => f.key === "equipment.model").flatMap((f) => (f.value.match(ID_RE) ?? [f.value.split(" ").pop() ?? ""]))).values()).filter(Boolean);
  const out: Observation[] = [];
  if (rev.textLayer && rev.textLayer.trim().length > 20) {
    // Split into pages, then classify lines so revision-history rows are skipped (shared with extraction).
    const pages = rev.textLayer.split(/\f?\[page \d+\]\n?/).filter((p, i) => i > 0 || p.trim());
    const lines: { line: string; page: number; history: boolean; first: boolean }[] = [];
    pages.forEach((p, i) => classifyLines(p).forEach((l, j) => l.text && lines.push({ line: l.text, page: i + 1, history: l.revisionHistory, first: j === 0 })));
    let carry: (Carry & { left: number }) | undefined;
    let lastPage = 0;
    for (const { line, page, history } of lines) {
      if (page !== lastPage) { carry = undefined; lastPage = page; }
      if (history) continue;
      out.push(...observe(rev, line, page, "text_layer", true, docIds, out.length, carry));
      // A line naming equipment (with no value of its own) sets the context for the next few lines on the page.
      const r = roleOf(line);
      if (r) carry = { role: r.role, ids: Array.from(new Set(line.match(ID_RE) ?? [])), line, left: 3 };
      else if (carry && --carry.left <= 0) carry = undefined;
    }
    return out;
  }
  for (const f of rev.facts) {
    if (!RELEVANT_FACT.test(f.key) || !f.evidence) continue;
    // Recorded facts: read the evidence line, falling back to the fact's own value/unit if the quote lacks a number.
    const fromEvidence = observe(rev, f.evidence, f.page, "recorded_fact", !!f.evidenceVerified, docIds, out.length);
    out.push(...(fromEvidence.length ? fromEvidence : observe(rev, `${f.label}: ${f.value} ${f.unit ?? ""}`, f.page, "recorded_fact", false, docIds, out.length)));
  }
  return out;
}
