// HTTP end-to-end for Project Guardian against the BUILT app (npm run build first). Own server on :3104, temp data dir.
// The mandatory demo: R1 → AHJ email → confirmed requirement → switchgear Rev B vs plan set → Preflight →
// blocked → authorized resolution → R2 (R1 preserved) → Time Machine; plus the transformer negative test.
//   node scripts/e2e-guardian.mjs                       # deterministic (no network)
//   E2E_PROVIDER=openai node scripts/e2e-guardian.mjs   # real OpenAI: email + PDF extraction + advisory AI review
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 3104, BASE = `http://127.0.0.1:${PORT}`, H = "S-1001";
const provider = process.env.E2E_PROVIDER || "rules";
const useAi = provider === "openai";
const dataDir = mkdtempSync(join(tmpdir(), "releaseos-guardian-"));
const env = { ...process.env, AI_PROVIDER: provider, RELEASEOS_DATA_DIR: dataDir, SESSION_SECRET: "e2e-guardian-session-secret-0123456789" };
const sha = (b) => createHash("sha256").update(b).digest("hex");
let step = 0;
const ok = (m) => console.log(`  ✓ ${String(++step).padStart(2, "0")} ${m}`);

let app;
async function start() {
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env, stdio: ["ignore", "ignore", "inherit"] });
  for (let i = 0; i < 80; i++) { try { await fetch(`${BASE}/api/session`); return; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  throw new Error("server did not start");
}
const stop = () => new Promise((r) => { app.once("exit", r); app.kill(); });
async function login(userId, passcode) {
  const r = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, passcode }) });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}
const call = async (path, { cookie, method = "GET", json, form } = {}) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(json ? { "Content-Type": "application/json" } : {}) }, body: json ? JSON.stringify(json) : form });
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, body: ct.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};
async function upload(cookie, name, requirementId) {
  const bytes = readFileSync(`sample-docs/${name}`);
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: "application/pdf" }), name); fd.append("siteId", H);
  const ex = (await call("/api/extract", { cookie, method: "POST", form: fd })).body;
  assert.equal(ex.ok, true, ex.error); assert.equal(ex.sha256, sha(bytes));
  const r = await call(`/api/sites/${H}/revisions`, { cookie, method: "POST", json: { extractionId: ex.extractionId, requirementId } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...r.body, ex };
}
const preflight = async (cookie, templateId, ai = false) => {
  const r = await call(`/api/sites/${H}/preflight`, { cookie, method: "POST", json: { templateId, ai } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.report;
};
const show = (f) => `[${f.severity}] ${f.title.slice(0, 120)}`;

console.log(`Project Guardian E2E (${provider}) — data dir ${dataDir}`);
try {
  await start();
  const pm = await login("arivera", "eqore855"), eng = await login("mchen", "eng856"), eng2 = await login("rpatel", "eng855"), sup = await login("supplier", "supp855");
  assert.equal((await call("/api/reset", { cookie: pm, method: "POST" })).status, 200);

  // 1. Approved Release 1
  const r1Id = `${H}-ahj_permit-R1`;
  const r1zip = (await call(`/api/releases/${r1Id}/download`, { cookie: pm })).body;
  let pf = await preflight(pm, "ahj_permit");
  assert.equal(pf.canBuild, true);
  ok(`R1 approved and current; preflight clear (${pf.consistency.checkedPairs} related pairs checked, ${pf.consistency.byClass.consistent} consistent)`);
  assert.equal((await call(`/api/sites/${H}/preflight`, { cookie: sup, method: "POST", json: { templateId: "ahj_permit" } })).status, 403);
  assert.equal((await call(`/api/sites/${H}/preflight`, { method: "POST", json: { templateId: "ahj_permit" } })).status, 401);
  ok("preflight requires an EQORE session (supplier 403, anonymous 401)");

  // 2–3. AHJ email → confirmed requirement
  let r = await call(`/api/sites/${H}/communications`, { cookie: pm, method: "POST", json: { body: readFileSync("sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt", "utf8"), channel: "ahj_comment" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const com = r.body.communication;
  const req = r.body.items.find((i) => i.requirementId === "ventilation_plan");
  assert.ok(req);
  r = await call(`/api/sites/${H}/memory/${req.id}`, { cookie: pm, method: "POST", json: { action: "confirm", note: "Applies to the permit resubmission", blocking: true, templateIds: ["ahj_permit"], requiresUpdatedRevision: true } });
  assert.equal(r.status, 200);
  ok(`AHJ email imported (${com.analysis.engine}${com.analysis.model ? ` ${com.analysis.model}` : ""}); “${req.title}” confirmed by A. Rivera`);

  // 4. Revised switchgear specification (pending)
  const sw = await upload(pm, "SYNTHETIC_Switchgear_Spec_RevB.pdf", "switchgear_datasheet");
  const planTask = sw.engineeringTasks.find((t) => t.dependentRequirementId === "plan_set");
  ok(`switchgear Rev B uploaded (${sw.ex.engine}) and filed for review; dependency review raised on the plan set`);

  // 5–6. Preflight compares it with the related drawing
  pf = await preflight(pm, "ahj_permit", useAi);
  const disc = pf.findings.find((f) => f.consistencyClass === "needs_clarification" && f.affectedFiles.some((a) => a.requirementId === "plan_set"));
  assert.ok(disc, pf.findings.map(show).join("\n"));
  assert.equal(disc.evidence.length, 2);
  assert.ok(disc.evidence.some((e) => /600 VAC/.test(e.quote)) && disc.evidence.some((e) => /480 VAC AC disconnect/.test(e.quote)));
  ok(`cross-document check: ${disc.title.slice(0, 150)}`);
  console.log(`       evidence A: “${disc.evidence[0].quote}” — ${disc.evidence[0].label}`);
  console.log(`       evidence B: “${disc.evidence[1].quote}” — ${disc.evidence[1].label}`);
  if (useAi) {
    assert.equal(pf.consistency.ai, "openai", pf.consistency.aiNote);
    assert.match(disc.detail, /AI review \(/, pf.consistency.aiNote ?? "no AI review attached");
    ok(`advisory AI review attached (gating unchanged): ${disc.detail.slice(disc.detail.indexOf("AI review"), disc.detail.indexOf("AI review") + 170)}…`);
  }
  const blockers = pf.findings.filter((f) => f.blocking);
  const miss = blockers.find((f) => f.category === "missing_document" && /Ventilation/.test(f.title));
  assert.ok(miss && miss.evidence[0].sourceId === com.id && miss.chain.length >= 3);
  assert.ok(blockers.some((f) => f.category === "pending_review"));
  ok(`Preflight: ${pf.counts.blocker} blockers, ${pf.counts.warning} warnings, ${pf.counts.info} info`);
  for (const f of pf.findings.slice(0, 8)) console.log(`       ${show(f)}`);
  console.log(`       chain: ${miss.chain.map((c) => c.label).join(" → ")}`);

  // 7. Release creation blocked
  const pkgs = (await call(`/api/sites/${H}/releases`, { cookie: eng })).body.packages;
  assert.equal((await call(`/api/sites/${H}/releases`, { cookie: eng, method: "POST", json: { templateId: "ahj_permit", note: "attempt while blocked", readinessToken: pkgs.find((p) => p.templateId === "ahj_permit").token } })).status, 409);
  ok("release creation blocked (409)");

  // 8. Authorized human resolution
  r = await call(`/api/reviews/${sw.review.id}`, { cookie: eng, method: "POST", json: { decision: "approve", note: "Rev B 600 VAC confirmed with supplier (synthetic)" } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.consistency.attached, [planTask.id]);
  pf = await preflight(pm, "ahj_permit");
  const dep = pf.findings.find((f) => f.blocking && f.category === "dependency" && /cross-document check/.test(f.title));
  assert.ok(dep && dep.evidence.filter((e) => e.kind === "document").length === 2);
  ok(`Rev B approved by M. Chen, PE → discrepancy attached to engineer review ${planTask.id}: ${dep.title.slice(0, 110)}`);
  const pc = await upload(pm, "SYNTHETIC_Plan_Set_RevC.pdf", "plan_set");
  assert.equal((await call(`/api/reviews/${pc.review.id}`, { cookie: pm, method: "POST", json: { decision: "approve", note: "pm", resolveTaskIds: [planTask.id] } })).status, 403);
  r = await call(`/api/reviews/${pc.review.id}`, { cookie: eng2, method: "POST", json: { decision: "approve", note: "ESS-13.0 updated to 600 VAC NSG-4000 (synthetic)", resolveTaskIds: [planTask.id] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const vent = await upload(pm, "SYNTHETIC_Ventilation_Plan_RevA.pdf", "ventilation_plan");
  assert.equal((await call(`/api/reviews/${vent.review.id}`, { cookie: eng, method: "POST", json: { decision: "approve", note: "Ventilation plan reviewed (synthetic)" } })).status, 200);
  assert.equal((await call(`/api/sites/${H}/memory/${req.id}`, { cookie: pm, method: "POST", json: { action: "resolve", note: "pm" } })).status, 403);
  assert.equal((await call(`/api/sites/${H}/memory/${req.id}`, { cookie: eng2, method: "POST", json: { action: "resolve", note: "Rev A answers Fire comment 1" } })).status, 200);
  pf = await preflight(eng2, "ahj_permit");
  assert.equal(pf.canBuild, true, pf.findings.filter((f) => f.blocking).map(show).join("\n"));
  assert.equal(pf.findings.filter((f) => (f.consistencyClass === "verified_discrepancy" || f.consistencyClass === "needs_clarification") && !/Reviewed by an engineer/.test(f.title)).length, 0);
  ok("plan set Rev C (600 VAC) approved resolving the review (PM 403); ventilation plan approved; requirement resolved by R. Patel, PE (PM 403); preflight clear");

  // 9. Release 2; Release 1 preserved
  r = await call(`/api/sites/${H}/releases`, { cookie: eng2, method: "POST", json: { templateId: "ahj_permit", note: "R2: switchgear Rev B, plan set Rev C, ventilation plan", readinessToken: pf.token } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const r2 = r.body.release;
  assert.ok(["switchgear_datasheet", "plan_set", "ventilation_plan"].every((rid) => r2.items.some((i) => i.requirementId === rid)));
  const r1again = (await call(`/api/releases/${r1Id}/download`, { cookie: pm })).body;
  assert.ok(r1again.equals(r1zip));
  ok(`Release ${r2.id} built (snapshot ${r2.snapshotSha256.slice(0, 12)}…); R1 ZIP byte-identical (sha ${sha(r1zip).slice(0, 12)}…)`);

  // 10. Time Machine
  const tm = (await call(`/api/sites/${H}/timemachine?releaseId=${r1Id}`, { cookie: pm })).body.report;
  assert.equal(tm.release.integrityVerified, true); assert.equal(tm.freshSubmissionRecommended, true);
  assert.ok(tm.replacedDocuments.some((d) => d.requirementId === "switchgear_datasheet" && d.currentRev === "B"));
  assert.ok(tm.addedChecklistDocuments.some((d) => d.requirementId === "ventilation_plan"));
  assert.ok(tm.newRequirements.some((m) => m.memoryItemId === req.id));
  ok(`Time Machine R1 → today (integrity verified): ${tm.attentionReasons.length} reasons`);
  for (const reason of tm.attentionReasons) console.log(`       • ${reason}`);
  const tm2 = (await call(`/api/sites/${H}/timemachine?releaseId=${encodeURIComponent(r2.id)}`, { cookie: pm })).body.report;
  assert.equal(tm2.freshSubmissionRecommended, false);
  ok("Time Machine R2 → today: nothing changed");

  // Negative test: opposite sides of transformer T1
  const ix = await upload(pm, "SYNTHETIC_Interconnection_Application_RevB.pdf", "ix_application");
  pf = await preflight(pm, "interconnection", useAi);
  const pair = pf.findings.filter((f) => f.category === "consistency" && f.affectedFiles.some((a) => a.revisionId === ix.revision.id) && f.affectedFiles.some((a) => a.requirementId === "switchgear_datasheet"));
  assert.ok(pair.length && pair.every((f) => f.consistencyClass === "explained_difference"), pair.map(show).join("\n"));
  assert.ok(pair.some((f) => /opposite sides of T1/.test(f.detail)));
  ok(`negative test: 13,200 V utility vs 600 V switchgear → ${pair[0].consistencyClass} — ${pair.find((f) => /opposite sides/.test(f.detail)).detail.slice(0, 150)}`);

  // Evidence graph + pages
  const g = (await call(`/api/sites/${H}/graph?focus=${encodeURIComponent(`mem:${req.id}`)}&depth=1`, { cookie: pm })).body.graph;
  const e = g.edges.find((x) => x.type === "proposes");
  assert.ok(e && e.from === `com:${com.id}` && e.evidence && e.at);
  assert.ok(g.edges.some((x) => x.type === "satisfied_by" && x.to === `rev:${vent.revision.id}`));
  ok(`evidence graph: ${g.nodes.length} nodes / ${g.edges.length} edges around the requirement (email → requirement → ventilation plan Rev A, with quotes and timestamps)`);

  await stop(); await start();
  const pm2 = await login("arivera", "eqore855");
  const pfAfter = await preflight(pm2, "ahj_permit");
  assert.equal(pfAfter.lastRelease.number, 2);
  for (const p of [`/sites/${H}/guardian`, `/sites/${H}`, `/sites/${H}/memory`]) assert.equal((await call(p, { cookie: pm2 })).status, 200, p);
  ok("after restart: state intact (last release R2); guardian, site and memory pages render");
  console.log(`\nAll ${step} Project Guardian checks passed (${provider}).`);
} finally {
  await stop().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
}
