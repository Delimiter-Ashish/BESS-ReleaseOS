import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ChangeTable, Confidence, EngineBadge, EvidenceStatus, Hash } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { canViewRevision } from "@/lib/studio/access";
import { compareFacts } from "@/lib/intelligence";
import { latestApproved, revisionsOf } from "@/lib/release";
import { REQ_BY_ID } from "@/lib/requirements";
import { getDecisions, getSite } from "@/lib/store";

export const dynamic = "force-dynamic";

const STATUS_CLS = { approved: "bg-emerald-50 text-emerald-700 ring-emerald-200", in_review: "bg-violet-50 text-violet-700 ring-violet-200", uploaded: "bg-violet-50 text-violet-700 ring-violet-200", rejected: "bg-red-50 text-red-700 ring-red-200" } as const;

export default function DocumentPage({ params, searchParams }: { params: { id: string; revId: string }; searchParams: { vs?: string } }) {
  const site = getSite(params.id);
  const rev = site?.documents.find((d) => d.id === decodeURIComponent(params.revId));
  if (!site || !rev) notFound();
  const session = getSession();
  const req = REQ_BY_ID[rev.requirementId];
  // Access policy (server-enforced): internal documents are not shown to suppliers, authorities or the public.
  if (!canViewRevision(session, site, rev)) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <div className="card space-y-2 p-6">
            <h1 className="text-lg font-semibold">Not authorized</h1>
            <p className="text-sm text-slate-600">{session.role === "public" ? "Sign in to view project documents." : `${session.name} is not permitted to view this ${req?.name ?? "document"} under the project's document access policy.`}</p>
            <Link href={`/sites/${site.id}`} className="text-sm text-indigo-700 underline">Back to the site</Link>
          </div>
        </main>
      </>
    );
  }
  const history = revisionsOf(site, rev.requirementId);
  const approved = latestApproved(site, rev.requirementId);
  const superseded = rev.status === "approved" && approved?.id !== rev.id;
  // Default comparison: previous approved revision older than this one; or explicit ?vs=
  const baseline = searchParams.vs ? history.find((h) => h.id === searchParams.vs) : history.find((h) => h.version < rev.version && h.status === "approved") ?? history.find((h) => h.version < rev.version);
  const changes = baseline ? compareFacts(baseline.facts, rev.facts) : [];
  const decisions = getDecisions(site.id).filter((d) => d.revisionId === rev.id || (d.taskIds.length && (site.engTasks ?? []).some((t) => d.taskIds.includes(t.id) && t.sourceRevisionId === rev.id)));
  const tasksRaised = (site.engTasks ?? []).filter((t) => t.sourceRevisionId === rev.id);
  const canFile = !!rev.fileId; // reaching this point means the access policy allows viewing

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <div className="text-sm text-slate-500">
          <Link href="/" className="hover:underline">Portfolio</Link> / <Link href={`/sites/${site.id}`} className="hover:underline">{site.name}</Link> / {req?.name} Rev {rev.revLabel}
        </div>

        <section className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Document intelligence</div>
              <h1 className="text-2xl font-semibold tracking-tight">{req?.name} · Rev {rev.revLabel}</h1>
              <div className="text-sm text-slate-600">{rev.fileName}</div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className={`pill ${STATUS_CLS[rev.status]}`}>{superseded ? "superseded" : rev.status.replace("_", " ")}</span>
                <EngineBadge engine={rev.engine} model={rev.model} fallback={rev.extractionWarnings?.some((w) => /fallback/i.test(w))} />
                {rev.synthetic && <span className="pill bg-slate-100 text-slate-600 ring-slate-200">synthetic</span>}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 text-xs text-slate-500">
              {canFile ? (
                <div className="flex gap-2">
                  <a href={`/api/files/${rev.fileId}?inline=1`} target="_blank" className="btn-ghost !py-1.5 !text-xs">View original</a>
                  <a href={`/api/files/${rev.fileId}`} className="btn-ghost !py-1.5 !text-xs">Download</a>
                </div>
              ) : <span>{rev.fileId ? "Sign in to view the original" : "Seed record — placeholder bytes only"}</span>}
            </div>
          </div>
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-slate-500">SHA-256 (server-computed)</dt><dd><Hash h={rev.sha256} n={24} /></dd></div>
            <div><dt className="text-slate-500">Uploaded</dt><dd className="text-slate-800">{rev.uploadedBy} · {rev.uploadedAt.slice(0, 16).replace("T", " ")}</dd></div>
            <div><dt className="text-slate-500">Approval</dt><dd className="text-slate-800">{rev.approvedBy ? `${rev.approvedBy} · ${String(rev.approvedAt).slice(0, 16).replace("T", " ")}` : rev.rejectedBy ? `rejected by ${rev.rejectedBy}` : "pending"}</dd></div>
            <div><dt className="text-slate-500">Pages · doc date</dt><dd className="text-slate-800">{rev.pageCount ?? "—"} · {rev.effectiveDate}</dd></div>
          </dl>
          {rev.summary && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{rev.summary}</p>}
          {(rev.extractionWarnings?.length ?? 0) > 0 && <div className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-800">{rev.extractionWarnings!.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>}
          {(rev.missingItems?.length ?? 0) > 0 && <div className="mt-3 rounded-lg bg-orange-50 p-3 text-xs text-orange-800"><b>Possibly missing per requirement “{req?.mustInclude}”:</b> {rev.missingItems!.join("; ")}</div>}
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-2 text-sm font-semibold">Extracted engineering facts ({rev.facts.length})</div>
          {rev.facts.length === 0 ? <div className="p-5 text-sm text-slate-500">No facts on record for this revision.</div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-2">Fact</th><th className="px-3 py-2">Value</th><th className="px-3 py-2">Source evidence</th><th className="px-3 py-2">Grounding</th><th className="px-3 py-2">Conf.</th></tr></thead>
                <tbody>
                  {rev.facts.map((f, i) => (
                    <tr key={i} className="border-t border-slate-100 align-top">
                      <td className="px-5 py-2 text-slate-600">{f.label}<div className="font-mono text-[10px] text-slate-400">{f.key}</div></td>
                      <td className="px-3 py-2 font-semibold">{f.value}{f.unit ? ` ${f.unit}` : ""}</td>
                      <td className="px-3 py-2 text-xs italic text-slate-600">{f.evidence ? `“${f.evidence}”` : "—"}{f.note && <div className="not-italic text-amber-700">{f.note}</div>}</td>
                      <td className="px-3 py-2"><EvidenceStatus f={f} /></td>
                      <td className="px-3 py-2"><Confidence c={f.confidence} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Revision comparison</h2>
            <div className="flex flex-wrap gap-1 text-xs">
              {history.filter((h) => h.id !== rev.id).map((h) => (
                <Link key={h.id} href={`/sites/${site.id}/documents/${encodeURIComponent(rev.id)}?vs=${encodeURIComponent(h.id)}`} className={`rounded px-2 py-0.5 ${baseline?.id === h.id ? "bg-slate-900 text-white" : "bg-slate-100 hover:bg-slate-200"}`}>vs Rev {h.revLabel}</Link>
              ))}
            </div>
          </div>
          {baseline ? (
            <div className="mt-3 space-y-2">
              <div className="text-xs text-slate-500">Rev {baseline.revLabel} ({baseline.status}) → Rev {rev.revLabel} · values normalized to canonical units before comparison</div>
              <ChangeTable changes={changes} />
            </div>
          ) : <p className="mt-2 text-sm text-slate-500">First revision — nothing to compare against.</p>}
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="card p-5">
            <h2 className="text-sm font-semibold">Dependency reviews raised by this revision</h2>
            {tasksRaised.length === 0 ? <p className="mt-1 text-xs text-slate-500">None.</p> : (
              <ul className="mt-2 space-y-2 text-xs">{tasksRaised.map((t) => <li key={t.id} className="rounded-lg border border-slate-200 p-2"><b>{REQ_BY_ID[t.dependentRequirementId]?.name}</b> · {t.status}{t.resolvedBy ? ` by ${t.resolvedBy}` : ""}<div className="text-slate-500">{t.explanation}</div></li>)}</ul>
            )}
          </section>
          <section className="card p-5">
            <h2 className="text-sm font-semibold">Decisions on this revision</h2>
            {decisions.length === 0 ? <p className="mt-1 text-xs text-slate-500">No decisions yet.</p> : (
              <ul className="mt-2 space-y-2 text-xs">{decisions.map((d) => <li key={d.id} className="rounded-lg border border-slate-200 p-2"><b>{d.decision}</b> by {d.reviewerName} ({d.reviewerRoles.join(", ")}) · {d.at.slice(0, 16).replace("T", " ")}{d.seeded ? " · seeded" : ""}<div className="italic text-slate-600">“{d.note}”</div><Hash h={d.contentSha256} /></li>)}</ul>
            )}
          </section>
        </div>
        <p className="text-xs text-slate-500">Facts and impact notes are decision support. Approval and package readiness are decided by authorized engineers under deterministic rules — not by AI, and not a certification of NFPA 855 / AHJ compliance.</p>
      </main>
    </>
  );
}
