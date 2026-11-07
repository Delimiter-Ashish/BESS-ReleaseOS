// End-to-end check against a RUNNING server (npm run build && npm start, or npm run dev).
//   BASE=http://localhost:3000 node scripts/e2e.mjs
// Drives the live demo: R1 → upload 600 V Rev B → blocked → unauthorized attempts rejected →
// engineer approval + dependency resolution → R2 → ZIP/hash verification → R1 unchanged.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { verifyReleaseSnapshot } from "../packages/release-core/dist/index.js";

const BASE = process.env.BASE || "http://localhost:3000";
const H = "S-1001";
const sha = (b) => createHash("sha256").update(b).digest("hex");
let step = 0;
const ok = (msg) => console.log(`  ✓ ${String(++step).padStart(2, "0")} ${msg}`);

async function login(userId, passcode) {
  const r = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, passcode }) });
  assert.equal(r.status, 200, `login ${userId}`);
  const c = r.headers.get("set-cookie").split(";")[0];
  return c;
}
const call = (path, { cookie, method = "GET", json, form } = {}) =>
  fetch(`${BASE}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(json ? { "Content-Type": "application/json" } : {}) }, body: json ? JSON.stringify(json) : form });
const upload = (cookie, name, bytes = readFileSync(`sample-docs/${name}`)) => {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: "application/pdf" }), name);
  fd.append("siteId", H);
  return call("/api/extract", { cookie, method: "POST", form: fd });
};
function verifyZip(buf, label) {
  const files = unzipSync(new Uint8Array(buf));
  const snap = JSON.parse(Buffer.from(files["snapshot.json"]).toString("utf8"));
  assert.ok(verifyReleaseSnapshot(snap), `${label} snapshot verifies`);
  for (const m of snap.manifest) assert.equal(sha(files[m.archivePath]), m.sha256, `${label} ${m.archivePath} hash`);
  assert.ok(files["MANIFEST.json"] && files["INDEX.txt"] && files["manifest.json"]);
  return snap;
}

console.log(`E2E against ${BASE}`);
const pm = await login("arivera", "eqore855");
assert.equal((await call("/api/reset", { method: "POST" })).status, 401); ok("unauthenticated reset rejected (401)");
assert.equal((await call("/api/reset", { cookie: pm, method: "POST" })).status, 200); ok("store reset to seed by EQORE PM");

for (const p of ["/", `/sites/${H}`, "/p/S-1002", `/sites/${H}/releases/${H}-ahj_permit-R1`]) assert.equal((await call(p, { cookie: pm })).status, 200, p);
ok("portfolio, site, QR and release pages render (200)");

const r1zip = Buffer.from(await (await call(`/api/releases/${H}-ahj_permit-R1/download`, { cookie: pm })).arrayBuffer());
const r1snap = verifyZip(r1zip, "R1");
assert.equal(r1snap.documents.find((d) => d.family === "switchgear_datasheet").facts.find((f) => f.field === "voltageV").value, 480);
ok(`R1 ZIP verifies (${r1snap.manifest.length} docs, switchgear 480 V, snapshot ${r1snap.sha256.slice(0, 12)}…)`);

assert.equal((await upload(undefined, "SYNTHETIC_Switchgear_Spec_RevB.pdf")).status, 401); ok("unauthenticated upload rejected (401)");
assert.equal((await upload(pm, "fake.pdf", Buffer.from("MZ\x90\x00 this is not a pdf"))).status, 415); ok("spoofed .pdf (non-PDF bytes) rejected (415)");

let r = await upload(pm, "SYNTHETIC_Switchgear_Spec_RevB.pdf");
const ex = await r.json();
assert.equal(r.status, 200, ex.error);
assert.equal(ex.requirementId, "switchgear_datasheet");
assert.equal(ex.sha256, sha(readFileSync("sample-docs/SYNTHETIC_Switchgear_Spec_RevB.pdf")), "server hash = hash of bytes");
const v = ex.diffPreview.find((c) => c.key === "rating.voltage_v");
assert.equal(v.significance, "material"); assert.equal(v.normalizedBefore, "480 V"); assert.equal(v.normalizedAfter, "600 V");
assert.match(v.evidenceAfter, /600 VAC/); assert.equal(v.pageAfter, 2);
ok(`extracted with ${ex.engine}${ex.model ? ` (${ex.model})` : ""}${ex.fallback ? " [fallback]" : ""}: voltage 480 V → 600 V material, evidence p.${v.pageAfter} “${v.evidenceAfter}”`);
const cosmetic = ex.diffPreview.filter((c) => c.significance === "cosmetic").map((c) => c.key);
ok(`cosmetic edits distinguished: ${cosmetic.join(", ") || "(none)"}`);

r = await call(`/api/sites/${H}/revisions`, { cookie: pm, method: "POST", json: { extractionId: ex.extractionId, requirementId: "switchgear_datasheet", source: "supplier", facts: [{ key: "rating.voltage_v", value: "1" }], sha256: "forged" } });
const filed = await r.json();
assert.equal(r.status, 200, filed.error);
assert.equal(filed.revision.sha256, ex.sha256, "client-supplied sha256/facts ignored");
const deps = filed.engineeringTasks.map((t) => t.dependentRequirementId).sort();
assert.deepEqual(deps, ["ix_application", "plan_set"]);
ok(`Rev ${filed.revision.revLabel} filed in review; dependency tasks: ${deps.join(", ")} (client-forged hash/facts ignored)`);

let ready = (await (await call(`/api/sites/${H}/releases`, { cookie: pm })).json()).packages.find((p) => p.templateId === "ahj_permit");
assert.equal(ready.canBuild, false);
ok(`AHJ package blocked: ${ready.issues.map((i) => i.code).join(", ")}`);
const ixPkg = (await (await call(`/api/sites/${H}/releases`, { cookie: pm })).json()).packages.find((p) => p.templateId === "interconnection");
assert.ok(ixPkg.issues.some((i) => i.code === "MISSING_DOCUMENT" && i.requirementId === "utility_bill"));
ok("interconnection package shows MISSING_DOCUMENT (utility bill)");

const eng = await login("mchen", "eng856");
const eng2 = await login("rpatel", "eng855");
const sup = await login("supplier", "supp855");
r = await call(`/api/sites/${H}/releases`, { cookie: eng, method: "POST", json: { templateId: "ahj_permit", note: "attempt while blocked", readinessToken: ready.token } });
assert.equal(r.status, 409); ok("release creation blocked while review unresolved (409)");

assert.equal((await call(`/api/reviews/${filed.review.id}`, { cookie: sup, method: "POST", json: { decision: "approve", note: "supplier says fine", by: "R. Patel, PE" } })).status, 403); ok("supplier approval rejected even when claiming an engineer name (403)");
assert.equal((await call(`/api/reviews/${filed.review.id}`, { cookie: pm, method: "POST", json: { decision: "approve", note: "PM approval" } })).status, 403); ok("non-engineer PM approval rejected (403)");
const forged = pm.replace(/=([^.]+)\./, (_, p) => `=${Buffer.from(JSON.stringify({ u: "rpatel", iat: Date.now() })).toString("base64url")}.`);
assert.equal((await call(`/api/reviews/${filed.review.id}`, { cookie: forged, method: "POST", json: { decision: "approve", note: "forged" } })).status, 401); ok("forged session cookie rejected (401)");
assert.equal((await call(`/api/sites/${H}/releases`, { cookie: sup, method: "POST", json: { templateId: "ahj_permit", note: "x release", readinessToken: ready.token } })).status, 403); ok("supplier release request rejected (403)");
const planTask = filed.engineeringTasks.find((t) => t.dependentRequirementId === "plan_set");
assert.equal((await call(`/api/sites/${H}/tasks/${planTask.id}`, { cookie: eng, method: "POST", json: { note: "premature resolution" } })).status, 409); ok("dependency review cannot be resolved before source approval (409)");

r = await call(`/api/reviews/${filed.review.id}`, { cookie: eng, method: "POST", json: { decision: "approve", note: "Verified 600 VAC rating against supplier submittal (synthetic)" } });
const dec = await r.json();
assert.equal(r.status, 200, dec.error); assert.equal(dec.decision.reviewerId, "mchen");
ok("M. Chen, PE approved switchgear Rev B (recorded with server identity)");
r = await call(`/api/sites/${H}/tasks/${planTask.id}`, { cookie: eng2, method: "POST", json: { note: "ESS-13.0 conductors/OCPD 600 V rated; plan set remains valid (synthetic)" } });
assert.equal(r.status, 200); ok("R. Patel, PE resolved the plan-set dependency review");

ready = (await (await call(`/api/sites/${H}/releases`, { cookie: eng2 })).json()).packages.find((p) => p.templateId === "ahj_permit");
assert.equal(ready.canBuild, true, JSON.stringify(ready.issues));
assert.equal((await call(`/api/sites/${H}/releases`, { cookie: eng2, method: "POST", json: { templateId: "ahj_permit", note: "stale token test", readinessToken: "0".repeat(64) } })).status, 409); ok("stale readiness token rejected (409)");
r = await call(`/api/sites/${H}/releases`, { cookie: eng2, method: "POST", json: { templateId: "ahj_permit", note: "R2: switchgear Rev B (600 VAC) approved; plan set confirmed", readinessToken: ready.token } });
const built = await r.json();
assert.equal(r.status, 200, built.error); assert.equal(built.release.number, 2);
ok(`Release ${built.release.id} built and sealed (snapshot ${built.release.snapshotSha256.slice(0, 12)}…)`);

const r2res = await call(`/api/releases/${built.release.id}/download`, { cookie: pm });
const r2zip = Buffer.from(await r2res.arrayBuffer());
assert.equal(r2res.headers.get("x-zip-sha256"), sha(r2zip));
const r2snap = verifyZip(r2zip, "R2");
assert.equal(r2snap.documents.find((d) => d.family === "switchgear_datasheet").facts.find((f) => f.field === "voltageV").value, 600);
ok(`R2 ZIP verifies: all ${r2snap.manifest.length} document hashes match; switchgear 600 V`);

const r1again = Buffer.from(await (await call(`/api/releases/${H}-ahj_permit-R1/download`, { cookie: pm })).arrayBuffer());
assert.ok(r1again.equals(r1zip), "R1 ZIP byte-identical");
ok(`R1 unchanged: ZIP byte-identical (sha ${sha(r1zip).slice(0, 12)}…)`);

const cmp = await (await call(`/api/releases/compare?from=${H}-ahj_permit-R1&to=${built.release.id}`, { cookie: pm })).json();
assert.equal(cmp.core.updated.length, 1);
assert.deepEqual(cmp.core.updated[0].semanticChanges.find((c) => c.field === "voltageV").newValue, [600]);
ok("R1 → R2 comparison (frozen snapshots): 1 updated document, voltageV [480] → [600]");
for (const p of [`/sites/${H}`, `/sites/${H}/releases/${built.release.id}?compare=${H}-ahj_permit-R1`, `/sites/${H}/documents/${encodeURIComponent(filed.revision.id)}`]) assert.equal((await call(p, { cookie: eng })).status, 200, p);
ok("site, release comparison and document intelligence pages render after the workflow");
console.log(`\nAll ${step} end-to-end checks passed.`);
