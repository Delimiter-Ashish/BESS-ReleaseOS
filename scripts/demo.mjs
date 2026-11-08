// Reproducible synthetic demo for recordings and judging — runs against an ISOLATED demo server, never your main data.
//
//   npm run build                      (once)
//   npm run demo:start                 # demo server on http://localhost:3200, data in ./.data-demo (gitignored)
//   npm run demo:setup                 # reset THAT server and create the starting state via real API calls
//   npm run demo:verify                # assert the starting state (or, after the walkthrough, the final state)
//   npm run demo:advance               # optional: perform the resolution steps by API (rehearsal / fallback)
//
// Every step below is an ordinary authenticated API call (same endpoints the UI uses). Nothing is mocked; extraction
// uses OpenAI when .env.local configures it, otherwise the labeled deterministic fallback. All data is synthetic.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const cmd = process.argv[2] ?? "help";
const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:3200";
const PORT = Number(new URL(BASE).port || 80);
const H = "S-1001";

if (cmd === "start") {
  // Separate data directory: the main ./.data (and anything sealed there, e.g. R2) is never read or written.
  const env = { ...process.env, RELEASEOS_DATA_DIR: process.env.RELEASEOS_DATA_DIR ?? ".data-demo", SESSION_SECRET: process.env.SESSION_SECRET ?? "releaseos-demo-session-secret-0123456789" };
  console.log(`Demo server → ${BASE}  (data: ${env.RELEASEOS_DATA_DIR})`);
  spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env, stdio: "inherit" });
} else if (["setup", "verify", "advance"].includes(cmd)) {
  if (PORT === 3000 && process.env.DEMO_ALLOW_MAIN !== "1") {
    console.error("Refusing to run against :3000 (main data). Use the isolated demo server (npm run demo:start) or set DEMO_ALLOW_MAIN=1.");
    process.exit(2);
  }
  await run(cmd).catch((e) => { console.error(`\n✗ demo ${cmd} failed: ${e.message}`); process.exit(1); });
} else {
  console.log("usage: node scripts/demo.mjs start|setup|verify|advance   (DEMO_BASE=http://127.0.0.1:3200)");
}

async function run(which) {
  try { await fetch(`${BASE}/api/session`); } catch { throw new Error(`no server at ${BASE} — run npm run demo:start first`); }
  const login = async (userId, passcode) => {
    const r = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, passcode }) });
    assert.equal(r.status, 200, `login ${userId}`);
    return r.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("ros_session"));
  };
  const call = async (cookie, path, { method = "GET", json, form } = {}) => {
    const r = await fetch(`${BASE}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(json ? { "Content-Type": "application/json" } : {}) }, body: json ? JSON.stringify(json) : form });
    const ct = r.headers.get("content-type") ?? "";
    return { status: r.status, body: ct.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const must = async (p, what) => { const r = await p; if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); return r.body; };
  const upload = async (cookie, file, requirementId, effectiveDate) => {
    const fd = new FormData();
    fd.append("file", new Blob([readFileSync(`sample-docs/${file}`)], { type: "application/pdf" }), file); fd.append("siteId", H);
    const ex = await must(call(cookie, "/api/extract", { method: "POST", form: fd }), `extract ${file}`);
    return must(call(cookie, `/api/sites/${H}/revisions`, { method: "POST", json: { extractionId: ex.extractionId, requirementId, effectiveDate } }), `file ${file}`);
  };
  const pm = await login("arivera", "eqore855"), eng = await login("mchen", "eng856"), eng2 = await login("rpatel", "eng855");
  const step = (m) => console.log(`  ✓ ${m}`);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const plusDays = (n) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

  if (which === "setup") {
    console.log(`Demo setup against ${BASE}`);
    await must(call(pm, "/api/reset", { method: "POST" }), "reset demo server");
    step("demo server reset to the synthetic seed (R1 sealed, historical)");
    const com = await must(call(pm, `/api/sites/${H}/communications`, { method: "POST", json: { body: readFileSync("sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt", "utf8"), channel: "ahj_comment" } }), "import AHJ email");
    const req = com.items.find((i) => i.requirementId === "ventilation_plan");
    if (!req) throw new Error("the AHJ email did not yield a ventilation-plan requirement");
    step(`AHJ email imported (${com.communication?.analysis?.engine ?? "?"} extraction) → suggested requirement “${req.title}”`);
    await must(call(pm, `/api/sites/${H}/memory/${req.id}`, { method: "POST", json: { action: "confirm", note: "Fire plan review comment 1 applies to the permit resubmission (synthetic)", blocking: true, templateIds: ["ahj_permit"] } }), "confirm requirement");
    step("requirement confirmed by A. Rivera as blocking for the Town Permit package");
    const sw = await upload(pm, "SYNTHETIC_Switchgear_Spec_RevB.pdf", "switchgear_datasheet");
    step(`supplier switchgear Rev B filed → engineer review ${sw.review.id} awaiting action${sw.engineeringTasks.length ? ` + dependency review on the plan set` : ""}`);
    const v = await must(call(pm, `/api/sites/${H}/lifecycle`), "lifecycle");
    const sheet = v.lifecycle.publishCandidates.find((c) => c.requirementId === "emergency_info_sheet");
    await must(call(eng2, `/api/sites/${H}/lifecycle`, { method: "POST", json: { action: "publish_emergency", revisionId: sheet.revisionId, note: "Approved for first responders (synthetic demo)" } }), "publish emergency sheet");
    step(`R. Patel, PE published “${sheet.title}” to the public QR page`);
    await must(call(pm, `/api/sites/${H}/lifecycle`, { method: "POST", json: { action: "add_obligation", requirementId: "ops_record", category: "operations_records", kind: "record", title: "Scheduled maintenance inspection record", dueDate: plusDays(5), warningDays: 7, note: "Owner O&M agreement schedule (synthetic demo data)" } }), "add maintenance record");
    step(`project-specific maintenance record due ${plusDays(5)} (synthetic schedule)`);
    await verifyStart();
    printUrls();
  } else if (which === "advance") {
    console.log(`Demo advance (resolution by API) against ${BASE}`);
    const reviews = (await must(call(eng, "/api/workspace"), "workspace")).reviews.filter((r) => r.projectId === H && r.open);
    const sw = reviews.find((r) => r.requirementId === "switchgear_datasheet" && r.kind === "revision");
    const planTasks = (sw?.raisedTasks ?? []).filter((t) => t.status === "open" && /plan set/i.test(t.dependent)).map((t) => t.id);
    if (sw) { await must(call(eng, `/api/reviews/${sw.id}`, { method: "POST", json: { decision: "approve", note: "Rev B 600 VAC confirmed (synthetic)" } }), "approve switchgear"); step("M. Chen approved switchgear Rev B"); }
    const pc = await upload(pm, "SYNTHETIC_Plan_Set_RevC.pdf", "plan_set");
    await must(call(eng2, `/api/reviews/${pc.review.id}`, { method: "POST", json: { decision: "approve", note: "ESS-13.0 updated to 600 VAC NSG-4000 (synthetic)", resolveTaskIds: planTasks } }), "approve plan set Rev C");
    step("R. Patel approved plan set Rev C, resolving the dependency review");
    const vent = await upload(pm, "SYNTHETIC_Ventilation_Plan_RevA.pdf", "ventilation_plan");
    await must(call(eng, `/api/reviews/${vent.review.id}`, { method: "POST", json: { decision: "approve", note: "Ventilation plan reviewed (synthetic)" } }), "approve ventilation plan");
    step("M. Chen approved the ventilation plan Rev A");
    const mem = (await must(call(pm, `/api/sites/${H}/memory`), "memory")).items.find((m) => m.requirementId === "ventilation_plan" && m.status === "confirmed");
    if (mem) { await must(call(eng2, `/api/sites/${H}/memory/${mem.id}`, { method: "POST", json: { action: "resolve", note: "Ventilation plan Rev A answers Fire comment 1" } }), "resolve requirement"); step("requirement resolved"); }
    console.log("  → Now open the Studio as R. Patel and click “Sign off, generate PDFs & seal” (or seal in the UI during the recording).");
    printUrls();
  } else {
    const st = await must(call(pm, `/api/sites/${H}/studio/check`, { method: "POST", json: { purpose: "ahj", groups: [] } }), "studio check");
    const sealed = (await call(pm, `/api/releases/${H}-ahj_permit-R2/download?format=json`)).status === 200;
    if (st.check.blockers.some((b) => b.code === "MISSING_DOCUMENT" && b.requirementId === "ventilation_plan")) await verifyStart();
    else await verifyEnd(sealed);
  }

  async function verifyStart() {
    const check = (await must(call(pm, `/api/sites/${H}/studio/check`, { method: "POST", json: { purpose: "ahj", groups: [] } }), "studio check")).check;
    const codes = check.blockers.map((b) => b.code);
    assert.ok(codes.includes("MISSING_DOCUMENT") && codes.includes("PENDING_REVIEW"), `expected missing ventilation plan + pending review, got ${codes}`);
    const miss = check.blockers.find((b) => b.code === "MISSING_DOCUMENT");
    assert.equal(miss.source?.kind, "project_memory");
    const tm = (await must(call(pm, `/api/sites/${H}/timemachine?releaseId=${H}-ahj_permit-R1`), "time machine")).report;
    assert.ok(tm.newRequirements.length > 0 && tm.attentionReasons.length > 0, "Time Machine R1 vs current must show changes");
    const pub = await must(call(undefined, `/api/public/sites/${H}/emergency`), "public QR");
    assert.ok(pub.publications.some((p) => p.current), "a published emergency document must be visible publicly");
    step(`START STATE OK — gate blockers: ${codes.filter((c) => !["EMPTY_SELECTION", "REQUIRED_NOT_SELECTED"].includes(c)).join(", ")} · Time Machine: ${tm.attentionReasons.length} reason(s) since R1 · public QR: ${pub.publications.filter((p) => p.current).length} published`);
  }
  async function verifyEnd(sealed) {
    const check = (await must(call(pm, `/api/sites/${H}/studio/check`, { method: "POST", json: { purpose: "ahj", groups: [] } }), "studio check")).check;
    const tm = (await must(call(pm, `/api/sites/${H}/timemachine?releaseId=${H}-ahj_permit-R1`), "time machine")).report;
    assert.equal(tm.release.integrityVerified, true, "R1 snapshot must still verify");
    step(`END STATE — gate blockers: ${check.blockers.filter((b) => !["REQUIRED_NOT_SELECTED", "EMPTY_SELECTION"].includes(b.code)).length} · R2+ sealed: ${sealed ? "yes" : "not yet"} · R1 integrity verified · Time Machine: ${tm.replacedDocuments.filter((r) => r.currentStatus === "approved").length} replaced revision(s), ${tm.resolvedSinceRelease.length} resolution(s) since R1`);
  }
  function printUrls() {
    console.log(`\nDemo URLs (sign in from the sidebar):
  Today (PM: A. Rivera / eqore855)        ${BASE}/
  Project + lifecycle roadmap             ${BASE}/projects/${H}
  Guardian X-Ray                          ${BASE}/guardian?project=${H}&template=ahj_permit
  Evidence chain                          ${BASE}/guardian?project=${H}&template=ahj_permit&tab=graph
  Time Machine (R1 vs current)            ${BASE}/guardian?project=${H}&template=ahj_permit&tab=time&release=${H}-ahj_permit-R1
  Engineer reviews (M. Chen / eng856)     ${BASE}/reviews?project=${H}
  Submission Studio (R. Patel / eng855)   ${BASE}/submissions?project=${H}&package=ahj_permit
  Lifecycle                               ${BASE}/lifecycle?project=${H}
  Public QR (signed out)                  ${BASE}/p/${H}`);
  }
}
