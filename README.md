# ReleaseOS: version-locked compliance documentation for BESS projects

EQORE challenge, Option 4 (compliance documentation at scale), MIT Energy & Climate Hack 2026.

ReleaseOS tracks every document a battery project needs, from the contract through supplier docs, the plan set, permits and NFPA 855 operations documents. It keeps every revision and only lets **engineer-approved** revisions into a submission package. Each package is a **version-locked release** with a manifest and SHA-256 hashes. When a source document changes, the affected packages go stale, and nothing goes out silently.

## Run it

```bash
npm install
cp .env.example .env.local   # optional: ANTHROPIC_API_KEY for multimodal extraction
npm run dev                  # http://localhost:3000
```

There are two extraction engines behind one interface (`lib/extract.ts`):
- **Rules (default, offline):** text PDFs and .txt files, regex facts with evidence. It is deterministic and works with no key and no Wi-Fi. It cannot read scanned images.
- **Claude (with key):** PDFs and scanned photos (vision). Only send sponsor files once EQORE has said that's OK.

To reset the demo data: `curl -X POST localhost:3000/api/reset`

## The core demo (about 3 minutes)

1. **Portfolio** at `/`: 84 projects. Show the KPIs and the sites that need action.
2. **Century Tywood** at `/sites/S-1001`: the hero site, using the structure of the sponsor's sample plan set. The **AHJ permit package R1** is current, and every document in it is approved and pinned.
3. **Upload `sample-docs/SAMPLE_Switchgear_Datasheet_RevB.pdf`** (synthetic). The AI/rules engine extracts facts with quotes and compares them with approved Rev A: **400 A → 600 A**, NSG-400 → NSG-600. Click **Submit for engineer review**. R1 shows **"Change pending review"**, but it is still valid, because uploads never change a release.
4. **Engineer review queue:** a fact diff table with evidence. It shows what happens if the revision is approved (R1 goes stale, and the plan set gets flagged). Add a note and click **Approve Rev B**.
5. **R1 is now STALE.** The plan set is flagged: "Rev B predates switchgear Rev B, engineer to confirm or re-issue." The interconnection package shows the same flag.
6. **Build R2:** the engineer acknowledges the flag with a note, which is recorded in the manifest. The release page shows **"What changed since R1"** with fact-level changes and hashes. Download the **ZIP**, which contains the documents, `MANIFEST.json` and `INDEX.txt`. The hashes in the ZIP match the manifest, and R1 can still be downloaded.
7. **Full Option 4 scope, 20 seconds:** the lifecycle documents list for all 11 stages, roles per document, and the QR view (`/p/S-1002`, an operating site). Passcodes: `ahj855` / `site855` / `eqore855` / `supp855`.

Talking points:
- The status shown is "ready for engineer signoff", **never** "code compliant".
- The package checklists are **illustrative** until EQORE confirms them.
- The switchgear documents are synthetic, and the UI labels them that way.

## Architecture

```
upload ─► /api/extract ─► file store (sha256) + extraction (rules | Claude) + diff vs approved
       ─► /api/sites/:id/revisions ─► Revision(in_review) + ReviewTask(fact diff, affected packages, dependents)
       ─► /api/reviews/:id ─► approve | reject  (only approved revisions count anywhere)
       ─► /api/sites/:id/releases ─► gate (all required approved; flags need acknowledgement) ─► Release(pinned items + hashes)
       ─► /api/releases/:id/download ─► ZIP (documents + MANIFEST.json + INDEX.txt)   ?format=json → manifest
```

| File | Owner | What it does |
|---|---|---|
| `lib/types.ts` | **shared contract** | Revision, Fact, ReviewTask, Release, PinnedItem. Change it only with agreement. |
| `lib/requirements.ts` | shared | Document types (11 stages, incl. procurement), code refs, access roles, `dependsOn`, **package templates** |
| `lib/release.ts` | Ashish | Pure engine: latestApproved, pending, diffFacts, dependencyFlags, packageReadiness, releaseStatus, compareReleases, buildManifest |
| `lib/store.ts` | Ashish | Mutations: putFile, submitRevision, decideReview, buildRelease (in-memory; swap for a DB later) |
| `lib/extract.ts` | Kaushik | Canonical FACT_KEYS, Claude prompt, rules engine, PDF text via unpdf |
| `lib/compliance.ts` | shared | Lifecycle status per document (missing / outdated / pending / due), score |
| `lib/seed.ts` | Kaushik | 84 synthetic sites, hero S-1001 with release R1, ops site S-1002 |
| `app/sites/[id]/page.tsx` | UI | Review queue, packages, lifecycle documents, upload |
| `app/sites/[id]/releases/[rid]/page.tsx` | UI | Release status banner, R(n) vs R(n-1) diff, pinned docs, flags |
| `components/*` | UI | UploadPanel, ReviewPanel, BuildRelease, PortfolioTable, RoleLogin |

## Next steps (suggested)

- **Kaushik:** improve fact extraction (unit normalization, conflict checks across documents such as the plan set vs a datasheet), handle scanned files, and build the evaluation set (8 or more labeled scenarios: missing, wrong version, duplicate, conflict, scanned).
- **Ashish:** add a plan set Rev C upload that clears the flag, a supplier-scoped upload view, and persistence (SQLite or Postgres) if time allows.
- **Both:** get the before/after number from EQORE, then pitch slides and a backup video.
