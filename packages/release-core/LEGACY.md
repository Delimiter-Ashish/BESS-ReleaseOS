# @releaseos/release-core

Standalone TypeScript ReleaseOS engine for Node.js 22+. No runtime dependencies, database, UI, network requests, or shared repository configuration. All bundled fixtures are synthetic.

## Build and test

From the repository root (requires Node.js and npm on PATH):

```sh
npm --prefix packages/release-core ci
npm --prefix packages/release-core test
npm --prefix packages/release-core run typecheck
```

`test` compiles TypeScript and runs Node's test runner. The package exposes compiled ESM and TypeScript declarations through `dist/index.js` and `dist/index.d.ts`.

## Integration for Kaushik

1. Build the package using the commands above.
2. Add `@releaseos/release-core` as a local dependency of the Next.js app, using the relative `file:` path from that app's package directory to this directory. If the monorepo later uses npm workspaces, include this package in the workspace configuration and reference its version instead. Those app/shared configuration changes are intentionally left to the frontend owner.
3. Import the package in **server-only** application code. It uses `node:crypto`; use the Node.js runtime for Next.js route handlers, not the Edge runtime. Keep one engine instance per project in a server service module. Do not instantiate it inside every request. Separate projects need separate instances.
4. Map authenticated users and roles to `registerEngineer`. Resolve author, engineer, and release creator IDs from the authenticated server session. Never trust actor IDs or role registration supplied directly by a browser.
5. Fetch `listDocuments()` / `getDocument(id)` for version history. Use `getVersion(id)` for the current version, and `compareRevisions(id, fromId, toId)` for revision views. Each update must pass the previously read version ID to `reviseDocument`.
6. Use `analyzeDependencies(selectedIds)` for dependency edges and prerequisite-first build order, and `analyzeImpact(changedDocumentId)` for all affected downstream documents.
7. Pass the exact current version ID to `recordApproval`. Display `checkReadiness(selectedIds).issues` alongside Kaushik's separate compliance results. Core readiness covers document and engineer checks only; any additional compliance gate must also be enforced in the server release action.
8. At release time, pass the readiness result's `versionIds` as `expectedVersionIds`. Handle `ReleaseCoreError.code` and its `issues` in the API. Send the release as JSON; `verifyRelease` checks exported JSON integrity. Store/export that JSON using the application's eventual persistence layer.

```ts
import { ReleaseEngine, verifyRelease } from '@releaseos/release-core';

// Application service lifetime: one instance per synthetic demo project.
const engine = new ReleaseEngine({
  policy: {
    requiredRoles: ['engineer'],
    minimumApprovals: 1,
    allowAuthorApproval: false,
  },
});
engine.registerEngineer({
  id: 'synthetic-reviewer', name: 'Synthetic Engineer',
  roles: ['engineer'], active: true,
});
const specification = engine.createDocument({
  documentId: 'synthetic-spec', title: 'Synthetic BESS specification',
  content: 'Synthetic rated output: 100 kW', authorId: 'synthetic-author',
  metadata: { kind: 'specification' },
});
const drawing = engine.createDocument({
  documentId: 'synthetic-drawing', title: 'Synthetic layout',
  content: 'Synthetic layout references specification revision 1',
  authorId: 'synthetic-author',
  dependencies: [{ documentId: specification.documentId, versionId: specification.id }],
});
for (const version of [specification, drawing]) {
  engine.recordApproval({
    documentId: version.documentId, versionId: version.id,
    engineerId: 'synthetic-reviewer', decision: 'approved',
  });
}
const readiness = engine.checkReadiness([drawing.documentId]);
if (readiness.ready) {
  const release = engine.generateRelease({
    name: 'Synthetic submission 1', createdBy: 'synthetic-operator',
    documentIds: [drawing.documentId], expectedVersionIds: readiness.versionIds,
  });
  console.log(release.documents.length); // 2: dependency closure included
  console.log(verifyRelease(JSON.parse(JSON.stringify(release)))); // true
}
```

## Behavioral contract

- Versions are append-only full snapshots with document-local increasing revision numbers and SHA-256 checksums. Metadata must contain finite, acyclic JSON values. Title/author must be nonempty; blank content can be drafted but cannot be released.
- Revisions replace title, content, metadata, and dependency fields as a full snapshot; omitted metadata/dependencies become empty. There is no deletion API. Reverting means submitting a new revision with earlier content.
- Dependencies explicitly pin a document ID and version ID. Drafts may reference missing versions so imports can be staged; readiness blocks missing documents, missing pinned versions, newer dependency revisions, and cycles. Readiness and releases automatically include the transitive dependency closure. Updating a prerequisite requires downstream owners to revise their pins and obtain new approvals.
- Revision comparison detects title, metadata, dependency, and text differences. Text uses exact newline splitting without normalizing whitespace. The LCS diff is bounded to one million cells; larger documents use a complete removal/addition diff that preserves both inputs.
- Approvals bind to the current version ID and checksum. Only active registered engineers may decide. The author cannot approve by default. Latest decision per engineer wins; repeated approval does not increase quorum. Any effective rejection blocks readiness. Every required role needs an approved engineer who held that role when deciding and still holds it. A single engineer can cover multiple roles; quorum still counts distinct engineers. Deactivating an engineer excludes their decisions from current readiness. Revising invalidates all earlier revision approvals.
- `generateRelease` rechecks readiness synchronously and checks the complete version set against `expectedVersionIds`, preventing publication from a stale document selection. All selected documents and dependencies must be ready. Release creator authentication/authorization is the caller's responsibility.
- Release snapshots include policy, exact document revisions, effective decisions, and the preceding audit hash. Nested outputs are frozen and input data is detached. Later revisions, role changes, or decisions cannot alter historical releases. JSON serialization preserves the manifest; deserialized JSON is mutable, so verify it before use.
- Canonical JSON sorts object keys and preserves array order. `checksum` is SHA-256 of that representation. `verifyRelease` validates the manifest checksum and each document checksum. This detects accidental changes, not a malicious party capable of recalculating hashes; it is not a digital signature or approval authentication.
- The audit trail records engineer registration, document creation/revision, decisions, and releases with sequence numbers and a hash chain. Engineer registration is an administrative action performed by the trusted caller; the engine does not provide an identity provider.
- `ReleaseCoreError` carries a machine-readable `code`; `NOT_READY` also includes readiness `issues`. Successful read results are immutable snapshots. Unknown documents/versions/releases throw rather than returning partial objects.

## Scope and limitations

The requested engine workflows are implemented and tested. State is deliberately in memory: restart, serverless instance changes, or multiple workers do not share or retain it. Production integration still needs application-owned authentication, persistence/hydration, cross-process concurrency control, and compliance enforcement. Do not use a module singleton as durable storage. No PDF/OCR parsing, semantic/LLM comparison, regulatory certification, cryptographic signing, or external submission is claimed. The frontend can supply extracted text and structured metadata through `VersionInput`.

All changes for this implementation live under `packages/release-core/`; no app code, shared configuration, commits, or pushes are required by these instructions.
