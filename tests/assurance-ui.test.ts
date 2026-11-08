// Frontend view models over the merged backend (Project Memory + Guardian): gate issues, findings, register, traversal.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Session } from "../lib/auth";
import { buildEvidenceGraph } from "../lib/guardian/graph";
import { findConsistency } from "../lib/guardian/consistency";
import { runPreflight } from "../lib/guardian/preflight";
import { pathTo, traverse } from "../lib/graph-traversal";
import { parseEmailHeaders } from "../lib/memory/email";
import { confirmItem, recordCommunication, validateImport } from "../lib/memory/register";
import { rulesAnalyzeCommunication } from "../lib/memory/rules";
import { groundCommunication } from "../lib/memory/schema";
import { packageReadiness } from "../lib/release";
import { TEMPLATE_BY_ID } from "../lib/requirements";
import * as store from "../lib/store";
import { documentRegister, findings, readiness, todayMetrics } from "../lib/workspace";

const PM: Session = { userId: "kaushik", name: "Kaushik Joshi", role: "eqore", engineer: false, roles: ["eqore"] };
const SUP: Session = { userId: "supplier", name: "Supplier", role: "supplier", engineer: false, roles: ["supplier"] };
const H = "S-1001";
const EMAIL = readFileSync("sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt", "utf8");

function importEmail() {
  const h = parseEmailHeaders(EMAIL);
  const input = validateImport({ body: EMAIL, channel: "ahj_comment", sender: h.from, sentAt: h.date, subject: h.subject });
  const analysis = { ...groundCommunication(rulesAnalyzeCommunication(EMAIL, { channel: input.channel, sender: input.sender }), EMAIL), engine: "rules" as const, fallback: false };
  return recordCommunication(H, input, analysis, PM);
}

test("readiness view mirrors the backend gate exactly, including Project Memory blockers", () => {
  store.resetStore();
  const site = store.getSite(H)!;
  const before = readiness(H, "ahj_permit")!;
  assert.equal(before.canBuild, packageReadiness(site, TEMPLATE_BY_ID.ahj_permit).canBuild);
  assert.equal(before.issues.length, 0);

  const { items } = importEmail();
  const vent = items.find((m) => m.requirementId === "ventilation_plan");
  assert.ok(vent, "rules analyzer proposes the ventilation-plan requirement");
  // A suggestion is advisory: never a blocker.
  const sugg = readiness(H, "ahj_permit")!;
  assert.equal(sugg.canBuild, true, "unconfirmed suggestion does not block");
  assert.ok(sugg.advisories.some((a) => a.memoryItemId === vent!.id));

  confirmItem(H, vent!.id, PM, { note: "Fire marshal requires it for the permit", blocking: true, templateIds: ["ahj_permit"], requirementId: "ventilation_plan" });
  const after = readiness(H, "ahj_permit")!;
  const gate = packageReadiness(site, TEMPLATE_BY_ID.ahj_permit);
  assert.equal(after.canBuild, false);
  assert.equal(after.token, gate.token, "same token as the backend gate");
  assert.deepEqual(after.issues.map((i) => i.code), gate.issues.map((i) => i.code), "every gate issue is surfaced, none added");
  const miss = after.issues.find((i) => i.requirementId === "ventilation_plan")!;
  assert.equal(miss.code, "MISSING_DOCUMENT");
  assert.equal(miss.sourceKind, "project_memory");
  assert.ok(miss.evidenceRefs.some((e) => e.communication && e.quote), "evidence points at the stored communication quote");
  assert.equal(after.status, "blocked");
});

test("register and findings pick up dynamic requirements; internal memory hidden from suppliers", () => {
  // continues from the previous test's store state (confirmed ventilation requirement)
  const row = documentRegister(H).find((r) => r.requirementId === "ventilation_plan");
  assert.ok(row, "on-demand document type appears once a confirmed requirement asks for it");
  assert.equal(row!.status, "missing");
  assert.ok(row!.inPackage.length > 0);
  const pm = findings(PM).filter((f) => f.type === "ahj_requirement");
  assert.ok(pm.some((f) => f.lifecycle === "action_required" && f.memory?.status === "confirmed"));
  assert.ok(pm.some((f) => f.lifecycle === "needs_confirmation"), "remaining suggestions need confirmation");
  assert.equal(findings(SUP).filter((f) => f.type === "ahj_requirement").length, 0, "suppliers never see internal correspondence");
});

test("missing-document metric counts unique (project, document) pairs", () => {
  const m = todayMetrics();
  const unique = new Set(store.getSites().flatMap((s) => documentRegister(s.id).filter((r) => r.status === "missing").map((r) => `${s.id}:${r.requirementId}`)));
  assert.equal(m.missingNow, unique.size);
  assert.ok(m.neededLater > 0, "future-stage requirements are counted separately");
});

test("preflight blockers equal gate issues (frontend shows them unchanged)", async () => {
  const site = store.getSite(H)!;
  const r = await runPreflight(site, "ahj_permit", store.getReleases(H), { ai: false });
  assert.equal(r.findings.filter((f) => f.blocking).length, readiness(H, "ahj_permit")!.issues.length);
});

test("graph traversal is deterministic BFS over backend edges", () => {
  const site = store.getSite(H)!;
  const g = buildEvidenceGraph(site, store.getReleases(H), findConsistency(site, { view: "candidate" }).findings);
  const mem = g.nodes.find((n) => n.type === "memory_item" && n.label.toLowerCase().includes("ventilation"))!;
  assert.ok(mem);
  const t1 = traverse(g, mem.id), t2 = traverse(g, mem.id);
  assert.deepEqual(t1.downstream.map((r) => r.id), t2.downstream.map((r) => r.id), "same input → same order");
  assert.ok(t1.upstream.some((r) => r.id.startsWith("com:")), "upstream reaches the source communication");
  assert.ok(t1.downstream.some((r) => r.id === "fam:ventilation_plan"), "downstream reaches the required document");
  assert.ok(t1.downstream.some((r) => r.id === "tpl:ahj_permit"), "downstream reaches the package");
  const edgeIds = new Set(g.edges.map((e) => e.id));
  for (const r of [...t1.upstream, ...t1.downstream]) assert.ok(edgeIds.has(r.via.id), "every reach uses a real backend edge");
  const path = pathTo(t1, "tpl:ahj_permit");
  assert.equal(path.at(-1)!.id, "tpl:ahj_permit");
});
