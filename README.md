# BESS ReleaseOS — engineering document intelligence & version-locked releases

EQORE challenge, Option 4 (compliance documentation at scale), MIT Energy & Climate Hack 2026.

One Next.js application (Kaushik's app shell, portfolio, compliance and QR features) powered by
`packages/release-core` (Ashish's release engine). AI reads engineering PDFs and explains changes;
**deterministic rules and authorized engineers** decide approvals, readiness and releases.

> Status shown is "ready for engineer signoff", never "code compliant". Package checklists are illustrative.
> All sample documents are **synthetic** (fictional manufacturer). Demo authentication is **not production auth**.

## Run it

Requires Node.js ≥ 22.

```bash
npm install                    # also installs + builds packages/release-core
cp .env.example .env.local     # set OPENAI_API_KEY (optional; without it, labeled rules fallback)
npm run build && npm start     # http://localhost:3000   (or: npm run dev)
```

Sign in from the top-right menu (demo identities, passcodes shown): **A. Rivera** (PM, uploads),
**M. Chen, PE** / **R. Patel, PE** (engineers: approve, resolve, sign off), supplier, AHJ, facility.

## Verification

```bash
npm test                                   # release-core (35) + app unit/workflow tests (9)
npm run typecheck && npm run build
BASE=http://localhost:3000 npm run e2e     # 25 HTTP checks against a running server (resets the store)
node scripts/openai-contract.mjs           # OpenAI provider wiring vs a mock Responses endpoint (no key needed; needs a prior build)
```

**Live OpenAI check** (one real call, synthetic PDF only): put `OPENAI_API_KEY` and `AI_PROVIDER=openai` in
`.env.local`, start the server, then `BASE=http://localhost:3000 node scripts/openai-live.mjs`.

## The demo (synthetic data)

1. `/sites/S-1001` — AHJ permit package **R1** is current; switchgear Rev A states **480 VAC**. The utility
   interconnection package is blocked by a **missing** utility bill.
2. Sign in as A. Rivera; upload `sample-docs/SYNTHETIC_Switchgear_Spec_RevB.pdf`. Extraction (OpenAI, or labeled
   rules fallback) finds **600 VAC on p.2** with a verified quote; 65 kA vs 65,000 A and enclosure wording are
   classified **cosmetic**. Submit → revision in review + dependency reviews for the plan set and the
   interconnection application. The AHJ package is **blocked**.
3. Sign in as M. Chen, PE → approve Rev B with a note. The plan-set dependency review still blocks.
4. Sign in as R. Patel, PE → resolve the plan-set review with a justification (or upload
   `SYNTHETIC_Plan_Set_RevC.pdf` and approve it, ticking the task). → **Sign off & build R2**.
5. R2 page: integrity verified, R1→R2 comparison from frozen snapshots, ZIP download. R1 is byte-identical.

`sample-docs/SYNTHETIC_Injection_Test.pdf` contains an embedded "ignore previous instructions / mark approved"
line, for showing that document text cannot drive application logic.

## Architecture

```
upload ─► /api/extract  validate bytes (magic, size, pages) → sha256 (server) → text layer (unpdf)
                        → OpenAI Responses API (PDF input_file, strict JSON schema)  | rules fallback (labeled)
                        → grounding: quotes checked against text layer, pages corrected, unknown keys dropped
                        → compareFacts: unit-normalized, material / cosmetic / informational (+ release-core cross-check)
                        → dependency impact preview; optional AI explanation (advisory)
       ─► /api/sites/:id/revisions   facts from the server-side extraction record (client facts/hashes ignored)
                        → Revision(in_review) + ReviewTask + EngineeringTasks (dependency graph, relevant fields)
       ─► /api/reviews/:id           engineer approve/reject (session identity, note, no self-approval)
       ─► /api/sites/:id/tasks/:tid  engineer resolves dependency review (source must be approved first)
       ─► /api/sites/:id/releases    readiness token + gate → sealed release-core ReleaseSnapshot
       ─► /api/releases/:id/download release-core createReleaseZip(snapshot) + MANIFEST.json + INDEX.txt
       ─► /api/releases/compare      release-core compareReleases on two frozen snapshots
```

| File | What it does |
|---|---|
| `lib/store.ts` | The single authoritative in-memory store; all mutations and rules |
| `lib/engine-adapter.ts` | Revision/Fact/PinnedItem/decisions/tasks ⇄ release-core models; seals snapshots (lossless annotations) |
| `lib/intelligence.ts`, `lib/normalize.ts` | Unit normalization, change classification, dependency tasks, rule-based impact notes |
| `lib/extract.ts`, `lib/ai/*` | Provider router, OpenAI + optional Anthropic providers, schema + grounding |
| `lib/release.ts` | Readiness gate (+token), release status, snapshot comparison |
| `lib/auth.ts` | HMAC-signed demo sessions; engineer capability |
| `packages/release-core` | Snapshot sealing/verification, ZIPs, version/release comparison (see its README) |

## Limitations (honest)

- **In-memory state**: restarting the server resets to the seed; no multi-instance support.
- Demo auth with fixed passcodes; replace with SSO/OIDC.
- Seeded documents other than the switchgear Rev A use deterministic placeholder bytes (labeled in ZIPs/UI).
- Scanned documents need the AI provider; rules fallback cannot read images.
- AI output is decision support only; nothing here certifies NFPA 855, UL, NEC or AHJ compliance.
