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
npm run e2e:memory                         # 17 project-memory checks; starts its own server on :3102 incl. a restart
E2E_PROVIDER=openai npm run e2e:memory     # same scenario with real OpenAI calls (synthetic email + PDF)
npm run e2e:guardian                       # Project Guardian demo (16 checks incl. restart + transformer negative test)
E2E_PROVIDER=openai npm run e2e:guardian   # same, with live OpenAI extraction + advisory AI review
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

## Project memory & pre-submission check

"Before we move forward, what are we forgetting?" — `/sites/S-1001/memory` (also linked from the site page).

1. An EQORE user pastes or imports (.txt/.eml) an email, AHJ comment or engineering note. Sender, timestamp and
   subject come from the importer or the email's own headers; the original text is stored verbatim.
2. OpenAI (Responses API, strict JSON schema, `store: false`) proposes **requirements, decisions, action items,
   questions, document references and stakeholders**, each with a verbatim quote. Quotes are checked against the
   stored original; unknown document types/packages are dropped; embedded instructions are reported and ignored.
   Without a key, a labeled deterministic keyword scanner is used.
3. Everything starts as a **suggestion** (advisory only). A PM confirms applicability (packages, blocking,
   document type, owner) or dismisses it — note required, session identity recorded.
4. A confirmed blocking requirement that names a document type **adds that document to the package checklist**
   (on-demand types such as `ventilation_plan` are never on default checklists). The gate then reports
   MISSING_DOCUMENT / NO_APPROVED_VERSION / OUTDATED_REVISION (approved revision predates an "updated" request) /
   REQUIREMENT_UNRESOLVED, plus OPEN_ACTION / OPEN_QUESTION / OPEN_DECISION for other confirmed blocking items.
   Every blocker carries its source (checklist, dependency graph, or the communication + quote), the affected
   document, the responsible party where known, and the next action.
5. Requirements are resolved by an **engineer**, only against the current approved revision (and, for "updated"
   requests, one uploaded after the request). Actions/questions/decisions are closed by EQORE users.
6. Duplicates: the same communication imported twice returns the existing record (normalized-content hash, no
   second AI call); the same requirement from another message is flagged and **merged** on confirmation.
7. The release snapshot freezes the applicable memory items with their sources (`annotations.projectMemory`).

Demo: import `sample-docs/SYNTHETIC_AHJ_Email_Ventilation.txt` → confirm the ventilation-plan requirement →
AHJ package blocked → upload `SYNTHETIC_Ventilation_Plan_RevA.pdf` → engineer approves → engineer resolves the
requirement → build R2 (pins the ventilation plan). `SYNTHETIC_Injection_Email.txt` tests instruction injection.

### Project memory API (typed contract: `lib/memory/types.ts`)

| Method & path | Who | Body / query | Returns |
|---|---|---|---|
| `POST /api/sites/:id/communications` | EQORE | `{ body, channel?, sender?, sentAt?, subject?, recipients? }` | `{ communication, items, duplicate }` |
| `GET /api/sites/:id/communications` | EQORE | — | `{ communications }` (full original text) |
| `GET /api/sites/:id/memory` | EQORE | — | `{ items: MemoryItem[], communications (headers), counts }` |
| `POST /api/sites/:id/memory/:itemId` | EQORE; resolve requirement = engineer | `{ action: "confirm" \| "dismiss" \| "resolve", note, blocking?, templateIds?, requirementId?, responsibleParty?, dueDate?, requiresUpdatedRevision?, asNew?, revisionId? }` | `{ item, merged? }` |
| `GET /api/sites/:id/presubmission[?templateId=]` | signed in (quotes EQORE-only) | — | `{ report: PreSubmissionReport }` or `{ reports }` |
| `GET /api/sites/:id/releases` | signed in | — | existing shape + `advisories`; issues carry `source`, `responsibleParty`, `nextAction` |

Build a release with the `token` from the report (`POST /api/sites/:id/releases { templateId, note, readinessToken }`).

## Project Guardian — cross-source preflight

`/sites/S-1001/guardian` (button on the site page). Typed contract: `lib/guardian/types.ts`.

- **Evidence graph** (`lib/guardian/graph.ts`): built on demand from the store — communications, memory items,
  document families, revisions, facts (with pages), engineering/review tasks, decisions, templates, releases and
  consistency findings. Every edge carries `reason`, `sourceIds`, `at` and the verbatim `evidence` when it came from text.
- **Cross-document consistency** (`observations.ts`, `consistency.ts`): electrical values (voltage, current,
  interrupting) are read from each current document's PDF text layer line by line (or its recorded facts) together
  with **equipment role, identifiers (e.g. NSG-4000, T1), interface side (primary/secondary/utility/DC) and rating vs
  nominal**. Only related documents (dependency graph or shared package) are compared, and only like with like:
  - `verified_discrepancy` — same quantity, same equipment, same interface, different values → engineer review
  - `potential_inconsistency` — e.g. a rating below a stated nominal value → investigate
  - `explained_difference` — e.g. opposite sides of a transformer stated in the documents, rating ≥ nominal
  - `consistent`, `insufficient_evidence` (a value without equipment context)
  Revision-history lines are ignored. Different equipment with no stated relationship is not compared.
  Nothing is described as incompatible or noncompliant.
- **Gating**: when an approval changes the approved document set, verified discrepancies are attached to the open
  dependency review for that pair or raised as a new **consistency review task** (`EngineeringTask.kind = "consistency"`),
  which blocks via `CROSS_DOC_DISCREPANCY` and is resolved through the existing review endpoints. A task whose
  discrepancy disappears (document re-issued) is superseded.
- **AI** (`ai.ts`, optional `ai: true`): OpenAI gives a second opinion (same equipment? same interface?) with quotes
  checked against the surrounding text. Shown next to the deterministic class, flagged when it disagrees,
  never applied to gating. Cached in memory only.
- **Preflight** (`preflight.ts`, read-only): blockers = exactly the release gate, each with evidence, affected files,
  responsible role, next action and a clickable evidence chain; plus candidate-view consistency findings
  (pending revisions included), unconfirmed suggestions and changes since the last release.
- **Time Machine** (`timemachine.ts`): frozen release snapshot (integrity re-verified) vs today — new requirements,
  added checklist documents, replaced/pending versions with fact changes, new/resolved reviews, current blockers,
  and why a fresh submission may be needed.

| Method & path | Who | Returns |
|---|---|---|
| `POST /api/sites/:id/preflight` `{ templateId, ai? }` | EQORE | `{ report: PreflightReport }` |
| `GET /api/sites/:id/timemachine?releaseId=` | EQORE | `{ report: TimeMachineReport }` |
| `GET /api/sites/:id/graph[?focus=<nodeId>&depth=]` | EQORE | `{ graph: EvidenceGraph }` |
| `POST /api/reviews/:id` (existing) | engineer | now also `consistency: { created, attached, superseded }` |

Demo docs: `SYNTHETIC_Switchgear_Spec_RevB.pdf` (600 VAC) vs the seeded plan set ("480 VAC AC disconnect", p.13) →
verified discrepancy; `SYNTHETIC_Plan_Set_RevC.pdf` resolves it; `SYNTHETIC_Interconnection_Application_RevB.pdf`
(13,200 V utility / T1 13,200/600 V / 600 V disconnect) is the negative test — explained, not flagged.

## Persistence

Every mutation writes `RELEASEOS_DATA_DIR/state.json` atomically (default `./.data`, git-ignored); uploaded bytes
go to `files/<sha256>.bin` immediately. On start the state is reloaded; file hashes and every release snapshot are
re-verified, and a state that fails verification is quarantined (`state.json.corrupt-*`) instead of loaded.
Reset (`/api/reset`) clears it. Not persisted: unfiled upload previews; sessions unless `SESSION_SECRET` is set.
Single process only.

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
| `lib/store.ts` | The single authoritative store; all mutations and rules |
| `lib/persistence.ts` | Atomic JSON snapshot + content-addressed upload bytes; integrity-checked reload |
| `lib/guardian/*` | Evidence graph, cross-document consistency, preflight, Time Machine (contract: `types.ts`) |
| `lib/memory/*` | Communication intelligence, project register, pre-submission report (contract: `types.ts`) |
| `lib/engine-adapter.ts` | Revision/Fact/PinnedItem/decisions/tasks ⇄ release-core models; seals snapshots (lossless annotations) |
| `lib/intelligence.ts`, `lib/normalize.ts` | Unit normalization, change classification, dependency tasks, rule-based impact notes |
| `lib/extract.ts`, `lib/ai/*` | Provider router, OpenAI + optional Anthropic providers, schema + grounding |
| `lib/release.ts` | Readiness gate (+token), release status, snapshot comparison |
| `lib/auth.ts` | HMAC-signed demo sessions; engineer capability |
| `packages/release-core` | Snapshot sealing/verification, ZIPs, version/release comparison (see its README) |

## Limitations (honest)

- **Single-process JSON persistence** (survives restarts; not for multiple instances or high write volume).
- Project-memory suggestions depend on the model; the deterministic fallback is a keyword scan and can miss items.
- Demo auth with fixed passcodes; replace with SSO/OIDC.
- Seeded documents other than the switchgear Rev A use deterministic placeholder bytes (labeled in ZIPs/UI).
- Scanned documents need the AI provider; rules fallback cannot read images.
- AI output is decision support only; nothing here certifies NFPA 855, UL, NEC or AHJ compliance.
