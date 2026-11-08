# Project Assurance UI — backend contracts

Branch `kaushik/project-assurance-ui`. Written for Ashish (release engine, Project Memory, Guardian, Submission Studio backend) so the UI and the backend stay mergeable without either side guessing.

All typed client calls live in `lib/api/client.ts`. Every call resolves to `ok | forbidden | unavailable (404, route missing) | error`, and screens show each state explicitly — "unavailable" is never rendered as "no findings".

## Backend contracts the UI consumes (unchanged, owned by Ashish)

| Screen | Endpoint | Types |
|---|---|---|
| Inbox → documents | `POST /api/extract`, `GET /api/extract/:id?requirementId=`, `POST /api/sites/:id/revisions` | existing |
| Inbox → emails (`.eml`, or `.txt` with `From:/Subject:/Date:` headers) | `POST /api/sites/:id/communications` `{ body, channel }` | `lib/memory/types.ts` |
| Action Center → Project Memory tab | `POST /api/sites/:id/memory/:itemId` `{ action: confirm \| dismiss \| resolve, note, … }` (via `components/memory/MemoryItemCard.tsx`, reused unchanged) | `MemoryItem` |
| Evidence drawer → communications | `GET /api/sites/:id/communications` (verbatim original; quote highlighted) | `Communication` |
| Evidence drawer → documents | `GET /api/files/:id` (pdf.js in the browser) | — |
| Guardian Scan, Studio "Verify Submission", graph "next action" | `POST /api/sites/:id/preflight` `{ templateId, ai? }` | `PreflightReport` (`lib/guardian/types.ts`) |
| Evidence Graph | `GET /api/sites/:id/graph` | `EvidenceGraph` |
| Time Machine | `GET /api/sites/:id/timemachine?releaseId=` | `TimeMachineReport` |
| Engineer Reviews | `POST /api/reviews/:id`, `POST /api/sites/:id/tasks/:taskId` | existing |
| Studio signoff / seal | `POST /api/sites/:id/releases` `{ templateId, note, readinessToken }` | `Release` |
| Release downloads | `GET /api/releases/:id/download[?format=json]`, `/api/releases/compare` | existing |

Server-rendered pages read the same store through `lib/workspace.ts` (view models) and `lib/guardian-view.ts` (runs `runPreflight` for current packages, AI off). Neither re-implements backend rules:

- `readiness()` returns the gate's own `issues` (with `category`, `source`, `nextAction`, `responsibleParty`, `memoryItemId`) and `advisories`, plus `itemless` for issues not tied to a checklist document (open questions/decisions/actions). `canBuild` and `token` are the gate's.
- The register lists on-demand document types (e.g. `ventilation_plan`) when a confirmed requirement asks for them (`memoryRequiredDocs`).
- Findings include Project Memory items: `suggested → needs_confirmation`, `confirmed+blocking → action_required`, `resolved`, `dismissed/merged`. Internal correspondence is only included for sessions with capability `memory`.
- Engineering tasks with `kind: "consistency"` are labelled "Cross-document conflict" and their evidence uses `consistency[0].a/b` quotes and pages.

## Graph traversal (frontend only, deterministic)

`lib/graph-traversal.ts` runs BFS over the returned edges. It does **not** add edges. The only interpretation is a fixed reading direction per edge type (information flow: communication → requirement → document → revision → finding → review → package → release), listed in `FLOW`. If you add an `EdgeType`, please add it there too (TypeScript will flag it).

## Studio decisions that depend on the backend

- **Document order** is preserved by appending a compact line to the signoff note: `[Studio order → <recipient>] 1. plan_set Rev B; 2. …`. Notes are capped at 1000 chars by `requireNote`; the UI budgets the user's text so the order line always fits. A proper field would be better (see below).
- **Supplemental documents** (not on the checklist) are listed in that order line only. The release engine pins the checklist.
- **One output group** only.

## Needed from the backend (NOT implemented — the UI shows these as "backend pending")

```
POST /api/releases/:id/combined-pdf
  body  { groups: [{ title: string, revisionIds: string[] }] }       // order = array order; revisionIds must be pinned in the release
  200   { ok: true, files: [{ groupTitle, fileId, fileName, pages, sha256, url }] }
  409   when a revision is not pinned / file bytes missing (seeded metadata-only revisions)
  // UI: "Generate combined PDF" stays disabled until this route answers; downloads appear only from this response.

POST /api/sites/:id/submissions/check-recipient
  body  { templateId, recipient: "ahj" | "utility" | "facility" | "eqore", revisionIds: string[] }
  200   { ok: true, allowed: [{ revisionId }], blocked: [{ revisionId, reason }] }
  // Today the UI only compares against Requirement.access (declared audience) and says so.

POST /api/sites/:id/releases   (additive field request)
  body  { …existing, documentOrder?: { requirementId: string, revisionId: string }[], recipient?: string }
  // Frozen into the snapshot instead of the note line above.

Server-side Studio draft (optional)
  GET/PUT /api/sites/:id/submissions/draft?templateId=   { order, recipient, updatedBy, updatedAt }
  // Today the draft lives in the browser's localStorage, labelled as such.
```

## Shared files this branch changed (please review)

- `lib/workspace.ts` (owned by Kaushik) — imports `memoryRequiredDocs`, `KIND_LABEL`, `CATEGORY_OF` read-only.
- `lib/auth.ts` — adds PM demo identity `kaushik` / `pm855` (same capabilities as `arivera`).
- `app/sites/[id]/page.tsx` — display labels only (Project Roadmap, Document Packages & Approvals, Activity & Approval History, Emergency Access / Site QR, friendly package names). No logic changes.
- `tailwind.config.ts`, `app/globals.css` — midnight theme: every colour scale is remapped so existing class names render dark. Your pages inherit it automatically; use `ink-*`/`night-*` for colours that must not be remapped.
- Not touched: `packages/release-core`, `lib/guardian/*`, `lib/memory/*`, `lib/release.ts`, `lib/store.ts`, `lib/persistence.ts`, `lib/types.ts`, all API routes.
