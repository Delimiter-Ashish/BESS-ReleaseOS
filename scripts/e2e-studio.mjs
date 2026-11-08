// HTTP end-to-end for Submission Studio against the BUILT app (npm run build first). Own server on :3106, temp data.
// Mandatory demo: Century Tywood → AHJ submission → select/order → Guardian check (missing requirement + pending
// review) → resolve via existing workflows → combined PDFs → verify pages/order/hashes/frozen metadata →
// supplier denied internal documents → R1 unchanged. Plus public blocker restriction and restart persistence.
//   node scripts/e2e-studio.mjs     (E2E_PROVIDER=openai for live extraction)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";

const PORT = 3106, BASE = `http://127.0.0.1:${PORT}`, H = "S-1001";
const provider = process.env.E2E_PROVIDER || "rules";
const dataDir = mkdtempSync(join(tmpdir(), "releaseos-studio-"));
const env = { ...process.env, AI_PROVIDER: provider, RELEASEOS_DATA_DIR: dataDir, SESSION_SECRET: "e2e-studio-session-secret-0123456789" };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const fileIdOf = (hash) => `f_${hash.slice(0, 24)}`;
let step = 0;
const ok = (m) => console.log(`  ✓ ${String(++step).padStart(2, "0")} ${m}`);
const pagesOf = async (bytes) => (await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: false })).text;

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
async function upload(cookie, name, requirementId) {
  const fd = new FormData();
  fd.append("file", new Blob([readFileSync(`sample-docs/${name}`)], { type: "application/pdf" }), name); fd.append("siteId", H);
  const ex = (await call("/api/extract", { cookie, method: "POST", form: fd })).body;
  assert.equal(ex.ok, true, ex.error);
  const r = await call(`/api/sites/${H}/revisions`, { cookie, method: "POST", json: { extractionId: ex.extractionId, requirementId } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
const check = async (cookie, sel) => { const r = await call(`/api/sites/${H}/studio/check`, { cookie, method: "POST", json: sel }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.check; };

console.log(`Submission Studio E2E (${provider}) — data dir ${dataDir}`);
try {
  await start();
  const pm = await login("arivera", "eqore855"), eng = await login("mchen", "eng856"), eng2 = await login("rpatel", "eng855"), sup = await login("supplier", "supp855"), ahj = await login("ahj", "ahj855");
  assert.equal((await call("/api/reset", { cookie: pm, method: "POST" })).status, 200);
  const r1Id = `${H}-ahj_permit-R1`;
  const r1Zip = (await call(`/api/releases/${r1Id}/download`, { cookie: pm })).body;
  const r1Snap = (await call(`/api/releases/${r1Id}/download?format=snapshot`, { cookie: pm })).body.sha256;

  // 1–3. Century Tywood → AHJ submission → default selection (two PDF groups)
  assert.equal((await call(`/sites/${H}/studio`, { cookie: pm })).status, 200);
  assert.equal((await call(`/api/sites/${H}/studio?purpose=ahj`, { cookie: sup })).status, 403);
  const data = (await call(`/api/sites/${H}/studio?purpose=ahj`, { cookie: pm })).body;
  assert.equal(data.purpose.recipient, "ahj");
  const docs = data.documents;
  assert.ok(docs.every((d) => d.sha256 && d.revLabel && d.status && d.source));
  let groups = data.defaultGroups;
  assert.deepEqual(groups.map((g) => g.name), ["Plans and drawings", "Equipment documentation"]);
  let c = await check(pm, { purpose: "ahj", groups });
  assert.equal(c.canGenerate, true, JSON.stringify(c.blockers));
  ok(`AHJ submission: ${docs.length} documents listed with type/revision/status/source/hash; default selection ${groups.map((g) => `“${g.name}” (${g.revisionIds.length})`).join(" + ")} passes checks`);
  const proposal = docs.find((d) => d.requirementId === "proposal");
  c = await check(pm, { purpose: "ahj", groups: [...groups, { id: "g-x", name: "Extra", revisionIds: [proposal.revisionId] }] });
  assert.ok(c.blockers.some((b) => b.code === "NOT_AUTHORIZED_FOR_RECIPIENT"));
  ok(`internal proposal added → blocked server-side: “${c.blockers.find((b) => b.code === "NOT_AUTHORIZED_FOR_RECIPIENT").message.slice(0, 110)}…”`);

  // 4–5. Missing confirmed requirement + pending review
  let r = await call(`/api/sites/${H}/communications`, { cookie: pm, method: "POST", json: { body: readFileSync("sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt", "utf8"), channel: "ahj_comment" } });
  const req = r.body.items.find((i) => i.requirementId === "ventilation_plan");
  assert.equal((await call(`/api/sites/${H}/memory/${req.id}`, { cookie: pm, method: "POST", json: { action: "confirm", note: "Applies to the permit resubmission", blocking: true, templateIds: ["ahj_permit"] } })).status, 200);
  const sw = await upload(pm, "SYNTHETIC_Switchgear_Spec_RevB.pdf", "switchgear_datasheet");
  c = await check(pm, { purpose: "ahj", groups });
  const missing = c.blockers.find((b) => b.code === "MISSING_DOCUMENT" && b.requirementId === "ventilation_plan");
  const pending = c.blockers.find((b) => b.code === "PENDING_REVIEW" && b.requirementId === "switchgear_datasheet");
  assert.ok(missing && missing.source.kind === "project_memory" && pending);
  ok(`Guardian check: ${c.blockers.length} blockers incl. confirmed missing requirement (“${missing.source.label.slice(0, 70)}…”) and pending review (${pending.message.slice(0, 60)}…)`);
  r = await call(`/api/sites/${H}/studio/release`, { cookie: eng, method: "POST", json: { purpose: "ahj", groups, note: "attempt", token: c.token } });
  assert.equal(r.status, 409);
  ok("generation refused while blocked (409)");

  // 6. Resolve through existing authorized workflows
  assert.equal((await call(`/api/reviews/${sw.review.id}`, { cookie: eng, method: "POST", json: { decision: "approve", note: "Rev B 600 VAC confirmed (synthetic)" } })).status, 200);
  const planTask = sw.engineeringTasks.find((t) => t.dependentRequirementId === "plan_set");
  const pc = await upload(pm, "SYNTHETIC_Plan_Set_RevC.pdf", "plan_set");
  assert.equal((await call(`/api/reviews/${pc.review.id}`, { cookie: eng2, method: "POST", json: { decision: "approve", note: "ESS-13.0 updated to 600 VAC NSG-4000 (synthetic)", resolveTaskIds: [planTask.id] } })).status, 200);
  const vent = await upload(pm, "SYNTHETIC_Ventilation_Plan_RevA.pdf", "ventilation_plan");
  assert.equal((await call(`/api/reviews/${vent.review.id}`, { cookie: eng, method: "POST", json: { decision: "approve", note: "Ventilation plan reviewed (synthetic)" } })).status, 200);
  assert.equal((await call(`/api/sites/${H}/memory/${req.id}`, { cookie: eng2, method: "POST", json: { action: "resolve", note: "Rev A answers Fire comment 1" } })).status, 200);
  c = await check(pm, { purpose: "ahj", groups });
  assert.ok(c.blockers.some((b) => b.code === "SELECTED_OUTDATED_VERSION") && c.blockers.some((b) => b.code === "REQUIRED_NOT_SELECTED"));
  ok(`switchgear Rev B approved; plan set Rev C approved resolving the dependency review; ventilation plan approved; requirement resolved — selection now flags ${c.blockers.map((b) => b.code).join(", ")}`);
  const fresh = (await call(`/api/sites/${H}/studio?purpose=ahj`, { cookie: pm })).body;
  const cur = (rid) => fresh.documents.find((d) => d.requirementId === rid && d.current).revisionId;
  groups = [
    { id: "g-plans", name: "Plans and drawings", revisionIds: [cur("plan_set"), cur("ventilation_plan")] },
    { id: "g-equipment", name: "Equipment documentation", revisionIds: ["switchgear_datasheet", "inverter_datasheet", "battery_datasheet", "ul9540_listing", "ul9540a_report", "sds"].map(cur) },
  ];
  c = await check(pm, { purpose: "ahj", groups });
  assert.equal(c.canGenerate, true, JSON.stringify(c.blockers));
  ok(`selection updated and reordered (switchgear first in PDF 2) → ready as ${c.nextReleaseId}; ${c.warnings.length} non-blocking warning(s)`);

  // 7. Generate
  assert.equal((await call(`/api/sites/${H}/studio/release`, { cookie: pm, method: "POST", json: { purpose: "ahj", groups, note: "PM tries", token: c.token } })).status, 403);
  r = await call(`/api/sites/${H}/studio/release`, { cookie: eng2, method: "POST", json: { purpose: "ahj", groups, note: "R2 AHJ resubmission (synthetic)", token: c.token } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rel = r.body.release, outputs = r.body.outputs;
  ok(`PM signoff refused (403); R. Patel, PE generated ${rel.id}: ${outputs.map((o) => `${o.fileName} (${o.pageCount} p)`).join(", ")}`);

  // 8. Verify page count, order, hashes, frozen metadata
  const snap = (await call(`/api/releases/${encodeURIComponent(rel.id)}/download?format=snapshot`, { cookie: pm })).body;
  const st = snap.annotations.studio;
  for (let gi = 0; gi < outputs.length; gi++) {
    const o = outputs[gi];
    const d = await call(o.href, { cookie: pm });
    assert.equal(d.status, 200);
    assert.equal(sha(d.body), o.sha256); assert.equal(d.headers.get("x-sha256"), o.sha256); assert.equal(st.outputs[gi].sha256, o.sha256);
    const pdf = await PDFDocument.load(d.body);
    assert.equal(pdf.getPageCount(), o.pageCount);
    const texts = await pagesOf(d.body);
    const cover = texts.slice(0, o.coverPages).join("\n");
    assert.deepEqual(o.entries.map((e) => e.revisionId), groups[gi].revisionIds);
    let expected = o.coverPages;
    for (const e of o.entries) {
      const src = await call(`/api/files/${fileIdOf(e.sourceSha256)}`, { cookie: pm });
      assert.equal(sha(src.body), e.sourceSha256, `${e.fileName} original preserved`);
      expected += (await PDFDocument.load(src.body)).getPageCount();
      assert.ok(cover.includes(e.sourceSha256));
      assert.equal(texts[e.startPage - 1].trim(), (await pagesOf(src.body))[0].trim(), `${e.fileName} at p.${e.startPage}`);
    }
    assert.equal(pdf.getPageCount(), expected);
    ok(`${o.fileName}: ${pdf.getPageCount()} pages = ${o.coverPages} cover + sources; order ${o.entries.map((e) => `${e.name.split(" ")[0]}@p${e.startPage}`).join(", ")}; sha256 ${o.sha256.slice(0, 12)}… matches header + frozen snapshot`);
  }
  assert.deepEqual(st.groups.map((g) => g.items.map((i) => i.revisionId)), groups.map((g) => g.revisionIds));
  assert.ok(st.policyDecisions.length === 8 && st.policyDecisions.every((d) => d.authorized));
  const zip = unzipSync(new Uint8Array((await call(`/api/releases/${encodeURIComponent(rel.id)}/download`, { cookie: pm })).body));
  for (const m of snap.manifest) assert.equal(sha(zip[m.archivePath]), m.sha256);
  for (const o of outputs) assert.equal(sha(zip[`combined/${o.fileName}`]), o.sha256);
  ok(`frozen metadata: groups/order, ${st.policyDecisions.length} access decisions (all authorized for ${st.recipientLabel}), output hashes; ZIP has ${snap.manifest.length} untouched originals + ${outputs.length} combined PDFs, all hashes verified`);

  // 9. Access policy: supplier vs internal documents
  const plan = fresh.documents.find((d) => d.requirementId === "plan_set" && d.current);
  const battery = fresh.documents.find((d) => d.requirementId === "battery_datasheet");
  assert.equal((await call(`/api/files/${fileIdOf(plan.sha256)}`, { cookie: sup })).status, 403);
  assert.equal((await call(`/api/files/${fileIdOf(battery.sha256)}`, { cookie: sup })).status, 200);
  const docPage = (await call(`/sites/${H}/documents/${encodeURIComponent(proposal.revisionId)}`, { cookie: sup })).body.toString();
  assert.match(docPage, /Not authorized/);
  assert.equal((await call(outputs[0].href, { cookie: sup })).status, 403);
  assert.equal((await call(`/api/releases/${encodeURIComponent(rel.id)}/download`, { cookie: sup })).status, 403);
  assert.equal((await call(outputs[0].href, { cookie: ahj })).status, 200);
  assert.equal((await call(`/api/releases/${r1Id}/download`, { cookie: ahj })).status, 403);
  assert.equal((await call(`/api/sites/${H}/access`, { cookie: sup, method: "POST", json: { requirementId: "proposal", view: ["eqore_staff", "supplier"], releaseTo: ["supplier"], note: "let me in" } })).status, 403);
  ok("supplier: plan set file 403, proposal page “Not authorized”, AHJ package PDF/ZIP 403, policy change 403; supplier datasheet 200; AHJ receives its PDF (200) but not seeded R1 (403)");

  // Public visitors no longer see blocker descriptions
  await upload(pm, "SYNTHETIC_Interconnection_Application_RevB.pdf", "ix_application");
  const pub = (await call(`/sites/${H}`)).body.toString();
  const signed = (await call(`/sites/${H}`, { cookie: pm })).body.toString();
  assert.ok(signed.includes("pending engineer review") && !pub.includes("pending engineer review"));
  assert.match(pub, /data-testid="restricted"/);
  ok("signed-out visitors are redirected to a restricted page (no blocker details); EQORE page shows descriptions");

  // 10. Historical release unchanged (and survives a restart with the generated package)
  await stop(); await start();
  const pm2 = await login("arivera", "eqore855");
  assert.ok((await call(`/api/releases/${r1Id}/download`, { cookie: pm2 })).body.equals(r1Zip));
  assert.equal((await call(`/api/releases/${r1Id}/download?format=snapshot`, { cookie: pm2 })).body.sha256, r1Snap);
  const again = await call(outputs[1].href, { cookie: pm2 });
  assert.equal(sha(again.body), outputs[1].sha256);
  for (const p of [`/sites/${H}/releases/${r1Id}`, `/sites/${H}/releases/${encodeURIComponent(rel.id)}`, `/sites/${H}/studio`]) assert.equal((await call(p, { cookie: pm2 })).status, 200);
  ok(`after restart: R1 ZIP byte-identical (sha ${sha(r1Zip).slice(0, 12)}…) and snapshot unchanged; R2 combined PDF still served with the same hash; pages render`);
  console.log(`\nAll ${step} Submission Studio checks passed (${provider}).`);
} finally {
  await stop().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
}
