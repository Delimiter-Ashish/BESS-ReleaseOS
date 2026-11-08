// Regression tests: revision-history rows are never current facts; verified discrepancies need identity evidence.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Session } from "../lib/auth";
import { groundExtraction } from "../lib/ai/schema";
import { rulesExtract } from "../lib/extract";
import { findConsistency } from "../lib/guardian/consistency";
import { observationsFor } from "../lib/guardian/observations";
import { readTextLayer } from "../lib/pdf";
import { classifyLines, quoteOnlyInRevisionHistory } from "../lib/sections";
import * as store from "../lib/store";

const PM: Session = { userId: "arivera", name: "A. Rivera", role: "eqore", engineer: false, roles: ["eqore"] };
const layerOf = async (name: string) => readTextLayer("application/pdf", readFileSync(`sample-docs/${name}`));

test("section detection: revision-block rows (and wrapped continuations) are history; current lines are not", () => {
  const lines = classifyLines(["Revision: C", "Rated voltage: 600 VAC", "Revision block", "A 2025-12-01 Issued for permit", "B 01/11/2026 Change inverters to 2 x Dynapower", "MPS125 units", "ESS-13.0 notes", "Rev B 2026-10-28 Voltage class revised to 600 VAC"].join("\n"));
  assert.deepEqual(lines.map((l) => l.revisionHistory), [false, false, true, true, true, false, false, true]);
  assert.equal(quoteOnlyInRevisionHistory(["Revision block\nB 01/11/2026 Change inverters to 2 x Dynapower MPS125\nModel: NSG-4000"], "Change inverters to 2 x Dynapower MPS125"), true);
  assert.equal(quoteOnlyInRevisionHistory(["Revision block\nB 01/11/2026 Model NSG-4000 added\nModel: NSG-4000"], "Model: NSG-4000"), false);
});

test("rules extractor ignores revision-history rows (plan set Rev C / Rev B regression)", async () => {
  for (const f of ["SYNTHETIC_Plan_Set_RevC.pdf", "SYNTHETIC_Plan_Set_RevB.pdf"]) {
    const r = rulesExtract(f, await layerOf(f));
    assert.ok(!r.facts.some((x) => /Dynapower|MPS125|Issued for permit/i.test(`${x.value} ${x.evidence}`)), `${f}: ${JSON.stringify(r.facts.map((x) => [x.key, x.value, x.evidence]))}`);
    assert.ok(!r.facts.some((x) => x.key === "equipment.quantity"), "no quantity read from '2 x Dynapower'");
  }
  const c = rulesExtract("SYNTHETIC_Plan_Set_RevC.pdf", await layerOf("SYNTHETIC_Plan_Set_RevC.pdf"));
  assert.equal(c.facts.find((x) => x.key === "revision.label")?.value, "C", "current revision label, not an older row");
  assert.equal(c.facts.find((x) => x.key === "rating.voltage_v")?.value, "600");
});

test("AI grounding drops values quoted only from the revision history and says so", async () => {
  const layer = await layerOf("SYNTHETIC_Plan_Set_RevC.pdf");
  const fact = (key: string, value: string, evidence: string) => ({ key, label: key, value, unit: null, evidence, page: 1, confidence: 0.9, status: "found", note: null });
  const g = groundExtraction({
    requirementId: "plan_set", docTypeConfidence: 0.9, title: "t", documentNumber: null, revisionLabel: "C", effectiveDate: "2026-11-02", manufacturer: null, summary: "", isScannedOrImageBased: false,
    facts: [
      fact("equipment.manufacturer", "Dynapower", "B 2026-01-11 Change inverters to 2 x Dynapower MPS125"),
      fact("equipment.model", "MPS125", "Change inverters to 2 x Dynapower MPS125"),
      fact("equipment.quantity", "2", "2 x Dynapower MPS125"),
      fact("rating.voltage_v", "600", "Rated voltage: 600 VAC"),
      fact("revision.label", "C", "C 2026-11-02 Update ESS-13.0 line diagram for 600 VAC switchgear NSG-4000"),
    ], missingItems: [], warnings: [], embeddedInstructionsDetected: [],
  }, layer, "openai");
  assert.deepEqual(g.facts.map((f) => f.key).sort(), ["rating.voltage_v", "revision.label"]);
  assert.ok(g.warnings.some((w) => /Ignored 3 value\(s\) quoted from the revision history/.test(w)));
});

test("Guardian observations skip revision rows; verified only with a shared identifier, else needs clarification", async () => {
  store.resetStore();
  const site = store.getSite("S-1001")!;
  const bytes = readFileSync("sample-docs/SYNTHETIC_Plan_Set_RevC.pdf");
  const layer = await readTextLayer("application/pdf", bytes);
  const { fileId, sha256 } = store.putFile("SYNTHETIC_Plan_Set_RevC.pdf", "application/pdf", bytes);
  const ex = store.saveExtraction({ siteId: "S-1001", fileId, sha256, fileName: "SYNTHETIC_Plan_Set_RevC.pdf", mediaType: "application/pdf", textLayer: layer.joined, pageCount: layer.pageCount, result: { ...rulesExtract("x", layer), provider: "rules", fallback: false }, impacts: {}, createdBy: PM.userId });
  const { revision } = store.submitRevision("S-1001", { extractionId: ex.id, requirementId: "plan_set" }, PM);
  assert.ok(!observationsFor(revision).some((o) => /Update ESS-13.0/.test(o.evidence)), "revision row not observed");
  // Plan set Rev C (pending) names NSG-4000 at 600 VAC; approved switchgear Rev A is NSG-4000 at 480 VAC → verified.
  const f = findConsistency(site, { view: "candidate" }).findings.find((x) => x.quantity === "voltage" && x.class !== "consistent")!;
  assert.equal(f.class, "verified_discrepancy", f.reason);
  assert.ok(f.a.identifiers.includes("NSG-4000") && f.b.identifiers.includes("NSG-4000"));
});
