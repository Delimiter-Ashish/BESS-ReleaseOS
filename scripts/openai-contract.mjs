// OFFLINE contract test for the OpenAI provider (no API key, no network egress).
// Runs a mock Responses API on :3199, starts the built app on :3101 with
//   AI_PROVIDER=openai OPENAI_API_KEY=test-key OPENAI_BASE_URL=http://127.0.0.1:3199/v1
// and checks: the request shape (PDF input_file, strict json_schema, model), grounding of a deliberately
// wrong model answer, the advisory explanation call, and fallback labeling on a malformed response.
// This proves the wiring — it is NOT a substitute for one real call (see README "Live OpenAI check").
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const MOCK = 3199, APP = 3101, BASE = `http://127.0.0.1:${APP}`;
const requests = [];
let mode = "good";

const extraction = {
  requirementId: "switchgear_datasheet", docTypeConfidence: 0.97, title: "NPS-SG-4000 Switchgear Specification", documentNumber: "NPS-SG-4000-SPEC",
  revisionLabel: "B", effectiveDate: "2026-10-28", manufacturer: "Northbridge Power Systems", summary: "Switchgear specification Rev B; voltage class revised to 600 VAC.",
  isScannedOrImageBased: false,
  facts: [
    { key: "rating.voltage_v", label: "Rated voltage", value: "600", unit: "VAC", evidence: "Rated voltage: 600 VAC, 3-phase, 4-wire", page: 1, confidence: 0.96, status: "found", note: null }, // wrong page on purpose
    { key: "rating.current_a", label: "Rated continuous current", value: "400", unit: "A", evidence: "Rated continuous current: 400 A", page: 2, confidence: 0.95, status: "found", note: null },
    { key: "rating.interrupting_ka", label: "Interrupting rating", value: "65,000", unit: "A", evidence: "Interrupting rating: 65,000 A symmetrical", page: 2, confidence: 0.9, status: "found", note: null },
    { key: "equipment.model", label: "Model", value: "NSG-4000", unit: null, evidence: "Model: NSG-4000", page: 2, confidence: 0.98, status: "found", note: null },
    { key: "equipment.manufacturer", label: "Manufacturer", value: "Northbridge Power Systems", unit: null, evidence: "Manufacturer: Northbridge Power Systems", page: 2, confidence: 0.98, status: "found", note: null },
    { key: "rating.frequency_hz", label: "Frequency", value: "60", unit: "Hz", evidence: "Frequency: 60 Hz", page: 2, confidence: 0.95, status: "found", note: null },
    { key: "enclosure.rating", label: "Enclosure", value: "NEMA Type 3R", unit: null, evidence: "Enclosure rating: NEMA Type 3R", page: 2, confidence: 0.9, status: "found", note: null },
    { key: "equipment.quantity", label: "Quantity", value: "1", unit: null, evidence: "Quantity: 1", page: 2, confidence: 0.9, status: "found", note: null },
    { key: "listing.standard", label: "Listing", value: "UL 891", unit: null, evidence: "Listing standard: UL 891", page: 2, confidence: 0.9, status: "found", note: null },
    { key: "revision.label", label: "Revision", value: "B", unit: null, evidence: "Revision: B", page: 1, confidence: 0.99, status: "found", note: null },
    { key: "doc.date", label: "Date", value: "2026-10-28", unit: null, evidence: "Date: 2026-10-28", page: 1, confidence: 0.99, status: "found", note: null },
    { key: "doc.number", label: "Document number", value: "NPS-SG-4000-SPEC", unit: null, evidence: "Document No.: NPS-SG-4000-SPEC", page: 1, confidence: 0.99, status: "found", note: null },
    { key: "rating.power_kw", label: "Power", value: "999", unit: "kW", evidence: "Power rating: 999 kW", page: 2, confidence: 0.8, status: "found", note: null }, // invented
  ],
  missingItems: [], warnings: [], embeddedInstructionsDetected: [],
};
const explanation = { summary: "The switchgear voltage class increased from 480 V to 600 V; dependent drawings may need review.", changes: [{ key: "rating.voltage_v", impact: "MOCK-AI: verify 600 V insulation class on ESS-13.0 conductors and labels.", suggestedRequirementIds: ["plan_set", "signage"] }] };

const respond = (obj) => ({ id: "resp_mock", object: "response", created_at: 0, status: "completed", model: "gpt-5.5-mock", output: [{ type: "message", id: "msg_mock", role: "assistant", status: "completed", content: [{ type: "output_text", text: typeof obj === "string" ? obj : JSON.stringify(obj), annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });

const mock = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const j = JSON.parse(body || "{}");
    requests.push({ url: req.url, auth: req.headers.authorization, body: j });
    res.setHeader("content-type", "application/json");
    if (mode === "malformed") return res.end(JSON.stringify(respond("this is not json {")));
    const name = j.text?.format?.name;
    res.end(JSON.stringify(respond(name === "bess_change_explanation" ? explanation : extraction)));
  });
});
await new Promise((r) => mock.listen(MOCK, "127.0.0.1", r));

const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(APP)], { env: { ...process.env, AI_PROVIDER: "openai", OPENAI_API_KEY: "test-key", OPENAI_BASE_URL: `http://127.0.0.1:${MOCK}/v1`, OPENAI_MODEL: "gpt-5.5" }, stdio: "ignore" });
const stop = () => { app.kill(); mock.close(); };
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/api/session`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  const lr = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: "arivera", passcode: "eqore855" }) });
  const cookie = lr.headers.get("set-cookie").split(";")[0];
  await fetch(`${BASE}/api/reset`, { method: "POST", headers: { cookie } });
  const up = async () => {
    const fd = new FormData();
    fd.append("file", new Blob([readFileSync("sample-docs/SYNTHETIC_Switchgear_Spec_RevB.pdf")], { type: "application/pdf" }), "SYNTHETIC_Switchgear_Spec_RevB.pdf");
    fd.append("siteId", "S-1001");
    return (await fetch(`${BASE}/api/extract`, { method: "POST", headers: { cookie }, body: fd })).json();
  };

  const ex = await up();
  assert.equal(ex.ok, true, ex.error);
  const [r1, r2] = requests;
  assert.equal(r1.url, "/v1/responses");
  assert.equal(r1.auth, "Bearer test-key");
  assert.equal(r1.body.model, "gpt-5.5");
  assert.equal(r1.body.store, false);
  assert.equal(r1.body.text.format.type, "json_schema");
  assert.equal(r1.body.text.format.strict, true);
  const file = r1.body.input[0].content.find((c) => c.type === "input_file");
  assert.ok(file.file_data.startsWith("data:application/pdf;base64,JVBERi0"), "PDF bytes sent as input_file");
  assert.match(r1.body.instructions, /untrusted DATA/);
  console.log("  ✓ request: POST /v1/responses, model gpt-5.5, strict json_schema, PDF input_file, store=false, injection-hardened instructions");

  assert.equal(ex.engine, "openai"); assert.equal(ex.fallback, false); assert.equal(ex.model, "gpt-5.5-mock");
  const volt = ex.facts.find((f) => f.key === "rating.voltage_v");
  assert.equal(volt.page, 2); assert.equal(volt.evidenceVerified, true); assert.match(volt.note, /corrected/);
  const invented = ex.facts.find((f) => f.key === "rating.power_kw");
  assert.equal(invented.evidenceVerified, false); assert.equal(invented.status, "uncertain");
  console.log("  ✓ grounding: wrong page corrected to p.2 from the text layer; invented 999 kW marked uncertain/unverified");

  const d = ex.diffPreview.find((c) => c.key === "rating.voltage_v");
  assert.equal(d.significance, "material"); assert.equal(d.impactSource, "openai"); assert.match(d.impact, /MOCK-AI/);
  assert.equal(r2.body.text.format.name, "bess_change_explanation");
  assert.equal(ex.aiSummary.source, "openai");
  console.log("  ✓ explanation call made; AI impact attached to the material change; release gates unchanged (rules)");

  mode = "malformed";
  const bad = await up();
  assert.equal(bad.ok, true); assert.equal(bad.fallback, true); assert.equal(bad.engine, "rules");
  assert.match(bad.warnings[0], /Deterministic fallback used — openai extraction failed: OpenAI returned malformed JSON/);
  console.log("  ✓ malformed model output → labeled deterministic fallback (no crash, no silent AI claim)");
  console.log("\nOpenAI provider contract test passed (mock endpoint; no real API call was made).");
} finally {
  stop();
}
