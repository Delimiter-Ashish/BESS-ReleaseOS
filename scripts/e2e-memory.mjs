// HTTP end-to-end for project memory, against the BUILT app (npm run build first). Starts its own server
// on :3102 with a temporary data dir, runs the AHJ ventilation-plan scenario, RESTARTS the server and checks
// that memory, uploads and releases survived. Synthetic data only.
//   node scripts/e2e-memory.mjs                 # deterministic rules analyzer (no network)
//   E2E_PROVIDER=openai node scripts/e2e-memory.mjs   # real OpenAI call (needs OPENAI_API_KEY in env/.env.local)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 3102, BASE = `http://127.0.0.1:${PORT}`, H = "S-1001";
const provider = process.env.E2E_PROVIDER || "rules";
const dataDir = mkdtempSync(join(tmpdir(), "releaseos-e2e-"));
const env = { ...process.env, AI_PROVIDER: provider, RELEASEOS_DATA_DIR: dataDir, SESSION_SECRET: "e2e-memory-session-secret-0123456789" };
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
  return { status: r.status, body: ct.includes("json") ? await r.json() : await r.arrayBuffer() };
};
const check = async (cookie, tid = "ahj_permit") => (await call(`/api/sites/${H}/presubmission?templateId=${tid}`, { cookie })).body.report;

console.log(`Project-memory E2E (${provider}) — data dir ${dataDir}`);
try {
  await start();
  const pm = await login("arivera", "eqore855");
  const eng = await login("mchen", "eng856");
  const eng2 = await login("rpatel", "eng855");
  const sup = await login("supplier", "supp855");
  assert.equal((await call("/api/reset", { cookie: pm, method: "POST" })).status, 200);

  let rep = await check(pm);
  assert.equal(rep.canBuild, true); ok("AHJ permit package starts clear (R1 current)");

  const email = readFileSync("sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt", "utf8");
  assert.equal((await call(`/api/sites/${H}/communications`, { method: "POST", json: { body: email } })).status, 401);
  assert.equal((await call(`/api/sites/${H}/communications`, { cookie: sup, method: "POST", json: { body: email } })).status, 403);
  assert.equal((await call(`/api/sites/${H}/memory`, { cookie: sup })).status, 403);
  ok("unauthenticated (401) and supplier (403) import/read of project memory rejected");

  // 1–2. AHJ email → extraction (suggestions)
  const t0 = Date.now();
  let r = await call(`/api/sites/${H}/communications`, { cookie: pm, method: "POST", json: { body: email, channel: "ahj_comment" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const com = r.body.communication;
  assert.equal(com.body, email.replace(/\r\n/g, "\n")); assert.equal(com.sentAt, "2026-11-05T14:14:00.000Z"); assert.match(com.sender, /Okafor/);
  assert.equal(com.analysis.engine, provider === "openai" ? "openai" : "rules", com.analysis.warnings.join(" | "));
  const req = r.body.items.find((i) => i.kind === "requirement" && i.requirementId === "ventilation_plan");
  assert.ok(req, `ventilation plan requirement extracted; got ${JSON.stringify(r.body.items.map((i) => [i.kind, i.requirementId, i.title]))}`);
  assert.equal(req.status, "suggested"); assert.equal(req.sources[0].evidenceVerified, true);
  ok(`${com.analysis.engine}${com.analysis.model ? ` (${com.analysis.model})` : ""} extracted ${r.body.items.length} suggestion(s) in ${Date.now() - t0} ms: “${req.title}” — evidence verified: “${req.sources[0].evidence.slice(0, 70)}…”`);
  console.log(`       kinds: ${r.body.items.map((i) => `${i.kind}${i.requirementId ? `(${i.requirementId})` : ""}`).join(", ")}`);

  rep = await check(pm);
  assert.equal(rep.canBuild, true); assert.ok(rep.advisories.some((a) => a.memoryItemId === req.id));
  ok("unconfirmed suggestion is advisory only — package still clear");

  r = await call(`/api/sites/${H}/communications`, { cookie: pm, method: "POST", json: { body: email.replace(/\n\n/g, "\n\n\n") } });
  assert.equal(r.body.duplicate, true); assert.equal(r.body.communication.id, com.id);
  const reg = (await call(`/api/sites/${H}/memory`, { cookie: pm })).body;
  assert.equal(reg.items.length, com.itemIds.length);
  ok("same email imported again → existing record returned, no duplicate items, no second AI call");

  // 3. PM confirms applicability
  assert.equal((await call(`/api/sites/${H}/memory/${req.id}`, { cookie: sup, method: "POST", json: { action: "confirm", note: "supplier" } })).status, 403);
  r = await call(`/api/sites/${H}/memory/${req.id}`, { cookie: pm, method: "POST", json: { action: "confirm", note: "Applies to the Holliston fire permit resubmission", blocking: true, templateIds: ["ahj_permit"], requirementId: "ventilation_plan", requiresUpdatedRevision: true } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.item.status, "confirmed"); assert.equal(r.body.item.confirmedBy, "A. Rivera");
  ok("A. Rivera (PM) confirmed the requirement as blocking for the AHJ permit package");

  // 4–5. Missing → blocked, with source / document / owner / next action
  rep = await check(pm);
  const miss = rep.blockers.find((b) => b.code === "MISSING_DOCUMENT" && b.requirementId === "ventilation_plan");
  assert.equal(rep.canBuild, false); assert.ok(miss); assert.equal(miss.source.kind, "project_memory"); assert.equal(miss.source.communicationId, com.id);
  assert.ok(miss.responsibleParty && miss.nextAction && miss.affectedDocument);
  ok(`blocked: “${miss.message}” · source ${miss.source.sender} ${miss.source.sentAt.slice(0, 10)} · next: ${miss.nextAction}`);
  // Pre-submission detail is derived from internal correspondence → EQORE only (integration hardening).
  assert.equal((await call(`/api/sites/${H}/presubmission?templateId=ahj_permit`, { cookie: sup })).status, 403);
  ok("non-EQORE readers cannot open the pre-submission detail (403) — internal email quotes and senders stay internal");
  const pkgs = (await call(`/api/sites/${H}/releases`, { cookie: eng })).body.packages;
  const ahj = pkgs.find((p) => p.templateId === "ahj_permit");
  assert.equal((await call(`/api/sites/${H}/releases`, { cookie: eng, method: "POST", json: { templateId: "ahj_permit", note: "attempt while blocked", readinessToken: ahj.token } })).status, 409);
  ok("release creation rejected while the confirmed requirement is unmet (409)");

  // 6. Upload + engineer review
  const pdf = readFileSync("sample-docs/SYNTHETIC_Ventilation_Plan_RevA.pdf");
  const fd = new FormData();
  fd.append("file", new Blob([pdf], { type: "application/pdf" }), "SYNTHETIC_Ventilation_Plan_RevA.pdf"); fd.append("siteId", H);
  const ex = (await call("/api/extract", { cookie: pm, method: "POST", form: fd })).body;
  assert.equal(ex.ok, true, ex.error); assert.equal(ex.sha256, sha(pdf));
  r = await call(`/api/sites/${H}/revisions`, { cookie: pm, method: "POST", json: { extractionId: ex.extractionId, requirementId: "ventilation_plan", source: "engineer" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rev = r.body.revision, review = r.body.review;
  ok(`ventilation plan uploaded (classified ${ex.requirementId} by ${ex.engine}) and filed as Rev ${rev.revLabel} in review`);
  assert.equal((await call(`/api/sites/${H}/memory/${req.id}`, { cookie: eng, method: "POST", json: { action: "resolve", note: "too early" } })).status, 409);
  r = await call(`/api/reviews/${review.id}`, { cookie: eng, method: "POST", json: { decision: "approve", note: "Ventilation plan reviewed: exhaust rate and interlock shown (synthetic)" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  rep = await check(pm);
  assert.ok(rep.blockers.some((b) => b.code === "REQUIREMENT_UNRESOLVED" && b.memoryItemId === req.id));
  ok("premature resolution rejected (409); after approval the requirement itself still needs an engineer's resolution");

  // 7. Authorized resolution
  assert.equal((await call(`/api/sites/${H}/memory/${req.id}`, { cookie: pm, method: "POST", json: { action: "resolve", note: "PM tries" } })).status, 403);
  r = await call(`/api/sites/${H}/memory/${req.id}`, { cookie: eng2, method: "POST", json: { action: "resolve", note: "Rev A addresses Fire comment 1 (exhaust rate + gas-detection interlock)" } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.item.resolvedRevisionId, rev.id);
  ok("PM resolution rejected (403); R. Patel, PE resolved it against the approved Rev A (hash recorded)");

  // Persist across a restart before building.
  await stop(); await start();
  const pmAgain = await login("arivera", "eqore855");
  const reg2 = (await call(`/api/sites/${H}/memory`, { cookie: pmAgain })).body;
  assert.equal(reg2.items.find((i) => i.id === req.id).status, "resolved");
  assert.ok(reg2.communications.some((c) => c.id === com.id));
  const file = await call(`/api/files/${rev.fileId}`, { cookie: pmAgain });
  assert.equal(file.status, 200); assert.equal(sha(Buffer.from(file.body)), sha(pdf));
  ok("server restarted: communication, resolved requirement, approval and uploaded PDF bytes (sha256 match) all survived");

  // 8. New submission release
  rep = await check(eng2);
  assert.equal(rep.canBuild, true, JSON.stringify(rep.blockers));
  r = await call(`/api/sites/${H}/releases`, { cookie: eng2, method: "POST", json: { templateId: "ahj_permit", note: "R2: adds ventilation plan requested by Holliston FD", readinessToken: rep.token } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.release.number, 2);
  assert.ok(r.body.release.items.some((i) => i.requirementId === "ventilation_plan" && i.revisionId === rev.id));
  ok(`Release ${r.body.release.id} built — includes the ventilation plan; snapshot ${r.body.release.snapshotSha256.slice(0, 12)}…`);
  const snap = (await call(`/api/releases/${r.body.release.id}/download?format=snapshot`, { cookie: pm })).body;
  const frozen = (snap.annotations ?? {}).projectMemory ?? [];
  assert.ok(frozen.some((m) => m.id === req.id && m.sources[0].communicationId === com.id));
  ok("requirement and its source communication are frozen into the R2 snapshot");

  const before = (await call(`/api/sites/${H}/memory`, { cookie: pm })).body.items.map((i) => `${i.id}:${i.status}`).join();
  r = await call(`/api/sites/${H}/communications`, { cookie: pm, method: "POST", json: { body: readFileSync("sample-docs/SYNTHETIC_Injection_Email.txt", "utf8"), channel: "email" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.items.every((i) => i.status === "suggested"));
  const after = (await call(`/api/sites/${H}/memory`, { cookie: pm })).body.items.filter((i) => !r.body.communication.itemIds.includes(i.id)).map((i) => `${i.id}:${i.status}`).join();
  assert.equal(after, before, "existing items unchanged by an email containing instructions");
  ok(`injection email: ${r.body.items.length} suggestion(s), all unconfirmed; existing records unchanged; detected: ${JSON.stringify(r.body.communication.analysis.embeddedInstructionsDetected[0]?.slice(0, 60) ?? "(none reported)")}`);

  for (const p of [`/sites/${H}/memory`, `/sites/${H}`]) assert.equal((await call(p, { cookie: pm })).status, 200, p);
  ok("project memory and site pages render");
  console.log(`\nAll ${step} project-memory checks passed (${provider}).`);
} finally {
  await stop().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
}
