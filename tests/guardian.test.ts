// Project Guardian: evidence graph, cross-document consistency, preflight, Time Machine (store level, deterministic).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Session } from "../lib/auth";
import { rulesExtract } from "../lib/extract";
import { classifyPair, findConsistency } from "../lib/guardian/consistency";
import { buildEvidenceGraph, neighborhood } from "../lib/guardian/graph";
import { observationsFor } from "../lib/guardian/observations";
import { runPreflight } from "../lib/guardian/preflight";
import { timeMachine } from "../lib/guardian/timemachine";
import type { Observation } from "../lib/guardian/types";
import { parseEmailHeaders } from "../lib/memory/email";
import { confirmItem, recordCommunication, resolveItem, validateImport } from "../lib/memory/register";
import { rulesAnalyzeCommunication } from "../lib/memory/rules";
import { groundCommunication } from "../lib/memory/schema";
import { readTextLayer } from "../lib/pdf";
import { packageReadiness } from "../lib/release";
import { TEMPLATE_BY_ID } from "../lib/requirements";
import * as store from "../lib/store";

const PM: Session = { userId: "arivera", name: "A. Rivera", role: "eqore", engineer: false, roles: ["eqore"] };
const ENG: Session = { userId: "mchen", name: "M. Chen, PE", role: "eqore", engineer: true, roles: ["eqore", "engineer"] };
const ENG2: Session = { userId: "rpatel", name: "R. Patel, PE", role: "eqore", engineer: true, roles: ["eqore", "engineer"] };
const H = "S-1001";
const code = (fn: () => unknown) => { try { fn(); return 0; } catch (e) { return (e as { status?: number }).status ?? -1; } };

async function file(name: string, requirementId: string, by = PM) {
  const bytes = readFileSync(`sample-docs/${name}`);
  const layer = await readTextLayer("application/pdf", bytes);
  const { fileId, sha256 } = store.putFile(name, "application/pdf", bytes);
  const ex = store.saveExtraction({ siteId: H, fileId, sha256, fileName: name, mediaType: "application/pdf", textLayer: layer.joined, pageCount: layer.pageCount, result: { ...rulesExtract(name, layer), provider: "rules", fallback: false }, impacts: {}, createdBy: by.userId });
  return store.submitRevision(H, { extractionId: ex.id, requirementId }, by);
}
function importEmail(path: string) {
  const body = readFileSync(path, "utf8");
  const h = parseEmailHeaders(body);
  const input = validateImport({ body, channel: "ahj_comment", sender: h.from, sentAt: h.date, subject: h.subject });
  return recordCommunication(H, input, { ...groundCommunication(rulesAnalyzeCommunication(body, { channel: input.channel, sender: input.sender }), body), engine: "rules", fallback: false }, PM);
}
const obs = (o: Partial<Observation>): Observation => ({ id: "x", revisionId: "r", requirementId: "plan_set", revLabel: "A", fileName: "f", quantity: "voltage", value: 0, display: "", equipment: "unknown", identifiers: [], measure: "unspecified", evidence: "e", evidenceKind: "text_layer", evidenceVerified: true, contextReason: "", ...o });

test("context-aware classification: same equipment vs transformer sides vs rating/nominal vs unknown", () => {
  const sgA = obs({ revisionId: "a", equipment: "switchgear", identifiers: ["NSG-4000"], value: 600, measure: "rating" });
  const sgB = obs({ revisionId: "b", equipment: "switchgear", value: 480 });
  assert.equal(classifyPair(sgA, sgB, [])?.class, "needs_clarification", "role match without a shared identifier is not a confirmed conflict");
  assert.equal(classifyPair(sgA, obs({ revisionId: "c", equipment: "switchgear", identifiers: ["NSG-4000"], value: 480 }), [])?.class, "verified_discrepancy", "same identifier, same (unstated) interface");
  assert.equal(classifyPair(sgA, obs({ revisionId: "c", equipment: "switchgear", identifiers: ["NSG-4000"], side: "secondary", value: 480 }), [])?.class, "needs_clarification", "interface stated on one side only");
  const t1p = obs({ equipment: "transformer", identifiers: ["T1"], side: "primary", value: 13200 }), t1s = obs({ equipment: "transformer", identifiers: ["T1"], side: "secondary", value: 600 });
  const service = obs({ equipment: "service", side: "primary", value: 13200 });
  assert.equal(classifyPair(service, sgA, [{ primary: t1p, secondary: t1s }])?.class, "explained_difference", "opposite sides of T1");
  assert.equal(classifyPair(service, sgA, []), undefined, "different equipment without a bridge is not compared");
  assert.equal(classifyPair(t1p, t1s, [])?.class, "explained_difference", "same transformer, different sides");
  assert.equal(classifyPair(sgA, obs({ equipment: "switchgear", value: 480, measure: "nominal" }), [])?.class, "explained_difference", "600 V rating ≥ 480 V nominal");
  assert.equal(classifyPair(obs({ equipment: "switchgear", value: 480, measure: "rating" }), obs({ equipment: "switchgear", value: 600, measure: "nominal" }), [])?.class, "potential_inconsistency");
  assert.equal(classifyPair(sgA, obs({ value: 480 }), [])?.class, "insufficient_evidence");
  assert.equal(classifyPair(sgA, obs({ equipment: "switchgear", value: 600 }), [])?.class, "consistent");
});

test("observations read equipment/side/ids from the PDF text layer and ignore revision-history lines", async () => {
  const bytes = readFileSync("sample-docs/SYNTHETIC_Interconnection_Application_RevB.pdf");
  const layer = await readTextLayer("application/pdf", bytes);
  const o = observationsFor({ id: "ix", siteId: H, requirementId: "ix_application", revLabel: "B", version: 2, fileName: "ix.pdf", sha256: "", source: "eqore", uploadedBy: "", uploadedAt: "", effectiveDate: "", status: "in_review", facts: [], textLayer: layer.joined });
  const t = o.filter((x) => x.equipment === "transformer");
  assert.deepEqual(t.map((x) => [x.value, x.side]), [[13200, "primary"], [600, "secondary"]]);
  const sg = o.find((x) => x.equipment === "switchgear")!;
  assert.ok(sg.identifiers.includes("NSG-4000")); assert.equal(sg.side, "secondary"); assert.equal(sg.value, 600);
  assert.equal(o.find((x) => x.equipment === "service")?.value, 13200);
  const swB = readFileSync("sample-docs/SYNTHETIC_Switchgear_Spec_RevB.pdf");
  const l2 = await readTextLayer("application/pdf", swB);
  const o2 = observationsFor({ id: "sw", siteId: H, requirementId: "switchgear_datasheet", revLabel: "B", version: 2, fileName: "sw.pdf", sha256: "", source: "supplier", uploadedBy: "", uploadedAt: "", effectiveDate: "", status: "in_review", facts: [{ key: "equipment.model", label: "Model", value: "NSG-4000", confidence: 1 }], textLayer: l2.joined });
  assert.ok(!o2.some((x) => /Voltage class revised/.test(x.evidence)), "revision history line ignored");
  assert.deepEqual(o2.map((x) => [x.quantity, x.value, x.page]), [["voltage", 600, 2], ["current", 400, 2], ["interrupting", 65000, 2]]);
});

test("Guardian demo: R1 → AHJ email → switchgear Rev B vs plan set → preflight → blocked → human resolution → R2 → Time Machine", async () => {
  store.resetStore();
  const site = store.getSite(H)!;
  const ahj = TEMPLATE_BY_ID.ahj_permit;
  const r1 = store.getReleases(H).find((r) => r.templateId === "ahj_permit" && r.number === 1)!;
  const r1Sha = r1.snapshot!.sha256;

  // 2–3. AHJ email → confirmed requirement
  const { communication, items } = importEmail("sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt");
  const req = items.find((i) => i.requirementId === "ventilation_plan")!;
  confirmItem(H, req.id, PM, { note: "Applies to the permit resubmission", blocking: true, templateIds: ["ahj_permit"] });

  // 4–5. Revised switchgear spec (pending) compared with the related plan set
  const sw = await file("SYNTHETIC_Switchgear_Spec_RevB.pdf", "switchgear_datasheet");
  const cand = findConsistency(site, { view: "candidate" }).findings;
  const disc = cand.find((f) => f.class === "needs_clarification" && f.quantity === "voltage")!;
  assert.ok(disc, "pending Rev B 600 V (NSG-4000) vs plan set “480 VAC AC disconnect” (no identifier) → needs clarification");
  assert.match(disc.reason, /do not share an equipment identifier/);
  assert.equal(disc.a.revisionId, sw.revision.id); assert.equal(disc.b.requirementId, "plan_set");
  assert.match(disc.a.evidence, /600 VAC/); assert.equal(disc.a.page, 2); assert.match(disc.b.evidence, /480 VAC AC disconnect/);
  assert.equal(findConsistency(site, { view: "approved" }).findings.filter((f) => f.class === "verified_discrepancy" || f.class === "needs_clarification").length, 0, "approved set is still consistent");

  // 6. Preflight (read-only): blockers with evidence + consistency warning with BOTH documents' evidence
  const before = JSON.stringify(site);
  let pf = await runPreflight(site, "ahj_permit", store.getReleases(H));
  assert.equal(JSON.stringify(site), before, "preflight does not mutate project state");
  assert.equal(pf.canBuild, false);
  const missing = pf.findings.find((f) => f.blocking && f.category === "missing_document" && f.title.includes("Ventilation"))!;
  assert.equal(missing.evidence[0].kind, "communication"); assert.equal(missing.evidence[0].sourceId, communication.id);
  assert.deepEqual(missing.chain.map((c) => c.type), ["communication", "memory_item", "document_family", "template"]);
  assert.ok(pf.findings.some((f) => f.blocking && f.category === "pending_review"));
  const warn = pf.findings.find((f) => f.id === disc.id)!;
  assert.equal(warn.severity, "warning"); assert.equal(warn.blocking, false); assert.equal(warn.evidence.length, 2);
  assert.ok(warn.affectedFiles.some((x) => x.requirementId === "plan_set") && warn.affectedFiles.some((x) => x.requirementId === "switchgear_datasheet"));
  assert.ok(pf.findings.some((f) => f.category === "change_since_release"), "pending Rev B shown as a change since R1");

  // 7. Approve Rev B → discrepancy becomes part of the engineer review; release blocked
  const dec = store.decideReview(sw.review.id, "approve", ENG, "Rev B 600 VAC confirmed with supplier (synthetic)");
  const planTask = site.engTasks!.find((t) => t.status === "open" && t.dependentRequirementId === "plan_set")!;
  assert.deepEqual(dec.consistency?.attached, [planTask.id]); assert.ok(planTask.findingIds?.includes(disc.id));
  pf = await runPreflight(site, "ahj_permit", store.getReleases(H));
  const dep = pf.findings.find((f) => f.blocking && f.category === "dependency")!;
  assert.match(dep.title, /cross-document check: 480 VAC vs 600 VAC/);
  assert.ok(dep.evidence.some((e) => e.quote?.includes("480 VAC AC disconnect")) && dep.evidence.some((e) => e.quote?.includes("600 VAC")));
  assert.deepEqual(dep.chain.map((c) => c.type), ["revision", "finding", "engineering_task", "revision", "template"]);
  let ready = packageReadiness(site, TEMPLATE_BY_ID.ahj_permit);
  assert.equal(code(() => store.buildRelease(H, "ahj_permit", ENG, "should be blocked", ready.token)), 409);

  // 8. Authorized human resolution: plan set Rev C (600 V) approved resolving the review; ventilation plan approved + requirement resolved
  const pc = await file("SYNTHETIC_Plan_Set_RevC.pdf", "plan_set");
  assert.equal(code(() => store.decideReview(pc.review.id, "approve", PM, "PM cannot approve", [planTask.id])), 403);
  store.decideReview(pc.review.id, "approve", ENG2, "ESS-13.0 updated to 600 VAC NSG-4000 (synthetic)", [planTask.id]);
  assert.equal(planTask.status, "resolved");
  assert.equal(findConsistency(site, { view: "approved" }).findings.filter((f) => f.class === "verified_discrepancy" || f.class === "needs_clarification").length, 0, "documents now consistent");
  const vent = await file("SYNTHETIC_Ventilation_Plan_RevA.pdf", "ventilation_plan");
  store.decideReview(vent.review.id, "approve", ENG, "Ventilation plan reviewed (synthetic)");
  assert.equal(code(() => resolveItem(H, req.id, PM, { note: "pm" })), 403);
  resolveItem(H, req.id, ENG2, { note: "Rev A answers Fire comment 1" });

  // 9. Release 2; Release 1 preserved
  ready = packageReadiness(site, ahj);
  assert.equal(ready.canBuild, true, JSON.stringify(ready.issues.map((i) => i.message)));
  const r2 = store.buildRelease(H, "ahj_permit", ENG2, "R2: switchgear Rev B, plan set Rev C, ventilation plan", ready.token);
  assert.equal(r2.number, 2);
  assert.equal(store.getReleases(H).find((r) => r.id === r1.id)!.snapshot!.sha256, r1Sha);
  assert.ok(store.verifyRelease(r1));

  // 10. Time Machine R1 vs current
  const tm = timeMachine(site, r1);
  assert.equal(tm.release.integrityVerified, true);
  const swChange = tm.replacedDocuments.find((d) => d.requirementId === "switchgear_datasheet")!;
  assert.equal(swChange.releasedRev, "A"); assert.equal(swChange.currentRev, "B");
  assert.ok(swChange.factChanges.some((c) => c.significance === "material" && /480/.test(c.before ?? "") && /600/.test(c.after ?? "")));
  assert.ok(tm.replacedDocuments.some((d) => d.requirementId === "plan_set" && d.currentRev === "C"));
  assert.ok(tm.addedChecklistDocuments.some((d) => d.requirementId === "ventilation_plan"));
  assert.ok(tm.newRequirements.some((m) => m.memoryItemId === req.id));
  assert.ok(tm.newEngineeringTasks.some((t) => t.id === planTask.id));
  assert.ok(tm.resolvedSinceRelease.some((x) => x.id === req.id));
  assert.equal(tm.freshSubmissionRecommended, true);
  assert.ok(tm.attentionReasons.some((r) => /Rev B is now approved with material changes/.test(r)));
  const tm2 = timeMachine(site, r2);
  assert.equal(tm2.freshSubmissionRecommended, false, "nothing changed since R2");

  // Evidence graph keeps provenance for every link
  const g = buildEvidenceGraph(site, store.getReleases(H), findConsistency(site, { view: "candidate" }).findings);
  const e = g.edges.find((x) => x.type === "proposes" && x.to === `mem:${req.id}`)!;
  assert.equal(e.from, `com:${communication.id}`); assert.match(e.evidence!, /updated ventilation plan/); assert.ok(e.at && e.sourceIds.includes(communication.id));
  assert.ok(g.edges.some((x) => x.type === "satisfied_by" && x.from === `mem:${req.id}` && x.to === `rev:${vent.revision.id}`));
  assert.ok(g.edges.some((x) => x.type === "pins" && x.from === `rel:${r2.id}` && x.to === `rev:${pc.revision.id}`));
  assert.ok(g.edges.some((x) => x.type === "resolved_by" && x.from === `task:${planTask.id}`));
  assert.ok(g.edges.every((x) => x.reason && x.sourceIds.length));
  const nb = neighborhood(g, `mem:${req.id}`, 1);
  assert.ok(nb.nodes.some((n) => n.id === `com:${communication.id}`));
});

test("negative: 13,200 V utility side vs 600 V switchgear across transformer T1 is NOT a conflict", async () => {
  store.resetStore();
  const site = store.getSite(H)!;
  const sw = await file("SYNTHETIC_Switchgear_Spec_RevB.pdf", "switchgear_datasheet");
  store.decideReview(sw.review.id, "approve", ENG, "Rev B approved (synthetic)");
  await file("SYNTHETIC_Interconnection_Application_RevB.pdf", "ix_application");
  const f = findConsistency(site, { view: "candidate" }).findings.filter((x) => [x.a.requirementId, x.b.requirementId].sort().join() === "ix_application,switchgear_datasheet");
  assert.ok(f.length > 0, "the pair was compared");
  assert.ok(f.every((x) => x.class === "explained_difference" || x.class === "consistent"), JSON.stringify(f.map((x) => [x.class, x.reason])));
  const t1 = f.find((x) => x.class === "explained_difference" && /opposite sides of T1/.test(x.reason))!;
  assert.ok(t1, "explained by transformer T1 with evidence");
  assert.ok(f.some((x) => x.class === "consistent" && x.a.identifiers.includes("NSG-4000")), "600 V on T1 secondary matches the switchgear rating");
  const pf = await runPreflight(site, "interconnection", store.getReleases(H));
  assert.ok(!pf.findings.some((x) => x.category === "consistency" && x.consistencyClass === "verified_discrepancy" && x.affectedFiles.some((a) => a.requirementId === "ix_application") && x.affectedFiles.some((a) => a.requirementId === "switchgear_datasheet")));
  assert.ok(pf.findings.some((x) => x.consistencyClass === "explained_difference" && x.blocking === false));
});

test("AI cannot create gating: preflight with ai=true and no key reports 'unavailable' and identical blockers", async () => {
  store.resetStore();
  const site = store.getSite(H)!;
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const a = await runPreflight(site, "interconnection", store.getReleases(H), { ai: true });
    const b = await runPreflight(site, "interconnection", store.getReleases(H));
    assert.equal(a.consistency.ai, "unavailable");
    assert.deepEqual(a.findings.filter((f) => f.blocking).map((f) => f.title), b.findings.filter((f) => f.blocking).map((f) => f.title));
    assert.equal(a.canBuild, packageReadiness(site, TEMPLATE_BY_ID.interconnection).canBuild);
  } finally { if (saved) process.env.OPENAI_API_KEY = saved; }
});
