# Demo dataset (synthetic)

Seed records for the ReleaseOS demo store, loaded once at server start by `lib/demo-data.ts` → `lib/seed.ts`.
After start-up the **in-memory store (`lib/store.ts`) is the only source of truth**: uploads, reviews and
releases mutate the store, and every screen derives its metrics from it. These CSVs are never written back.

| File | Contents |
|---|---|
| `projects.csv` | Customers and sites/projects, lifecycle stage, system size, utility, AHJ, provenance |
| `documents.csv` | Received document revisions for S-1003…S-1005 (status, age, source, optional synthetic PDF) |
| `facts.csv` | Facts attached to seeded revisions. Evidence quotes are verbatim text from the referenced synthetic PDF; rows without evidence are seeded values with no source file |
| `parties.csv` | Responsible parties (`*` = all projects); `responsible_for` lists requirement ids or lifecycle stages |

Not in CSV (kept in code because they reference real PDF bytes and sealed releases):
the Century Tywood (S-1001) document history + R1 (`lib/seed.ts`) and the Atlas Cold Storage (S-1002) operating-site documents.
Document requirements and package checklists live in `lib/requirements.ts` (illustrative until EQORE confirms).

Provenance: every project except S-1001 is **fictional**. S-1001 uses the *structure* of the EQORE-provided
Century Tywood sample plan set; its supplier documents, ratings and approvals are synthetic. No real EQORE
approvals, decisions or deadlines are represented.
