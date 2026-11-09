import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { encodeSession, type Session } from "../lib/auth";
import * as store from "../lib/store";
import { rulesExtract, extractDocument } from "../lib/extract";
import { readTextLayer } from "../lib/pdf";
import { PDF_SAFE_OPTIONS } from "../lib/pdf-options";
import { lifecycleAction } from "../lib/lifecycle/ops";
import { defaultGroups, PURPOSES, studioCheck, selectionFrom } from "../lib/studio/check";
import { generateStudioRelease } from "../lib/studio/generate";
import { packageReadiness, releaseStatus } from "../lib/release";
import { TEMPLATE_BY_ID } from "../lib/requirements";
import { recordCommunication, validateImport, confirmItem, dismissItem } from "../lib/memory/register";
import { rulesAnalyzeCommunication } from "../lib/memory/rules";
import { groundCommunication } from "../lib/memory/schema";
import { parseEmailHeaders } from "../lib/memory/email";
import { decisionLabel } from "../lib/activity";
import { beginUpload, checkStorageQuota, reserveAiCall, takeRate } from "../lib/resource-limits";
import { jsonBody } from "../lib/http";
import { GET as compare } from "../app/api/extract/[id]/route";
import { POST as extract } from "../app/api/extract/route";
import { GET as releaseReadiness } from "../app/api/sites/[id]/releases/route";
import { POST as login } from "../app/api/login/route";

const H = "S-1001";
const PM: Session = { userId: "kaushik", name: "PM", role: "eqore", engineer: false, roles: ["eqore"] };
const ENG: Session = { userId: "rpatel", name: "Engineer", role: "eqore", engineer: true, roles: ["eqore", "engineer"] };
const FAC: Session = { userId: "facility", name: "Facility", role: "facility", engineer: false, roles: ["facility"] };
const cookie = (id: string) => `ros_session=${encodeSession(id)}`;
const status = (n: number) => (e: unknown) => (e as { status: number }).status === n;
const env = (values: Record<string, string>) => {
  const old = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  Object.assign(process.env, values);
  return () => { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
};

async function preview(userId = "supplier") {
  const bytes = readFileSync("sample-docs/SYNTHETIC_Switchgear_Spec_RevB.pdf");
  const layer = await readTextLayer("application/pdf", bytes);
  const f = store.putFile("audit.pdf", "application/pdf", bytes);
  return store.saveExtraction({ siteId: H, fileId: f.fileId, sha256: f.sha256, fileName: "audit.pdf", mediaType: "application/pdf", textLayer: layer.joined, pageCount: layer.pageCount, result: { ...rulesExtract("audit.pdf", layer), provider: "rules", fallback: false }, impacts: {}, createdBy: userId });
}

function importRequirement() {
  const body = readFileSync("sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt", "utf8");
  const h = parseEmailHeaders(body);
  const input = validateImport({ body, sender: h.from, sentAt: h.date, channel: "ahj_comment" });
  const analysis = { ...groundCommunication(rulesAnalyzeCommunication(body, { channel: "ahj_comment", sender: input.sender }), body), engine: "rules" as const, fallback: false };
  return recordCommunication(H, input, analysis, PM).items.find((m) => m.requirementId === "ventilation_plan")!;
}

test("PDF viewing and extraction disable eval and ship a matching patched worker", async () => {
  assert.equal(PDF_SAFE_OPTIONS.isEvalSupported, false);
  const pkg = JSON.parse(readFileSync("node_modules/pdfjs-dist/package.json", "utf8"));
  assert.equal(pkg.version, "4.10.38");
  assert.deepEqual(readFileSync("public/pdf.worker.min.mjs"), readFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs"));
  const viewer = readFileSync("components/evidence/PdfViewer.tsx", "utf8");
  assert.match(viewer, /getDocument\(\{ data, \.\.\.PDF_SAFE_OPTIONS \}\)/);
  const layer = await readTextLayer("application/pdf", readFileSync("sample-docs/SYNTHETIC_Switchgear_Spec_RevB.pdf"));
  assert.ok(layer.joined.includes("600"));
});

test("comparison route denies private baselines but permits shared ones and enforces extraction ownership", async () => {
  store.resetStore();
  const ex = await preview();
  const get = (rid: string, id = "supplier") => compare(new Request(`http://test/api/extract/${ex.id}?requirementId=${rid}`, { headers: { cookie: cookie(id) } }), { params: Promise.resolve({ id: ex.id }) });
  const privateReadiness = await releaseReadiness(new Request(`http://test/api/sites/${H}/releases`, { headers: { cookie: cookie("supplier") } }), { params: Promise.resolve({ id: H }) });
  assert.equal(privateReadiness.status, 403, "readiness must not expose internal evidence through an alternate endpoint");
  const denied = await get("plan_set");
  assert.equal(denied.status, 403);
  assert.ok(!(await denied.text()).includes("SYNTHETIC_Plan_Set"));
  const allowed = await get("switchgear_datasheet");
  assert.equal(allowed.status, 200);
  assert.ok((await allowed.json()).previous);
  assert.equal((await get("switchgear_datasheet", "kaushik")).status, 404);
});

test("initial extraction never discloses confidential baseline/duplicate evidence", async () => {
  store.resetStore();
  const restore = env({ AI_PROVIDER: "rules" });
  try {
    const form = new FormData();
    form.append("siteId", H);
    form.append("file", new Blob([readFileSync("sample-docs/SYNTHETIC_Plan_Set_RevB.pdf")], { type: "application/pdf" }), "plan_set.pdf");
    const res = await extract(new Request("http://test/api/extract", { method: "POST", headers: { cookie: cookie("supplier") }, body: form }));
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.previous, null);
    assert.equal(out.duplicateOf, null);
    assert.deepEqual(out.diffPreview, []);
    assert.deepEqual(out.dependentsPreview, []);
  } finally { restore(); }
});

test("facility mutations require project sharing and obligation-specific permission", async () => {
  store.resetStore();
  const change = { action: "propose_change" as const, kind: "inverter_replace" as const, effectiveDate: "2026-11-01", description: "Synthetic replacement", from: "old", to: "new" };
  const untouched = JSON.stringify(store.getSite("S-1005"));
  await assert.rejects(lifecycleAction("S-1005", change, FAC), status(403));
  assert.equal(JSON.stringify(store.getSite("S-1005")), untouched);
  await lifecycleAction(H, change, FAC);
  await assert.rejects(lifecycleAction(H, { ...change, memoryItemId: "private-memory" }, FAC), status(403));
  const ob = store.getSite(H)!.lifecycle!.obligations.find((o) => o.requirementId === "sds")!;
  await assert.rejects(lifecycleAction(H, { action: "record_event", obligationId: ob.id, type: "inspection", performedOn: "2026-11-01", performedBy: "Facility", summary: "Inspection evidence" }, FAC), status(403));
});

test("invalid lifecycle settings and obligation dates leave the complete site unchanged", async () => {
  store.resetStore();
  const before = JSON.stringify(store.getSite(H));
  for (const settings of [{ warningDays: 123, timezone: "invalid/zone" }, { warningDays: -1, timezone: "UTC" }]) {
    await assert.rejects(lifecycleAction(H, { action: "settings", ...settings, note: "Audit settings validation" }, PM), status(400));
    assert.equal(JSON.stringify(store.getSite(H)), before);
  }
  await assert.rejects(lifecycleAction(H, { action: "add_obligation", requirementId: "ops_record", category: "operations_records", title: "Invalid date obligation", kind: "record", dueDate: "2026-02-30", note: "Audit date validation" }, PM), status(400));
  assert.equal(JSON.stringify(store.getSite(H)), before);
  await lifecycleAction(H, { action: "settings", warningDays: 21, timezone: "UTC", note: "Valid settings" }, PM);
  assert.equal(store.getSite(H)!.lifecycle!.warningDays, 21);
});

test("confirmed requirements make historical releases stale without changing frozen bytes", () => {
  store.resetStore();
  const site = store.getSite(H)!, r1 = store.getRelease(`${H}-ahj_permit-R1`)!;
  const frozen = JSON.stringify(r1.snapshot);
  const m = importRequirement();
  assert.equal(releaseStatus(site, r1).state, "current", "suggestion does not change freshness");
  confirmItem(H, m.id, PM, { note: "AHJ requires ventilation", blocking: true, templateIds: ["ahj_permit"], requirementId: "ventilation_plan" });
  assert.equal(releaseStatus(site, r1).state, "stale");
  assert.equal(packageReadiness(site, TEMPLATE_BY_ID.ahj_permit).canBuild, false);
  assert.equal(JSON.stringify(r1.snapshot), frozen);
  dismissItem(H, m.id, PM, "AHJ withdrew this request");
  assert.equal(releaseStatus(site, r1).state, "current");
});

test("identical legacy signoff requests return one release and one decision", () => {
  store.resetStore();
  const token = packageReadiness(store.getSite(H)!, TEMPLATE_BY_ID.ahj_permit).token;
  const n = store.getReleases(H).length;
  const first = store.buildRelease(H, "ahj_permit", ENG, "Issuing audit package", token);
  const second = store.buildRelease(H, "ahj_permit", ENG, "Issuing audit package", token);
  assert.equal(second.id, first.id);
  assert.equal(store.getReleases(H).length, n + 1);
  assert.equal(store.getDecisions(H).filter((d) => d.releaseId === first.id).length, 1);
  assert.throws(() => store.buildRelease(H, "ahj_permit", PM, "Issuing audit package", token), status(403));
});

test("concurrent Studio signoff retries and retries after restart return the same frozen release", async () => {
  const dir = mkdtempSync(join(tmpdir(), "releaseos-signoff-test-"));
  const restore = env({ RELEASEOS_PERSIST: "on", RELEASEOS_DATA_DIR: dir });
  try {
    store.resetStore();
    const site = store.getSite(H)!;
    const sel = selectionFrom({ purpose: "ahj", groups: defaultGroups(site, PURPOSES[0]) });
    const check = studioCheck(site, store.getReleases(H), sel, store.bytesFor);
    assert.equal(check.canGenerate, true);
    const n = store.getReleases(H).length;
    const [a, b] = await Promise.all([1, 2].map(() => generateStudioRelease(H, sel, ENG, "Issuing Studio package", check.token)));
    assert.equal(a.release.id, b.release.id);
    assert.deepEqual(a.outputs, b.outputs);
    assert.equal(store.getReleases(H).length, n + 1);
    store.reloadFromDisk();
    const c = await generateStudioRelease(H, sel, ENG, "Issuing Studio package", check.token);
    assert.equal(c.release.snapshot!.sha256, a.release.snapshot!.sha256);
    assert.deepEqual(c.outputs, a.outputs);
  } finally { restore(); rmSync(dir, { recursive: true, force: true }); store.resetStore(); }
});

test("public demo bounds concurrency, request rates, storage and persistent paid-call budget", async () => {
  const dir = mkdtempSync(join(tmpdir(), "releaseos-budget-test-"));
  const restore = env({ RELEASEOS_PUBLIC_DEMO: "1", RELEASEOS_PERSIST: "on", RELEASEOS_DATA_DIR: dir, DEMO_AI_CALLS_PER_DAY: "2", DEMO_STORAGE_MB: "1", AI_PROVIDER: "openai", OPENAI_API_KEY: "unused-budget-test-key" });
  try {
    takeRate("regression", 1, 1000, 1000);
    assert.throws(() => takeRate("regression", 1, 1000, 1001), status(429));
    takeRate("regression", 1, 1000, 2000);
    const finish = [1, 2, 3, 4].map(() => beginUpload());
    assert.throws(() => beginUpload(), status(429));
    finish.forEach((f) => f());
    beginUpload()();
    assert.throws(() => checkStorageQuota(1024 * 1024, 1), status(413));
    checkStorageQuota(0, 1024);
    reserveAiCall(); reserveAiCall();
    assert.throws(() => reserveAiCall(), status(429));
    // The counter stays outside state.json, and therefore survives both a reset and a restart.
    store.resetStore(); store.reloadFromDisk();
    assert.throws(() => reserveAiCall(), status(429));
    const bytes = Buffer.from("Rated voltage: 600 VAC");
    const layer = await readTextLayer("text/plain", bytes);
    const out = await extractDocument({ fileName: "switchgear.txt", media: "text/plain", bytes, layer, siteName: "Synthetic", siteFacts: "" });
    assert.equal(out.engine, "rules");
    assert.equal(out.fallback, true);
    assert.match(out.fallbackReason!, /Daily demo AI limit/);
    writeFileSync(join(dir, "ai-usage.json"), "broken");
    assert.throws(() => reserveAiCall(), status(503), "fail closed when counter is corrupt");
  } finally { restore(); rmSync(dir, { recursive: true, force: true }); store.resetStore(); }
});

test("body limits use actual bytes without trusting content-length; unicode login safely rejects", async () => {
  await assert.rejects(jsonBody(new Request("http://test", { method: "POST", body: '{"x":"ééé"}' }), 12), status(413));
  const res = await login(new Request("http://test/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: "rpatel", passcode: "éééééé" }) }));
  assert.equal(res.status, 401);
});

test("lifecycle and emergency decisions are not mislabeled as release signoffs", () => {
  const base = { id: "d", siteId: H, taskIds: [], decision: "resolved" as const, reviewerId: ENG.userId, reviewerName: ENG.name, reviewerRoles: ENG.roles, note: "Reviewed", at: "2026-11-08" };
  assert.match(decisionLabel({ ...base, kind: "lifecycle_review" }), /lifecycle/);
  assert.match(decisionLabel({ ...base, kind: "emergency_publication" }), /emergency information/);
  assert.equal(decisionLabel({ ...base, kind: "release_signoff" }), "Signed off a release");
});
