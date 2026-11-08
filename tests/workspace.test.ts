// Project Assurance view models: CSV seed, stage applicability, findings, review queue, readiness.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session } from "../lib/auth";
import { parseCsv } from "../lib/demo-data";
import * as store from "../lib/store";
import { documentRegister, findings, readiness, reviewQueue, todayMetrics } from "../lib/workspace";

const PM: Session = { userId: "kaushik", name: "Kaushik Joshi", role: "eqore", engineer: false, roles: ["eqore"] };

test("CSV parser handles quotes, commas and escaped quotes", () => {
  const rows = parseCsv('a,b,c\n1,"x, y","say ""hi"""\r\n2,,\n');
  assert.deepEqual(rows, [{ a: "1", b: "x, y", c: 'say "hi"' }, { a: "2", b: "", c: "" }]);
});

test("seeded portfolio comes from data/demo CSVs and metrics derive from the store", () => {
  store.resetStore();
  const m = todayMetrics();
  assert.deepEqual(m.projects.map((p) => p.id), ["S-1001", "S-1002", "S-1003", "S-1004", "S-1005"]);
  assert.equal(m.documentsReceived, store.getSites().reduce((n, s) => n + s.documents.length, 0));
  assert.equal(m.pendingReviews, store.getReviews().filter((r) => r.status === "open").length);
  // Seeded review for Harbor battery Rev B carries a real comparison against Rev A.
  const harbor = reviewQueue(PM).find((r) => r.id === "RV-S-1004-battery_datasheet-rB")!;
  assert.equal(harbor.materialCount, 1);
  assert.ok(harbor.evidenceNew?.fileId, "seeded review document has real synthetic PDF bytes");
});

test("requirements later than the project stage are 'not yet required', never missing", () => {
  store.resetStore();
  const reg = documentRegister("S-1001");
  // cx_report: commissioning stage, nothing on file (the hero's O&M manual is seeded early for the lifecycle demo).
  assert.equal(reg.find((r) => r.requirementId === "cx_report")!.status, "not_yet_required");
  assert.equal(reg.find((r) => r.requirementId === "utility_bill")!.status, "missing");
  assert.equal(reg.find((r) => r.requirementId === "switchgear_datasheet")!.status, "approved");
  const f = findings(PM);
  assert.ok(f.some((x) => x.id === "MISS-S-1001-utility_bill"));
  assert.ok(!f.some((x) => x.type === "missing_document" && x.projectId === "S-1001" && x.requirementId === "cx_report"));
});

test("readiness only counts the package's own requirements", () => {
  store.resetStore();
  const ahj = readiness("S-1001", "ahj_permit")!;
  assert.equal(ahj.status, "ready", "missing utility bill is not part of the AHJ package");
  assert.equal(ahj.releases[0].number, 1);
  const ix = readiness("S-1001", "interconnection")!;
  assert.equal(ix.status, "blocked");
  assert.ok(ix.items.find((i) => i.requirementId === "utility_bill")!.href.startsWith("/inbox?project=S-1001&expect=utility_bill"));
});

// Regression (demo crash, digest 1164880037): after the requested document is APPROVED but the confirmed requirement is
// not yet resolved, the gate reports needs_eng_review WITHOUT an engineering task. The view must not assume tasks[0].
test("approved requested document with an unresolved confirmed requirement renders (no tasks[0] crash)", async () => {
  store.resetStore();
  const { readFileSync } = await import("node:fs");
  const { readTextLayer } = await import("../lib/pdf");
  const { rulesExtract } = await import("../lib/extract");
  const { parseEmailHeaders } = await import("../lib/memory/email");
  const { confirmItem, recordCommunication, validateImport } = await import("../lib/memory/register");
  const { rulesAnalyzeCommunication } = await import("../lib/memory/rules");
  const { groundCommunication } = await import("../lib/memory/schema");
  const ENG: Session = { userId: "rpatel", name: "R. Patel, PE", role: "eqore", engineer: true, roles: ["eqore", "engineer"] };
  const body = readFileSync("sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt", "utf8");
  const h = parseEmailHeaders(body);
  const input = validateImport({ body, channel: "ahj_comment", sender: h.from, sentAt: h.date, subject: h.subject });
  const { items } = recordCommunication("S-1001", input, { ...groundCommunication(rulesAnalyzeCommunication(body, { channel: input.channel, sender: input.sender }), body), engine: "rules", fallback: false }, PM);
  const req = items.find((i) => i.requirementId === "ventilation_plan")!;
  confirmItem("S-1001", req.id, PM, { note: "Applies to the permit resubmission", blocking: true, templateIds: ["ahj_permit"] });
  const bytes = readFileSync("sample-docs/SYNTHETIC_Ventilation_Plan_RevA.pdf");
  const layer = await readTextLayer("application/pdf", bytes);
  const { fileId, sha256 } = store.putFile("vent.pdf", "application/pdf", bytes);
  const ex = store.saveExtraction({ siteId: "S-1001", fileId, sha256, fileName: "vent.pdf", mediaType: "application/pdf", textLayer: layer.joined, pageCount: layer.pageCount, result: { ...rulesExtract("vent.pdf", layer), provider: "rules", fallback: false }, impacts: {}, createdBy: PM.userId });
  const sub = store.submitRevision("S-1001", { extractionId: ex.id, requirementId: "ventilation_plan" }, PM);
  store.decideReview(sub.review.id, "approve", ENG, "Ventilation plan reviewed (synthetic)");
  const r = readiness("S-1001", "ahj_permit")!;
  const vent = r.items.find((i) => i.requirementId === "ventilation_plan")!;
  assert.equal(vent.state, "needs_eng_review");
  assert.equal(vent.action, "Resolve requirement");
  assert.match(vent.href, new RegExp(`/memory\\?project=S-1001&type=ahj_requirement&item=${encodeURIComponent(req.id)}`));
  assert.doesNotThrow(() => reviewQueue(ENG));
});
