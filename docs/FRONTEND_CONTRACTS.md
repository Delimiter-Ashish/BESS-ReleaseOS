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

## Submission Studio — now on the real PDF engine (final integration)

The previously "pending" Studio contracts are implemented by `lib/studio/*` and wired into `components/studio/SubmissionStudio.tsx`
through `lib/api/client.ts` (`studioCheck`, `studioRelease`). Types: `lib/studio/types.ts`.

| UI step | Endpoint | Notes |
|---|---|---|
| Selection checks (auto, debounced) | `POST /api/sites/:id/studio/check` `{ purpose, templateId?, recipient?, groups }` | release gate + selection (required/unapproved/superseded/duplicates) + **server-side recipient authorization** + Guardian warnings; returns `token` |
| Sign off, generate & seal | `POST /api/sites/:id/studio/release` `{ …selection, note, token }` | engineer only; real combined PDFs (cover/index, page ranges, SHA-256), groups + order + access decisions frozen in the snapshot |
| Download each PDF | `GET /api/releases/:id/pdf?output=<groupId>` | EQORE or the addressed recipient of a fully authorized package; hash-checked |

- Order and grouping are real fields (no note-line workaround); multiple output groups are supported (up to 8).
- Recipients are the access-policy recipients: `ahj`, `planning`, `utility`, `owner`, `supplier`. A non-default recipient makes the
  submission a server-checked "custom" purpose.
- The draft (order, groups, recipient) is still kept in the browser's localStorage, labelled as such.

## Lifecycle (final integration)

`/lifecycle?project=` (nav: PM "Lifecycle", engineer "Lifecycle Reviews", facility "Obligations & records") uses
`GET/POST /api/sites/:id/lifecycle` (`lib/lifecycle/types.ts`). Upload/review actions link to `/inbox?expect=` and `/reviews`.

## Public QR

`/p/:id` shows only engineer-published emergency documents (`publish_emergency`), served by `/api/public/sites/:id/emergency/:pubId`
while still current and hash-matching. `/e/:id` redirects there. The root layout renders `/p/*` without the workspace shell or session data.

## Shared files this branch changed (please review)

- `lib/workspace.ts` (owned by Kaushik) — imports `memoryRequiredDocs`, `KIND_LABEL`, `CATEGORY_OF` read-only.
- `lib/auth.ts` — adds PM demo identity `kaushik` / `pm855` (same capabilities as `arivera`).
- `app/sites/[id]/page.tsx` — display labels only (Project Roadmap, Document Packages & Approvals, Activity & Approval History, Emergency Access / Site QR, friendly package names). No logic changes.
- `tailwind.config.ts`, `app/globals.css` — midnight theme: every colour scale is remapped so existing class names render dark. Your pages inherit it automatically; use `ink-*`/`night-*` for colours that must not be remapped.
- Not touched: `packages/release-core`, `lib/guardian/*`, `lib/memory/*`, `lib/release.ts`, `lib/store.ts`, `lib/persistence.ts`, `lib/types.ts`, all API routes.
