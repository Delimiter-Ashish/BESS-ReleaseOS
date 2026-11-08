// LIVE OpenAI check (makes ONE real, billable API call with a SYNTHETIC PDF only).
// 1) put OPENAI_API_KEY and AI_PROVIDER=openai in .env.local   2) npm run build && npm start
// 3) BASE=http://localhost:3000 node scripts/openai-live.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const BASE = process.env.BASE || "http://localhost:3000";
const FILE = "sample-docs/SYNTHETIC_Switchgear_Spec_RevB.pdf"; // synthetic — never point this at customer documents
const lr = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: "arivera", passcode: "eqore855" }) });
const cookie = lr.headers.get("set-cookie").split(";")[0];
const fd = new FormData();
fd.append("file", new Blob([readFileSync(FILE)], { type: "application/pdf" }), FILE.split("/").pop());
fd.append("siteId", "S-1001");
const t0 = Date.now();
const ex = await (await fetch(`${BASE}/api/extract`, { method: "POST", headers: { cookie }, body: fd })).json();
console.log(`engine=${ex.engine} model=${ex.model} fallback=${ex.fallback} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (ex.fallback) console.log("fallback reason:", ex.fallbackReason);
for (const f of ex.facts ?? []) console.log(`  ${f.key.padEnd(24)} ${String(f.value).padEnd(28)} ${(f.unit ?? "").padEnd(5)} p.${f.page ?? "?"} verified=${f.evidenceVerified} ${f.status}`);
const v = ex.diffPreview?.find((c) => c.key === "rating.voltage_v");
console.log("voltage change:", v ? `${v.before} → ${v.after} (${v.significance}); impact[${v.impactSource}]: ${v.impact}` : "not detected");
assert.equal(ex.engine, "openai", "expected a real OpenAI extraction (check key / AI_PROVIDER)");
assert.equal(v?.significance, "material");
assert.equal(v?.normalizedAfter, "600 V");
console.log("\nLive OpenAI extraction verified on a synthetic PDF.");
