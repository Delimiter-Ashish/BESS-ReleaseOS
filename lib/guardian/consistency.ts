// Cross-document engineering consistency (pure, deterministic). Compares facts across the CURRENT documents of a
// site — not two revisions of one file. A difference is only a discrepancy when both values describe the same
// quantity of the same equipment at the same interface. Different equipment, opposite transformer sides, and
// rating-vs-nominal differences are explained, not flagged. Nothing here asserts incompatibility or noncompliance.
import { createHash } from "node:crypto";
import { latestApproved, pendingRevision } from "../release";
import { PACKAGE_TEMPLATES, REQ_BY_ID } from "../requirements";
import type { Revision, Site } from "../types";
import { observationsFor } from "./observations";
import type { ConsistencyFinding, Observation } from "./types";

const UNIT = { voltage: "V", current: "A", interrupting: "A" } as const;
const fmt = (o: Observation) => `${o.value.toLocaleString("en-US")} ${UNIT[o.quantity]}`;
const where = (o: Observation) => `${REQ_BY_ID[o.requirementId]?.name ?? o.requirementId} Rev ${o.revLabel}${o.page ? ` p.${o.page}` : ""}`;
const EQUIP_LABEL = { switchgear: "switchgear / AC disconnect", transformer: "transformer", inverter: "inverter / PCS", battery: "battery", service: "utility service", unknown: "unnamed equipment" } as const;

/** Current revision per document type: approved view, or candidate view (a pending revision overrides the approved one). */
export function currentRevisions(site: Site, view: "approved" | "candidate") {
  const ids = Array.from(new Set(site.documents.map((d) => d.requirementId)));
  return ids.map((rid) => (view === "candidate" ? pendingRevision(site, rid) ?? latestApproved(site, rid) : latestApproved(site, rid))).filter((r): r is Revision => !!r);
}

/** Why two document types should agree (dependency graph or shared package), or undefined if unrelated. */
export function relation(a: string, b: string) {
  const ra = REQ_BY_ID[a], rb = REQ_BY_ID[b];
  if (ra?.dependsOn?.includes(b)) return `${ra.name} depends on ${rb?.name ?? b}`;
  if (rb?.dependsOn?.includes(a)) return `${rb.name} depends on ${ra?.name ?? a}`;
  const t = PACKAGE_TEMPLATES.find((p) => p.required.includes(a) && p.required.includes(b));
  return t ? `both in the ${t.name}` : undefined;
}

const sameEquipment = (a: Observation, b: Observation) =>
  (a.equipment !== "unknown" && a.equipment === b.equipment) || a.identifiers.some((i) => b.identifiers.includes(i));

/** Transformers stated anywhere in scope: (primary, secondary) value pairs with their evidence. */
function transformerBridges(all: Observation[]) {
  const byLine = new Map<string, Observation[]>();
  for (const o of all.filter((x) => x.equipment === "transformer" && x.quantity === "voltage")) byLine.set(`${o.revisionId}|${o.evidence}`, [...(byLine.get(`${o.revisionId}|${o.evidence}`) ?? []), o]);
  const out: { primary: Observation; secondary: Observation }[] = [];
  byLine.forEach((obs) => {
    const p = obs.find((o) => o.side === "primary"), s = obs.find((o) => o.side === "secondary");
    if (p && s) out.push({ primary: p, secondary: s });
  });
  return out;
}

const fid = (parts: (string | number)[]) => `CF-${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 12)}`;

export function classifyPair(a: Observation, b: Observation, bridges: { primary: Observation; secondary: Observation }[]): Pick<ConsistencyFinding, "class" | "reason"> | undefined {
  if (a.quantity !== b.quantity) return undefined;
  const q = a.quantity;
  if (sameEquipment(a, b)) {
    const eq = EQUIP_LABEL[a.equipment !== "unknown" ? a.equipment : b.equipment];
    const ctx = a.identifiers.find((i) => b.identifiers.includes(i)) ? ` (${a.identifiers.find((i) => b.identifiers.includes(i))})` : "";
    if (a.side && b.side && a.side !== b.side) return { class: "explained_difference", reason: `Same ${eq}${ctx} but different interfaces (${a.side} vs ${b.side}); different ${q} values are expected.` };
    if (a.value === b.value) return { class: "consistent", reason: `Both documents state ${fmt(a)} for the ${eq}${ctx}.` };
    const rating = a.measure === "rating" ? a : b.measure === "rating" ? b : undefined;
    const nominal = a.measure === "nominal" ? a : b.measure === "nominal" ? b : undefined;
    if (rating && nominal && rating !== nominal) {
      return rating.value >= nominal.value
        ? { class: "explained_difference", reason: `${where(rating)} gives an equipment rating (${fmt(rating)}) that is at or above the nominal value in ${where(nominal)} (${fmt(nominal)}).` }
        : { class: "potential_inconsistency", reason: `${where(rating)} rating (${fmt(rating)}) is below the nominal value stated in ${where(nominal)} (${fmt(nominal)}). Investigate which document is current.` };
    }
    return { class: "verified_discrepancy", reason: `Both documents state the ${q} of the same ${eq}${ctx} and the values differ: ${fmt(a)} in ${where(a)} vs ${fmt(b)} in ${where(b)}. Engineer review required to determine which is correct.` };
  }
  if (a.equipment !== "unknown" && b.equipment !== "unknown") {
    if (q !== "voltage" || a.value === b.value) return undefined;
    const br = bridges.find((t) => (t.primary.value === a.value && t.secondary.value === b.value) || (t.primary.value === b.value && t.secondary.value === a.value));
    if (br) {
      const tag = br.primary.identifiers[0] ?? "transformer";
      return { class: "explained_difference", reason: `${fmt(a)} (${EQUIP_LABEL[a.equipment]}) and ${fmt(b)} (${EQUIP_LABEL[b.equipment]}) are on opposite sides of ${tag}, stated as ${fmt(br.primary)} primary / ${fmt(br.secondary)} secondary in ${where(br.primary)}. Not a conflict.` };
    }
    return undefined; // different equipment, no evidence they should match: not comparable
  }
  if (a.value === b.value) return undefined;
  const unk = a.equipment === "unknown" ? a : b;
  return { class: "insufficient_evidence", reason: `${where(unk)} states ${fmt(unk)} without naming the equipment or interface, so it cannot be matched to ${fmt(unk === a ? b : a)} in ${where(unk === a ? b : a)}.` };
}

/**
 * All cross-document findings among current, related documents.
 * `scope`: limit to pairs where at least one document type is in this set (e.g. a package checklist).
 */
export function findConsistency(site: Site, opts: { view: "approved" | "candidate"; scope?: Set<string> }): { findings: ConsistencyFinding[]; checkedPairs: number } {
  const revs = currentRevisions(site, opts.view);
  const obs = new Map(revs.map((r) => [r.id, observationsFor(r)]));
  const bridges = transformerBridges(Array.from(obs.values()).flat());
  const findings = new Map<string, ConsistencyFinding>();
  let checkedPairs = 0;
  for (let i = 0; i < revs.length; i++) {
    for (let j = i + 1; j < revs.length; j++) {
      const [r1, r2] = [revs[i], revs[j]];
      if (opts.scope && !opts.scope.has(r1.requirementId) && !opts.scope.has(r2.requirementId)) continue;
      const rel = relation(r1.requirementId, r2.requirementId);
      if (!rel) continue;
      const o1 = obs.get(r1.id)!, o2 = obs.get(r2.id)!;
      if (!o1.length || !o2.length) continue;
      checkedPairs++;
      // a = the more recently uploaded document (the likely source of a change)
      const [ra, rb, oa, ob] = (r1.uploadedAt >= r2.uploadedAt ? [r1, r2, o1, o2] : [r2, r1, o2, o1]) as [Revision, Revision, Observation[], Observation[]];
      for (const a of oa) for (const b of ob) {
        const c = classifyPair(a, b, bridges);
        if (!c) continue;
        const ctx = [a.quantity, a.equipment, b.equipment, [...a.identifiers, ...b.identifiers].sort().join("+"), a.side ?? "", b.side ?? ""].join("/");
        const id = fid([ra.id, rb.id, ctx, a.value, b.value]);
        const prev = findings.get(id);
        // Keep the strongest evidence: text-layer lines over recorded facts.
        if (prev && (prev.a.evidenceKind === "text_layer" || a.evidenceKind !== "text_layer")) continue;
        findings.set(id, { id, ...c, quantity: a.quantity, a, b, view: opts.view, relation: rel });
      }
      void ra; void rb;
    }
  }
  const order = { verified_discrepancy: 0, potential_inconsistency: 1, insufficient_evidence: 2, explained_difference: 3, consistent: 4 } as const;
  return { findings: Array.from(findings.values()).sort((x, y) => order[x.class] - order[y.class]), checkedPairs };
}
