// Project Assurance UI acceptance checks against a RUNNING server (resets the in-memory store first).
//   BASE=http://localhost:3000 node scripts/e2e-assurance.mjs
// Scenario: Century Tywood switchgear Rev B (400 A → 600 A) uploaded alongside other files, reviewed in the
// multi-item inbox, dependency acknowledged, readiness recalculated, R2 built by the real release API.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";

const BASE = process.env.BASE || "http://localhost:3000";
const H = "S-1001";
const sha = (b) => createHash("sha256").update(b).digest("hex");
let step = 0;
const ok = (m) => console.log(`  ✓ ${String(++step).padStart(2, "0")} ${m}`);
async function login(userId, passcode) {
  const r = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, passcode }) });
  assert.equal(r.status, 200, `login ${userId}`);
  return r.headers.get("set-cookie").split(";")[0];
}
const call = (path, { cookie, method = "GET", json, form } = {}) => fetch(`${BASE}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(json ? { "Content-Type": "application/json" } : {}) }, body: json ? JSON.stringify(json) : form });
const ws = async (cookie, rd) => (await (await call(`/api/workspace${rd ? `?readiness=${rd}` : ""}`, { cookie })).json());
const extract = (cookie, path, site = H) => {
  const fd = new FormData();
  fd.append("file", new Blob([readFileSync(`sample-docs/${path}`)], { type: "application/pdf" }), path.split("/").pop());
  fd.append("siteId", site);
  return call("/api/extract", { cookie, method: "POST", form: fd }).then(async (r) => ({ status: r.status, j: await r.json() }));
};
const file = (cookie, ex, rid, site = H) => call(`/api/sites/${site}/revisions`, { cookie, method: "POST", json: { extractionId: ex.extractionId, requirementId: rid } }).then((r) => r.json());

console.log(`Project Assurance E2E against ${BASE}`);
const pm = await login("kaushik", "pm855");
assert.equal((await call("/api/reset", { cookie: pm, method: "POST" })).status, 200);
const w0 = await ws(pm);
assert.equal(w0.projects.length, 5);
assert.ok(w0.projects.some((p) => p.id === H && p.name === "Century Tywood J3 Corp"));
ok(`store reset; CSV-backed portfolio of ${w0.projects.length} projects; metrics ${JSON.stringify(w0.metrics)}`);

// 1. Multiple PDFs uploaded independently and concurrently (pending reviews never block other uploads)
const [a, b, c] = await Promise.all([
  extract(pm, "SYNTHETIC_Switchgear_Spec_RevB_600A.pdf"),
  extract(pm, "SYNTHETIC_Plan_Set_RevC.pdf"),
  extract(pm, "demo/SYNTHETIC_Granite_Inverter_Datasheet_RevA.pdf", "S-1004"),
]);
for (const x of [a, b, c]) assert.equal(x.status, 200, x.j.error);
const cur = a.j.diffPreview.find((d) => d.key === "rating.current_a");
assert.equal(cur.significance, "material"); assert.equal(cur.normalizedBefore, "400 A"); assert.equal(cur.normalizedAfter, "600 A"); assert.equal(cur.pageAfter, 2);
ok(`3 files extracted concurrently; switchgear current 400 A → 600 A (material, p.${cur.pageAfter} “${cur.evidenceAfter}”) via ${a.j.engine}${a.j.fallback ? " [fallback]" : ""}`);
const fa = await file(pm, a.j, "switchgear_datasheet");
assert.ok(fa.ok, fa.error);
const fb = await file(pm, b.j, "plan_set");
assert.ok(fb.ok, fb.error);
const fc = await file(pm, c.j, "inverter_datasheet", "S-1004");
assert.ok(fc.ok, fc.error);
assert.deepEqual(fa.engineeringTasks.map((t) => t.dependentRequirementId).sort(), ["ix_application", "plan_set"]);
ok(`all 3 filed while earlier ones were still pending; switchgear Rev ${fa.revision.revLabel} raised dependency reviews: plan_set, ix_application`);

// 2. Multiple documents in the review inbox
let w = await ws(pm);
const openRev = w.reviews.filter((r) => r.kind === "revision" && r.open);
assert.equal(openRev.length, 5 + 3);
assert.ok(w.reviews.filter((r) => r.kind === "dependency" && r.open).length >= 2);
const reviewsHtml = await (await call("/reviews", { cookie: pm })).text();
for (const n of ["Century Tywood J3 Corp", "Granite Precision Machining", "Harbor Food Processing", "Redwood Electronics Assembly"]) assert.ok(reviewsHtml.includes(n), n);
ok(`review inbox lists ${openRev.length} pending revisions + ${w.reviews.filter((r) => r.kind === "dependency" && r.open).length} dependency reviews across 4 projects`);

// 5. counts derive from the store
assert.equal(w.metrics.pendingReviews, w0.metrics.pendingReviews + 3);
assert.equal(w.metrics.liveUploads, 3);
assert.equal(w.metrics.documentsReceived, w0.metrics.documentsReceived + 3);
ok(`dashboard counts updated from records: pending ${w0.metrics.pendingReviews} → ${w.metrics.pendingReviews}, documents ${w0.metrics.documentsReceived} → ${w.metrics.documentsReceived}`);

// 3. Evidence opens the REAL source document
const swItem = w.reviews.find((r) => r.id === fa.review.id);
const ev = swItem.evidence[0];
assert.equal(ev.revisionId, fa.revision.id); assert.equal(ev.page, 2); assert.match(ev.quote, /600 A/);
const bytes = Buffer.from(await (await call(`/api/files/${ev.fileId}`, { cookie: pm })).arrayBuffer());
assert.equal(sha(bytes), sha(readFileSync("sample-docs/SYNTHETIC_Switchgear_Spec_RevB_600A.pdf")));
const prevEv = swItem.evidence[1];
const prevBytes = Buffer.from(await (await call(`/api/files/${prevEv.fileId}`, { cookie: pm })).arrayBuffer());
assert.equal(sha(prevBytes), sha(readFileSync("sample-docs/SYNTHETIC_Switchgear_Spec_RevA.pdf")));
ok(`evidence for the switchgear review = uploaded PDF bytes (sha match), page ${ev.page}, “${ev.quote}”; previous = real Rev A PDF`);
assert.equal((await call(`/api/files/${ev.fileId}`)).status, 401);
ok("original files require a session (401 when signed out)");

// 6. Action Center findings link to source records
const fnd = w.findings.find((f) => f.id === `REV-${fa.review.id}`);
assert.ok(fnd && fnd.lifecycle === "action_required" && fnd.blocking.includes("Town Permit Application"));
assert.equal((await call(fnd.href, { cookie: pm })).status, 200);
const dep = w.findings.find((f) => f.type === "engineering_conflict" && f.projectId === H && f.lifecycle === "detected");
assert.ok(dep, "dependency finding detected, waiting on source approval");
const miss = w.findings.find((f) => f.id === `MISS-${H}-utility_bill`);
assert.ok(miss && miss.href.startsWith("/inbox?project=S-1001&expect=utility_bill"));
assert.ok(!w.findings.some((f) => f.type === "missing_document" && f.projectId === H && f.requirementId === "om_manual"), "operations docs are not yet required at permitting");
ok(`findings: revision review blocks AHJ package → ${fnd.href}; dependency “${dep.lifecycle}”; missing utility bill → import; O&M manual not counted (not yet required)`);

// 7. Readiness responds to state
let rd = (await ws(pm, `${H}:ahj_permit`)).readiness;
assert.equal(rd.status, "needs_review"); assert.equal(rd.canBuild, false);
assert.ok(rd.items.find((i) => i.requirementId === "switchgear_datasheet").href.includes(fa.review.id));
ok(`AHJ readiness: ${rd.status} (${rd.items.filter((i) => i.state !== "ready").map((i) => i.requirementId).join(", ")}); blocker links to review ${fa.review.id}`);

// 4. Reviewing A never approves B
const eng = await login("mchen", "eng856");
const eng2 = await login("rpatel", "eng855");
assert.equal((await call(`/api/reviews/${fa.review.id}`, { cookie: pm, method: "POST", json: { decision: "approve", note: "PM cannot" } })).status, 403);
let r = await call(`/api/reviews/${fa.review.id}`, { cookie: eng, method: "POST", json: { decision: "approve", note: "Verified 600 A continuous rating against supplier submittal (synthetic)" } });
assert.equal(r.status, 200, (await r.clone().json()).error);
w = await ws(pm);
assert.equal(w.reviews.find((x) => x.id === fb.review.id).status, "open");
assert.equal(w.reviews.find((x) => x.id === fc.review.id).status, "open");
assert.equal(w.reviews.filter((x) => x.kind === "revision" && x.open).length, 7);
ok("approved switchgear Rev B only; plan set Rev C and the S-1004 upload remain pending (PM approval rejected 403)");

// 8. Newer approved revision makes R1 outdated
const r1 = w.findings.find((f) => f.id === `REL-${H}-ahj_permit-R1`);
assert.ok(r1 && r1.backendStatus === "stale");
ok(`R1 is now ${r1.backendStatus}: ${r1.detail}`);

// Dependency acknowledged by an engineer after inspection; plan set Rev C is rejected (not needed)
const planTask = fa.engineeringTasks.find((t) => t.dependentRequirementId === "plan_set");
assert.equal((await call(`/api/reviews/${fb.review.id}`, { cookie: eng2, method: "POST", json: { decision: "reject", note: "Rev C addresses a voltage change, not this current change" } })).status, 200);
rd = (await ws(pm, `${H}:ahj_permit`)).readiness;
assert.equal(rd.canBuild, false); assert.equal(rd.items.find((i) => i.requirementId === "plan_set").state, "needs_eng_review");
ok("unresolved plan-set dependency still blocks the replacement release");
assert.equal((await call(`/api/sites/${H}/tasks/${planTask.id}`, { cookie: eng2, method: "POST", json: { note: "ESS-13.0 OCPD and conductors sized for 600 A; plan set remains valid (synthetic)" } })).status, 200);
rd = (await ws(pm, `${H}:ahj_permit`)).readiness;
assert.equal(rd.status, "ready"); assert.equal(rd.canBuild, true);
const ix = (await ws(pm, `${H}:interconnection`)).readiness;
assert.equal(ix.canBuild, false);
ok("plan-set dependency resolved by R. Patel, PE → AHJ package Ready (interconnection still blocked by its own items only)");

// 9. Real release backend: R2 + ZIP + manifest + comparison
r = await call(`/api/sites/${H}/releases`, { cookie: eng2, method: "POST", json: { templateId: "ahj_permit", note: "R2: switchgear Rev B 600 A approved; plan set confirmed", readinessToken: rd.token } });
const built = await r.json();
assert.equal(r.status, 200, built.error); assert.equal(built.release.number, 2);
const zip = unzipSync(new Uint8Array(await (await call(`/api/releases/${built.release.id}/download`, { cookie: pm })).arrayBuffer()));
const snap = JSON.parse(Buffer.from(zip["snapshot.json"]).toString("utf8"));
for (const m of snap.manifest) assert.equal(sha(zip[m.archivePath]), m.sha256);
assert.ok(zip["MANIFEST.json"] && zip["INDEX.txt"]);
const cmp = await (await call(`/api/releases/compare?from=${H}-ahj_permit-R1&to=${built.release.id}`, { cookie: pm })).json();
assert.deepEqual(cmp.core.updated[0].semanticChanges.find((x) => x.field === "currentA")?.newValue, [600]);
ok(`R2 sealed by release API; ZIP hashes verify (${snap.manifest.length} docs); R1→R2: currentA [400] → [600]`);
rd = (await ws(pm, `${H}:ahj_permit`)).readiness;
assert.equal(rd.releases[0].number, 2); assert.equal(rd.releases[0].state, "current"); assert.equal(rd.releases[1].state, "stale");
ok("release history: R2 current, R1 outdated (unchanged)");

// 10. Routes + filters render
for (const p of ["/", "/inbox", "/inbox?project=S-1003&expect=battery_datasheet", "/projects", "/projects?view=register", `/projects/${H}?doc=switchgear_datasheet`, "/memory", `/memory?project=${H}&type=missing_document`, "/reviews?status=all", `/reviews?item=${encodeURIComponent(fa.review.id)}`, "/submissions", "/submissions?status=blocked", `/submissions?project=${H}&package=ahj_permit`, `/sites/${H}`, `/sites/${H}/releases/${built.release.id}?compare=${H}-ahj_permit-R1`, "/p/S-1002"])
  assert.equal((await call(p, { cookie: pm })).status, 200, p);
assert.equal((await call("/projects/S-9999", { cookie: pm })).status, 404);
ok("all screens and filtered routes render (200); unknown project 404");
console.log(`\nAll ${step} Project Assurance checks passed.`);
