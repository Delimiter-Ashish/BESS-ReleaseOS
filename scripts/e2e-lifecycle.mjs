// HTTP end-to-end for Lifecycle Assurance against the BUILT app (npm run build first). Own server on :3107, temp data,
// frozen demo clock (RELEASEOS_CLOCK=2026-11-07T15:00:00Z). Every step is a real API call; nothing is mocked.
//   node scripts/e2e-lifecycle.mjs     (E2E_PROVIDER=openai for live extraction of uploads)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 3107, BASE = `http://127.0.0.1:${PORT}`, H = "S-1001";
const provider = process.env.E2E_PROVIDER || "rules";
const dataDir = mkdtempSync(join(tmpdir(), "releaseos-lifecycle-"));
const env = { ...process.env, AI_PROVIDER: provider, RELEASEOS_DATA_DIR: dataDir, RELEASEOS_CLOCK: "2026-11-07T15:00:00Z", SESSION_SECRET: "e2e-lifecycle-session-secret-0123456789" };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const fileIdOf = (name) => `f_${sha(readFileSync(`sample-docs/${name}`)).slice(0, 24)}`;
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
  return { status: r.status, headers: r.headers, body: ct.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};
const lc = async (cookie, asOf) => { const r = await call(`/api/sites/${H}/lifecycle${asOf ? `?asOf=${encodeURIComponent(asOf)}` : ""}`, { cookie }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.lifecycle; };
const act = (cookie, json) => call(`/api/sites/${H}/lifecycle`, { cookie, method: "POST", json });
const must = async (p, status = 200) => { const r = await p; assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const byReq = (v, rid) => v.obligations.find((o) => o.requirementId === rid && o.kind === "document");
async function upload(cookie, name, requirementId, effectiveDate) {
  const fd = new FormData();
  fd.append("file", new Blob([readFileSync(`sample-docs/${name}`)], { type: "application/pdf" }), name); fd.append("siteId", H);
  const ex = (await call("/api/extract", { cookie, method: "POST", form: fd })).body;
  assert.equal(ex.ok, true, ex.error);
  return must(call(`/api/sites/${H}/revisions`, { cookie, method: "POST", json: { extractionId: ex.extractionId, requirementId, effectiveDate } }));
}

console.log(`Lifecycle assurance E2E (${provider}) — data dir ${dataDir}`);
try {
  await start();
  const pm = await login("arivera", "eqore855"), eng = await login("mchen", "eng856"), eng2 = await login("rpatel", "eng855"), fac = await login("facility", "site855"), sup = await login("supplier", "supp855"), ahj = await login("ahj", "ahj855");
  assert.equal((await call("/api/reset", { cookie: pm, method: "POST" })).status, 200);
  const r1Id = `${H}-ahj_permit-R1`;
  const r1Zip = (await call(`/api/releases/${r1Id}/download`, { cookie: pm })).body;
  const r1Snap = (await call(`/api/releases/${r1Id}/download?format=snapshot`, { cookie: pm })).body.sha256;

  // 1. Existing site with an approved release.
  assert.equal((await call(`/sites/${H}`, { cookie: pm })).status, 200);
  assert.equal((await call(`/api/sites/${H}/lifecycle`)).status, 401, "public cannot read the register");
  let v = await lc(pm);
  assert.equal(v.stage, "permitting");
  assert.equal(byReq(v, "eop").status, "not_applicable");
  assert.ok(v.obligations.every((o) => !o.due), "no built-in deadlines");
  ok(`site ${H} with sealed ${r1Id}; register of ${v.obligations.length} README-derived obligations, none with invented due dates; EOP not applicable during permitting; public → 401`);

  // 2. Authorized stage move.
  await must(act(fac, { action: "set_stage", to: "operations", note: "Facility tries" }), 403);
  await must(act(pm, { action: "set_stage", to: "operations", note: "Commissioning complete; site operating (synthetic)" }));
  v = await lc(pm);
  assert.equal(v.stage, "operations");
  ok("facility stage change refused (403); EQORE PM moved the site to Operations with a recorded reason");

  // 3. Lifecycle obligations.
  assert.equal(byReq(v, "eop").status, "completed");
  assert.equal(byReq(v, "om_manual").status, "completed");
  assert.equal(byReq(v, "cx_report").status, "open");
  assert.equal(byReq(v, "decom_plan").status, "not_applicable");
  ok(`obligations now: ${Object.entries(v.counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ")} (EOP/O&M Rev A completed, commissioning report open, decommissioning not yet applicable)`);

  // 4. Project-specific maintenance due date.
  const add = await must(act(pm, { action: "add_obligation", requirementId: "ops_record", category: "operations_records", kind: "record", title: "Scheduled maintenance inspection record", dueDate: "2026-11-12", warningDays: 7, note: "Owner O&M agreement schedule (synthetic demo data)" }));
  const mid = add.obligation.id;
  const q = await must(act(pm, { action: "add_obligation", requirementId: "ops_record", category: "operations_records", kind: "record", title: "Fire-detection functional test record", dueDate: "2026-11-20", warningDays: 7, note: "Project test plan (synthetic demo data)" }));
  const m = (view) => view.obligations.find((o) => o.id === mid);
  assert.equal(m(await lc(pm)).due.synthetic, true);
  ok("scheduled maintenance inspection record due 2026-11-12 (7-day window) + fire-detection test record due 2026-11-20 — both labeled project-specific synthetic data");

  // 5. Controlled-date calculations (read-only asOf previews).
  const sOf = async (id, asOf) => (await lc(pm, asOf)).obligations.find((o) => o.id === id).status;
  assert.equal(await sOf(mid, "2026-11-07"), "due_soon");
  assert.equal(await sOf(mid, "2026-11-12"), "due_soon");
  assert.equal(await sOf(mid, "2026-11-13T03:00:00Z"), "due_soon", "22:00 on the 12th in Holliston");
  assert.equal(await sOf(mid, "2026-11-13"), "overdue");
  assert.equal(await sOf(q.obligation.id, "2026-11-07"), "upcoming");
  assert.equal(await sOf(q.obligation.id, "2026-11-13"), "due_soon");
  assert.equal((await call(`/api/sites/${H}/lifecycle?asOf=2026-02-30`, { cookie: pm })).status, 400);
  // Maintenance event → evidence → engineer verification
  await must(act(sup, { action: "record_event", obligationId: mid, type: "maintenance", performedOn: "2026-11-06", performedBy: "x", summary: "supplier tries" }), 403);
  const ev = await must(act(fac, { action: "record_event", obligationId: mid, type: "maintenance", performedOn: "2026-11-06", performedBy: "EQORE field technician (fictional)", summary: "Enclosure, BMS log, HVAC filter, labels — no deficiencies (synthetic)" }));
  await must(act(pm, { action: "record_event", obligationId: mid, type: "maintenance", performedOn: "2026-11-06", performedBy: "dup", summary: "Same inspection entered twice" }), 409);
  assert.equal(await sOf(mid, "2026-11-07"), "awaiting_review");
  assert.equal(await sOf(mid, "2026-11-13"), "overdue");
  const rec = await upload(pm, "SYNTHETIC_Maintenance_Inspection_Record_2026-11.pdf", "ops_record", "2026-11-06");
  await must(act(eng, { action: "verify_completion", obligationId: mid, eventId: ev.event.id, evidenceRevisionId: rec.revision.id, note: "Verify before review" }), 409);
  await must(call(`/api/reviews/${rec.review.id}`, { cookie: eng2, method: "POST", json: { decision: "approve", note: "Maintenance record reviewed (synthetic)" } }));
  await must(act(fac, { action: "verify_completion", obligationId: mid, eventId: ev.event.id, evidenceRevisionId: rec.revision.id, note: "Facility tries" }), 403);
  await must(act(eng, { action: "verify_completion", obligationId: mid, eventId: ev.event.id, evidenceRevisionId: rec.revision.id, note: "Record matches the scheduled scope (synthetic)" }));
  assert.equal(await sOf(mid, "2026-11-07"), "completed");
  assert.equal(await sOf(mid, "2026-11-13"), "completed");
  ok("dates: 11-07 due soon · 11-12 due soon · 22:00 local on 11-12 due soon · 11-13 overdue · 11-20 item upcoming then due soon; event by facility → awaiting review (duplicate 409, supplier 403); unreviewed evidence refused (409); after engineer approval + verification → completed");

  // 6. Confirmed site change (plus negatives: unconfirmed suggestion, unrelated change).
  const com = await must(call(`/api/sites/${H}/communications`, { cookie: pm, method: "POST", json: { body: readFileSync("sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt", "utf8"), channel: "ahj_comment" } }));
  const suggestion = com.items.find((i) => i.status === "suggested");
  const sug = await must(act(pm, { action: "propose_change", kind: "occupancy_change", description: "Possible layout change mentioned in correspondence", effectiveDate: "2026-11-01", memoryItemId: suggestion.id }));
  assert.equal((await lc(pm)).impacts.length, 0, "unconfirmed suggestion flags nothing");
  await must(act(pm, { action: "dismiss_change", changeId: sug.change.id, note: "Not an actual site change" }));
  const unrel = await must(act(fac, { action: "propose_change", kind: "monitoring_device_replace", description: "Monitoring gateway replaced like-for-like", from: "GW-100 gateway", to: "GW-100 gateway", effectiveDate: "2026-11-02" }));
  const unrelC = await must(act(pm, { action: "confirm_change", changeId: unrel.change.id, note: "Verified by EQORE field service" }));
  assert.ok(!unrelC.impacts.some((i) => i.requirementId === "eop" || i.requirementId === "om_manual"));
  const p = await must(act(fac, { action: "propose_change", kind: "inverter_replace", description: "Both inverters replaced after warranty failure", component: "Inverter / PCS", from: "2 x Dynapower MPS125", to: "2 x Northbridge NPI-125", effectiveDate: "2026-11-05" }));
  await must(act(fac, { action: "confirm_change", changeId: p.change.id, note: "Facility tries to confirm" }), 403);
  const conf = await must(act(pm, { action: "confirm_change", changeId: p.change.id, note: "Confirmed against field service work order (synthetic)" }));
  ok(`unconfirmed project-memory suggestion → 0 impacts; like-for-like gateway swap → EOP/O&M not flagged (${unrelC.impacts.length} impact(s)); inverter replacement proposed by facility, confirmation by facility refused (403), confirmed by EQORE PM`);

  // 7–8. Guardian-style impacts with evidence.
  const eopImp = conf.impacts.find((i) => i.requirementId === "eop"), omImp = conf.impacts.find((i) => i.requirementId === "om_manual");
  assert.ok(eopImp && omImp);
  assert.ok(eopImp.evidence.length && eopImp.evidence.every((e) => /MPS125/.test(e.quote)));
  v = await lc(pm);
  const eopView = byReq(v, "eop");
  assert.equal(eopView.status, "needs_review");
  assert.equal(eopView.openImpacts[0].evidence[0].quote, eopImp.evidence[0].quote);
  ok(`impacts: ${conf.impacts.map((i) => `${i.requirementId}${i.evidence.length ? ` (evidence p.${i.evidence.map((e) => e.page).join(",")})` : ""}`).join(", ")}; EOP → needs review: “${eopImp.evidence[0].quote}” · update ${eopImp.documentToUpdate} · responsible ${eopImp.responsible} · reviewer licensed engineer`);
  const graph = await must(call(`/api/sites/${H}/graph?focus=${encodeURIComponent(`imp:${eopImp.id}`)}`, { cookie: pm }));
  assert.ok(graph.graph.edges.some((e) => e.type === "may_affect"));

  // 9. Unauthorized resolution.
  await must(act(pm, { action: "resolve_impact", impactId: eopImp.id, resolution: "new_revision_approved", note: "PM tries" }), 403);
  await must(act(fac, { action: "resolve_impact", impactId: eopImp.id, resolution: "new_revision_approved", note: "Facility tries" }), 403);
  await must(act(eng, { action: "resolve_impact", impactId: eopImp.id, resolution: "new_revision_approved", note: "Too early" }), 409);
  ok("PM and facility cannot resolve (403); engineer cannot resolve before an updated EOP is approved (409); evidence graph links change → impact");

  // 10. Upload updated documentation.
  const eopB = await upload(pm, "SYNTHETIC_EOP_RevB.pdf", "eop", "2026-11-07");
  const omB = await upload(pm, "SYNTHETIC_OM_Manual_RevB.pdf", "om_manual", "2026-11-07");
  await must(act(eng, { action: "resolve_impact", impactId: eopImp.id, resolution: "new_revision_approved", note: "Pending" }), 409);
  assert.equal(byReq(await lc(pm), "eop").status, "needs_review");
  ok(`EOP Rev B and O&M Rev B uploaded by PM — still needs review (resolution while Rev B pending → 409)`);

  // 11. Authorized review + resolution.
  await must(call(`/api/reviews/${eopB.review.id}`, { cookie: eng2, method: "POST", json: { decision: "approve", note: "Rev B reflects the Northbridge NPI-125 isolation procedure (synthetic)" } }));
  await must(call(`/api/reviews/${omB.review.id}`, { cookie: eng2, method: "POST", json: { decision: "approve", note: "Section 4.2 updated for NPI-125 (synthetic)" } }));
  await must(act(eng, { action: "resolve_impact", impactId: eopImp.id, resolution: "new_revision_approved", note: "EOP Rev B approved; isolation steps updated" }));
  await must(act(eng, { action: "resolve_impact", impactId: omImp.id, resolution: "new_revision_approved", note: "O&M Rev B approved" }));
  v = await lc(pm);
  assert.equal(byReq(v, "eop").status, "completed");
  assert.equal(byReq(v, "eop").currentRevision.revLabel, "B");
  assert.equal(byReq(v, "om_manual").status, "completed");
  const stillOpen = v.impacts.filter((i) => i.status === "open");
  ok(`R. Patel approved Rev B (EOP, O&M); M. Chen resolved both reviews → EOP/O&M completed at Rev B; ${stillOpen.length} other review(s) remain open (${stillOpen.map((i) => i.requirementId).join(", ") || "none"})`);

  // 12. Historical releases unchanged.
  assert.equal((await call(`/api/releases/${r1Id}/download?format=snapshot`, { cookie: pm })).body.sha256, r1Snap);
  assert.ok(Buffer.compare((await call(`/api/releases/${r1Id}/download`, { cookie: pm })).body, r1Zip) === 0);
  ok("current status updated while R1 snapshot hash and ZIP bytes are unchanged");

  // 13. Stakeholder access.
  const eopFile = fileIdOf("SYNTHETIC_EOP_RevB.pdf");
  assert.equal((await call(`/api/files/${eopFile}`, { cookie: fac })).status, 200);
  assert.equal((await call(`/api/files/${eopFile}`, { cookie: sup })).status, 403);
  assert.equal((await call(`/api/files/${eopFile}`, { cookie: ahj })).status, 403);
  assert.notEqual((await call(`/api/files/${eopFile}`)).status, 200);
  const facV = await lc(fac);
  assert.ok(facV.viewer.restricted && facV.changes.length === 0 && byReq(facV, "eop") && !JSON.stringify(facV).includes("work order"));
  assert.ok(!(await lc(sup)).obligations.some((o) => ["eop", "om_manual", "ops_record"].includes(o.requirementId)));
  await must(act(sup, { action: "set_due", obligationId: mid, dueDate: "2027-01-01", note: "Supplier tries" }), 403);
  let pub = await must(call(`/api/public/sites/${H}/emergency`));
  assert.equal(pub.publications.length, 0);
  const sheetId = v.publishCandidates.find((c) => c.requirementId === "emergency_info_sheet").revisionId;
  await must(act(pm, { action: "publish_emergency", revisionId: sheetId, note: "PM tries" }), 403);
  await must(act(eng, { action: "publish_emergency", revisionId: sheetId, note: "Approved for first responders (synthetic)" }));
  pub = await must(call(`/api/public/sites/${H}/emergency`));
  assert.equal(pub.publications.length, 1);
  const pubFile = await call(pub.publications[0].href);
  assert.equal(pubFile.status, 200);
  assert.equal(sha(pubFile.body), pub.publications[0].sha256);
  const ePage = (await call(`/e/${H}`)).body.toString();
  assert.ok(ePage.includes("First-responder emergency information sheet") && !/work order|Patel|Chen|Rivera|Emergency operations plan Rev/.test(ePage));
  const pPage = (await call(`/p/${H}`)).body.toString();
  assert.ok(!/work order|Confirmed against|Fire comment|NPI-125/.test(pPage), "legacy QR page leaks no notes, quotes or change details");
  assert.equal((await call(`/api/sites/${H}/graph`)).status, 401);
  ok("facility reads EOP Rev B (200); supplier/AHJ/public denied (403/401); facility view restricted; supplier sees no ops records; QR page empty until an engineer publishes (PM 403); published sheet served with matching sha256; public pages carry no notes, names or change details");

  // 14. Restart persistence.
  const before = await lc(pm);
  await stop();
  await start();
  const after = await lc(pm);
  const summary = (x) => JSON.stringify({ stage: x.stage, counts: x.counts, ob: x.obligations.map((o) => [o.id, o.status, o.due?.date, o.currentRevision?.id]), ch: x.changes.map((c) => [c.id, c.status]), im: x.impacts.map((i) => [i.id, i.status, i.decisionId]), pub: x.publications.map((p) => [p.id, p.status]) });
  assert.equal(summary(after), summary(before));
  assert.ok(after.obligations.find((o) => o.id === mid).events.length === 1);
  assert.equal((await call(`/api/releases/${r1Id}/download?format=snapshot`, { cookie: pm })).body.sha256, r1Snap);
  assert.equal((await call(`/api/files/${eopFile}`, { cookie: sup })).status, 403);
  assert.equal((await call(`/api/files/${eopFile}`, { cookie: fac })).status, 200);
  assert.equal(sha((await call(pub.publications[0].href)).body), pub.publications[0].sha256);
  ok(`after restart: stage, ${after.obligations.length} obligations, ${after.changes.length} changes, ${after.impacts.length} impacts, events, publications and permissions identical; R1 unchanged`);

  console.log(`\nLifecycle E2E: ${step}/${step} steps passed`);
} catch (e) {
  console.error("\nLifecycle E2E FAILED:", e);
  process.exitCode = 1;
} finally {
  if (app) await stop();
  rmSync(dataDir, { recursive: true, force: true });
}
