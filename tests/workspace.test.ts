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
