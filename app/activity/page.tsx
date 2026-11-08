import Link from "next/link";
import { Page, PageHeader, SyntheticNote, Restricted } from "@/components/kit";
import { can, getSession } from "@/lib/auth";
import { pkgLabel } from "@/lib/labels";
import { REQ_BY_ID } from "@/lib/requirements";
import { getReleases, getSites } from "@/lib/store";

export const dynamic = "force-dynamic";

type Kind = "decision" | "upload" | "communication" | "memory" | "release";
interface Ev { at: string; kind: Kind; projectId: string; projectName: string; who: string; what: string; note?: string; href?: string; seeded?: boolean }
const KIND: Record<Kind, { label: string; dot: string }> = {
  decision: { label: "Engineer decision", dot: "bg-emerald-400" },
  upload: { label: "Document received", dot: "bg-sky-400" },
  communication: { label: "Communication imported", dot: "bg-cyan-400" },
  memory: { label: "Requirement / decision", dot: "bg-amber-400" },
  release: { label: "Release sealed", dot: "bg-violet-400" },
};

/** Every row is a stored record with the identity and timestamp the server recorded. Nothing is generated here. */
export default function Activity({ searchParams }: { searchParams: { project?: string; kind?: string; seeded?: string } }) {
  const s = getSession();
  if (s.role !== "eqore") return <Restricted what="Activity history" role={s.role} />;
  const internal = can(s, "memory");
  const showSeeded = searchParams.seeded === "1";
  const sites = getSites().filter((x) => !searchParams.project || x.id === searchParams.project);
  const name = (rid: string) => REQ_BY_ID[rid]?.name ?? rid;
  const ev: Ev[] = [];
  for (const site of sites) {
    const base = { projectId: site.id, projectName: site.name };
    for (const d of site.decisions ?? []) {
      const rev = d.revisionId ? site.documents.find((x) => x.id === d.revisionId) : undefined;
      ev.push({ ...base, at: d.at, kind: d.kind === "release_signoff" ? "release" : "decision", who: d.reviewerName, seeded: d.seeded,
        what: d.kind === "revision_review" ? `${d.decision === "approved" ? "Approved" : "Rejected"} ${rev ? `${name(rev.requirementId)} Rev ${rev.revLabel}` : "a revision"}` : d.kind === "dependency_resolution" ? `Resolved a dependency review${rev ? ` for ${name(rev.requirementId)} Rev ${rev.revLabel}` : ""}` : "Signed off a release",
        note: d.note, href: rev ? `/sites/${site.id}/documents/${encodeURIComponent(rev.id)}` : undefined });
    }
    for (const r of site.documents) ev.push({ ...base, at: r.uploadedAt, kind: "upload", who: r.uploadedBy, seeded: !r.engine || r.engine === "seed", what: `${name(r.requirementId)} Rev ${r.revLabel} · ${r.fileName}`, note: r.engine && r.engine !== "seed" ? `Extraction: ${r.engine}${r.model ? ` (${r.model})` : ""}` : "Seeded demo record", href: `/sites/${site.id}/documents/${encodeURIComponent(r.id)}` });
    for (const rel of getReleases(site.id)) ev.push({ ...base, at: rel.builtAt, kind: "release", who: rel.builtBy, what: `${pkgLabel(rel.templateId)} R${rel.number} sealed (${rel.items.length} documents)`, note: rel.note, href: `/sites/${site.id}/releases/${encodeURIComponent(rel.id)}`, seeded: !rel.builtById });
    if (internal) {
      for (const c of site.communications ?? []) ev.push({ ...base, at: c.importedAt, kind: "communication", who: c.importedBy, what: `${c.subject ?? "(no subject)"} — from ${c.sender}`, note: `${c.itemIds.length} suggestion(s) · ${c.analysis.engine}`, href: `/memory?project=${site.id}&type=ahj_requirement` });
      for (const m of site.memory ?? []) for (const h of m.history) if (h.action !== "suggested") ev.push({ ...base, at: h.at, kind: "memory", who: h.byName, what: `${h.action[0].toUpperCase()}${h.action.slice(1).replace("_", " ")}: ${m.title}`, note: h.note, href: `/memory?project=${site.id}&type=ahj_requirement&item=${encodeURIComponent(m.id)}` });
    }
  }
  const kinds = Object.keys(KIND) as Kind[];
  const shown = ev.filter((e) => (showSeeded || !e.seeded) && (!searchParams.kind || e.kind === searchParams.kind)).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 300);
  const q = (p: Record<string, string | undefined>) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries({ project: searchParams.project, kind: searchParams.kind, seeded: searchParams.seeded, ...p })) if (v) u.set(k, v); return `/activity?${u.toString()}`; };

  return (
    <Page>
      <PageHeader eyebrow="Records" title="Activity & Approval History" subtitle="Who did what, when — uploads, engineer decisions, confirmed requirements and sealed releases, with the identity recorded by the server." />
      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={q({ project: undefined })} className={`rounded-full px-3 py-1 text-xs ${!searchParams.project ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>All projects</Link>
        {getSites().map((x) => <Link key={x.id} href={q({ project: x.id })} className={`rounded-full px-3 py-1 text-xs ${searchParams.project === x.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>{x.name}</Link>)}
        <span className="mx-2 h-4 w-px bg-slate-300" />
        <Link href={q({ kind: undefined })} className={`rounded-full px-3 py-1 text-xs ${!searchParams.kind ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>Everything</Link>
        {kinds.map((k) => <Link key={k} href={q({ kind: k })} className={`rounded-full px-3 py-1 text-xs ${searchParams.kind === k ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>{KIND[k].label}</Link>)}
        <Link href={q({ seeded: showSeeded ? undefined : "1" })} className="ml-auto text-xs text-cyan-600 hover:underline">{showSeeded ? "Hide seeded history" : "Include seeded demo history"}</Link>
      </div>
      <div className="card p-4">
        {shown.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No activity recorded in this session yet. {showSeeded ? "" : "Include seeded demo history to see the synthetic background records."}</div> : (
          <ol className="relative space-y-4 border-l border-slate-200 pl-5">
            {shown.map((e, i) => (
              <li key={i} className="relative">
                <span className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-[var(--surface)] ${KIND[e.kind].dot}`} />
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500"><span className="font-mono">{new Date(e.at).toLocaleString()}</span><span>· {KIND[e.kind].label}</span><span>· {e.projectName}</span>{e.seeded && <span className="pill bg-slate-100 text-slate-500 ring-slate-200">seeded</span>}</div>
                <div className="mt-0.5 text-sm text-slate-900"><b>{e.who}</b> — {e.href ? <Link href={e.href} className="hover:text-cyan-600 hover:underline">{e.what}</Link> : e.what}</div>
                {e.note && <div className="mt-0.5 text-xs italic text-slate-600">“{e.note}”</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
      {!internal && <div className="text-xs text-slate-500">Communications and Project Memory history are internal EQORE records and are hidden for this identity.</div>}
      <SyntheticNote />
    </Page>
  );
}
