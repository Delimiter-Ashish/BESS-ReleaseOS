// Engineering revision intelligence (deterministic). AI may add explanations elsewhere,
// but significance, dependency tasks and release gates are decided HERE by rules.
import { compareVersions as coreCompareVersions } from "@releaseos/release-core";
import { toCoreFactsOnly } from "./engine-adapter";
import { FACT_KEYS, INFORMATIONAL_KEYS } from "./facts";
import { normalizeFact } from "./normalize";
export { normalizeFact } from "./normalize";
import { REQ_BY_ID, REQUIREMENTS } from "./requirements";
import type { Fact, FactChange } from "./types";

const display = (f?: Fact) => (f ? `${f.value}${f.unit ? ` ${f.unit}` : ""}` : undefined);

/** Deterministic, conservative consequence notes. Wording is advisory; never a compliance determination. */
const IMPACT_RULES: Record<string, string> = {
  "rating.voltage_v": "Voltage class changed: an engineer should verify conductor insulation ratings, OCPD/disconnect voltage ratings, the single-line diagram, equipment labels, and the interconnection voltage before relying on dependent documents.",
  "rating.current_a": "Current rating changed: verify conductor ampacity, overcurrent protection coordination, bus ratings and the single-line diagram.",
  "rating.interrupting_ka": "Interrupting rating changed: verify available fault current against the equipment rating and the short-circuit study.",
  "rating.power_kw": "Power rating changed: verify plan set system size, interconnection application capacity and permit scope.",
  "rating.energy_kwh": "Energy capacity changed: verify plan set, fire permit ESS size and any capacity-based requirements with the engineer/AHJ.",
  "rating.frequency_hz": "Frequency changed: verify compatibility with the utility service and connected equipment.",
  "equipment.model": "Equipment model changed: verify listing, dimensions/clearances and the plan set equipment schedule.",
  "equipment.manufacturer": "Manufacturer changed: verify listing documentation and supplier submittals.",
  "equipment.quantity": "Quantity changed: verify system sizing, single-line diagram and equipment schedule.",
  chemistry: "Battery chemistry changed: SDS, UL 9540A test data, hazard analysis and emergency operations plan need engineering review.",
  "listing.standard": "Listing standard changed: verify the certification documentation for the installed equipment.",
};

export function ruleImpact(key: string) {
  return IMPACT_RULES[key] ?? "Changed engineering value: confirm with the responsible engineer.";
}

/**
 * Compare two fact sets (previous approved → new). Uses canonical units and classifies each change.
 * The release-core comparison is run on the mapped core fields as a cross-check: any field core reports
 * as changed is always treated as material.
 */
export function compareFacts(before: Fact[] = [], after: Fact[] = []): FactChange[] {
  const keys = Array.from(new Set([...before.map((f) => f.key), ...after.map((f) => f.key)]));
  const coreChanged = coreChangedKeys(before, after);
  const out: FactChange[] = [];
  for (const key of keys) {
    const b = before.find((f) => f.key === key);
    const a = after.find((f) => f.key === key);
    const nb = b ? normalizeFact(b) : undefined;
    const na = a ? normalizeFact(a) : undefined;
    const label = a?.label || b?.label || FACT_KEYS[key] || key;
    const base: FactChange = {
      key, label, before: display(b), after: display(a),
      evidenceBefore: b?.evidence, evidenceAfter: a?.evidence, pageBefore: b?.page, pageAfter: a?.page,
      normalizedBefore: nb?.text, normalizedAfter: na?.text, evidenceVerifiedAfter: a?.evidenceVerified,
    };
    const uncertain = [a, b].some((f) => f && f.status && f.status !== "found");
    if (b && a) {
      const same = nb!.ok && na!.ok && nb!.number !== undefined && na!.number !== undefined ? nb!.number === na!.number : nb!.text === na!.text;
      if (same && !coreChanged.has(key)) {
        if (display(b)?.toLowerCase().replace(/\s+/g, " ") === display(a)?.toLowerCase().replace(/\s+/g, " ")) continue; // identical
        out.push({ ...base, significance: "cosmetic", reason: `Same value after normalization (${na!.text}); wording/units differ only.` });
        continue;
      }
      if (INFORMATIONAL_KEYS.has(key)) {
        out.push({ ...base, significance: "informational", reason: "Document metadata changed." });
        continue;
      }
      const pct = nb!.number && na!.number !== undefined ? ((na!.number - nb!.number) / nb!.number) * 100 : undefined;
      out.push({
        ...base, significance: "material",
        reason: `${nb!.text} → ${na!.text}${pct !== undefined ? ` (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)` : ""}${uncertain ? " · one value is marked uncertain — verify against the source" : ""}`,
        impact: ruleImpact(key), impactSource: "rules",
      });
      continue;
    }
    // Present in only one revision's extraction: could be a real addition/removal or extraction variance.
    out.push({
      ...base,
      significance: INFORMATIONAL_KEYS.has(key) ? "informational" : "material",
      reason: a ? "Newly stated in this revision (not extracted from the previous revision) — verify." : "Not found in this revision (was stated in the previous revision) — verify whether it was removed.",
      impact: INFORMATIONAL_KEYS.has(key) ? undefined : ruleImpact(key), impactSource: INFORMATIONAL_KEYS.has(key) ? undefined : "rules",
    });
  }
  const rank = { material: 0, cosmetic: 2, informational: 1 } as const;
  return out.sort((x, y) => rank[x.significance ?? "material"] - rank[y.significance ?? "material"]);
}

function coreChangedKeys(before: Fact[], after: Fact[]): Set<string> {
  // Run release-core's semantic comparison on the subset of facts it models.
  const from = toCoreFactsOnly("cmp-before", before), to = toCoreFactsOnly("cmp-after", after);
  const stub = (id: string, facts: typeof from.facts) => ({
    id, documentId: "cmp", siteId: "cmp", family: "cmp", supplierId: null, componentId: null, title: "cmp", versionNumber: 1, revisionLabel: "-",
    uploadedAt: "", uploadedBy: "", fileName: "", mediaType: "", contentHash: id, contentBase64: "", text: "", approvalStatus: "pending" as const, facts,
  });
  const cmp = coreCompareVersions(stub("a", from.facts), stub("b", to.facts));
  const keys = new Set<string>();
  for (const c of cmp.changes) if (c.engineeringReviewRequired) for (const k of from.keysFor(c.field).concat(to.keysFor(c.field))) keys.add(k);
  return keys;
}

export const materialChanges = (changes: FactChange[]) => changes.filter((c) => c.significance === "material");

/** Dependents of a requirement whose relevant fields intersect the material changes (core: propagate with relevantFields). */
export function affectedDependents(requirementId: string, changedKeys: string[]) {
  return REQUIREMENTS.filter((r) => r.dependsOn?.includes(requirementId)).filter((r) => !r.dependencyFields?.length || r.dependencyFields.some((k) => changedKeys.includes(k)));
}

export function dependencyExplanation(sourceReq: string, sourceRev: string, dependentReq: string, changes: FactChange[]) {
  const src = REQ_BY_ID[sourceReq]?.name ?? sourceReq, dep = REQ_BY_ID[dependentReq]?.name ?? dependentReq;
  const list = changes.map((c) => `${c.label} ${c.before ?? "—"} → ${c.after ?? "—"}`).join("; ");
  return `${src} Rev ${sourceRev} changed ${list}. ${dep} depends on the ${src.toLowerCase()} and must be reviewed by an engineer (confirm still valid, or re-issue). This is a review task, not a compliance determination.`;
}
