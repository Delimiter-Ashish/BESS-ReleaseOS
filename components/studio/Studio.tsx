"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Purpose, PurposeId, SelectionGroup, StudioCheck, StudioDocument, StudioIssue } from "@/lib/studio/types";

interface StudioData {
  purpose: Purpose; purposes: Purpose[]; templates: { id: string; name: string }[]; recipients: { id: string; label: string }[];
  documents: StudioDocument[]; defaultGroups: SelectionGroup[];
}
interface Output { groupId: string; name: string; fileName: string; sha256: string; pageCount: number; coverPages: number; href: string; warnings: string[]; entries: { order: number; name: string; revLabel: string; fileName: string; startPage: number; pageCount: number; rendering: string; sourceSha256: string }[] }

const STATUS = { approved: "bg-emerald-50 text-emerald-700 ring-emerald-200", in_review: "bg-violet-50 text-violet-700 ring-violet-200", uploaded: "bg-violet-50 text-violet-700 ring-violet-200", rejected: "bg-red-50 text-red-700 ring-red-200" } as const;
const post = async (url: string, body: unknown) => { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` })); };

function IssueRow({ i }: { i: StudioIssue }) {
  return (
    <li className={`rounded-lg p-2 text-xs ${i.severity === "blocker" ? "bg-red-50" : "bg-amber-50"}`}>
      <div className="flex items-start gap-2"><span className="font-mono text-[10px] text-slate-500">{i.code}</span><span className={`font-medium ${i.severity === "blocker" ? "text-red-800" : "text-amber-900"}`}>{i.message}</span></div>
      {i.source && <div className="mt-0.5 text-[11px] text-slate-600"><b>Source:</b> {i.source.label}</div>}
      {i.evidence && <div className="mt-0.5 text-[11px] italic text-slate-600">“{i.evidence}”</div>}
      <div className="mt-0.5 text-[11px] text-slate-700"><b>Fix:</b> {i.fix}{i.responsibleParty ? ` · ${i.responsibleParty}` : ""}</div>
    </li>
  );
}

export default function Studio({ siteId, isEqore, isEngineer, userName }: { siteId: string; isEqore: boolean; isEngineer: boolean; userName: string }) {
  const [purpose, setPurpose] = useState<PurposeId>("ahj");
  const [templateId, setTemplateId] = useState("ahj_permit");
  const [recipient, setRecipient] = useState("ahj");
  const [data, setData] = useState<StudioData | null>(null);
  const [groups, setGroups] = useState<SelectionGroup[]>([]);
  const [check, setCheck] = useState<StudioCheck | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ releaseId: string; outputs: Output[] } | null>(null);
  const [filter, setFilter] = useState<"relevant" | "all">("relevant");

  const load = useCallback(async (keepGroups = false) => {
    setErr("");
    const q = new URLSearchParams({ purpose, ...(purpose === "custom" ? { templateId, recipient } : {}) });
    const j = await (await fetch(`/api/sites/${siteId}/studio?${q}`)).json().catch(() => ({ ok: false, error: "request failed" }));
    if (!j.ok) return setErr(j.error);
    setData(j);
    if (!keepGroups) setGroups(j.defaultGroups);
    setCheck(null);
  }, [siteId, purpose, templateId, recipient]);
  useEffect(() => { if (isEqore) load(); }, [load, isEqore]);

  const sel = () => ({ purpose, templateId: purpose === "custom" ? templateId : undefined, recipient: purpose === "custom" ? recipient : undefined, groups });
  async function runCheck() {
    setBusy("check"); setErr(""); setResult(null);
    const j = await post(`/api/sites/${siteId}/studio/check`, sel());
    setBusy("");
    if (!j.ok) return setErr(j.error);
    setCheck(j.check);
  }
  async function generate() {
    if (!check) return;
    setBusy("generate"); setErr("");
    const j = await post(`/api/sites/${siteId}/studio/release`, { ...sel(), note, token: check.token });
    setBusy("");
    if (!j.ok) { setErr(j.error); return; }
    setResult({ releaseId: j.release.id, outputs: j.outputs });
    setNote("");
    await load(true);
  }
  async function authorize(d: StudioDocument) {
    const n = window.prompt(`Authorize “${d.name}” for release to ${data?.recipients.find((r) => r.id === data.purpose.recipient)?.label}? Enter a note (required):`);
    if (!n) return;
    const j = await post(`/api/sites/${siteId}/access`, { requirementId: d.requirementId, view: d.policy.view, releaseTo: Array.from(new Set([...d.policy.releaseTo, data!.purpose.recipient])), note: n });
    if (!j.ok) return setErr(j.error);
    await load(true);
  }

  const inSel = new Set(groups.flatMap((g) => g.revisionIds));
  const docById = new Map((data?.documents ?? []).map((d) => [d.revisionId, d]));
  const mutate = (fn: (g: SelectionGroup[]) => SelectionGroup[]) => { setGroups((g) => fn(g.map((x) => ({ ...x, revisionIds: [...x.revisionIds] })))); setCheck(null); setResult(null); };
  const add = (id: string, gi = 0) => mutate((g) => { if (!g.length) g.push({ id: "g-1", name: "Submission package", revisionIds: [] }); g[Math.min(gi, g.length - 1)].revisionIds.push(id); return g; });
  const remove = (id: string) => mutate((g) => g.map((x) => ({ ...x, revisionIds: x.revisionIds.filter((r) => r !== id) })));
  const move = (gi: number, i: number, d: -1 | 1) => mutate((g) => { const a = g[gi].revisionIds; const j = i + d; if (j >= 0 && j < a.length) [a[i], a[j]] = [a[j], a[i]]; return g; });
  const toGroup = (gi: number, i: number, to: number) => mutate((g) => { const [id] = g[gi].revisionIds.splice(i, 1); g[to].revisionIds.push(id); return g; });

  if (!isEqore) return <div className="card p-4 text-sm text-slate-500">Submission Studio is an internal EQORE tool. Sign in as an EQORE user (A. Rivera, M. Chen, PE or R. Patel, PE).</div>;
  const docs = (data?.documents ?? []).filter((d) => filter === "all" || d.requiredByPackage || inSel.has(d.revisionId) || d.status === "in_review");
  const recipientLabel = data?.recipients.find((r) => r.id === data.purpose.recipient)?.label ?? "";

  return (
    <div className="space-y-6">
      <section className="card flex flex-wrap items-end gap-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          {(data?.purposes ?? []).map((p) => <button key={p.id} onClick={() => setPurpose(p.id)} className={`rounded-lg px-3 py-1.5 text-sm ring-1 ${purpose === p.id ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}>{p.name}</button>)}
        </div>
        {purpose === "custom" && data && (
          <div className="flex gap-2 text-xs">
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5">{data.templates.map((t) => <option key={t.id} value={t.id}>Checklist: {t.name}</option>)}</select>
            <select value={recipient} onChange={(e) => setRecipient(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5">{data.recipients.map((r) => <option key={r.id} value={r.id}>Recipient: {r.label}</option>)}</select>
          </div>
        )}
        {data && <div className="text-xs text-slate-500">{data.purpose.description} · recipient: <b>{recipientLabel}</b></div>}
      </section>
      {err && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</div>}

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="card overflow-hidden lg:col-span-3">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold">Available documents</h2>
            <select value={filter} onChange={(e) => setFilter(e.target.value as "relevant" | "all")} className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"><option value="relevant">Relevant to this package</option><option value="all">All documents</option></select>
          </div>
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Document</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Source · hash</th><th className="px-2 py-2">Access</th><th className="px-2 py-2" /></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.revisionId} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2"><Link href={`/sites/${siteId}/documents/${encodeURIComponent(d.revisionId)}`} className="font-medium text-slate-800 hover:underline">{d.name}</Link> <span className="text-slate-500">Rev {d.revLabel}</span>{d.requiredByPackage && <span className="ml-1 rounded bg-indigo-50 px-1 text-[10px] text-indigo-700">required</span>}<div className="text-[11px] text-slate-400">{d.fileName}{d.isPdf ? ` · ${d.pageCount ?? "?"} p` : " · not a PDF"}</div></td>
                    <td className="px-2 py-2"><span className={`pill ${STATUS[d.status]}`}>{d.status === "approved" ? (d.current ? "approved · current" : "approved · superseded") : d.status.replace("_", " ")}</span></td>
                    <td className="px-2 py-2 text-[11px] text-slate-500">{d.source} · {d.approvedBy ?? d.uploadedBy}<div className="font-mono text-[10px] text-slate-400" title={d.sha256}>{d.sha256.slice(0, 12)}…</div></td>
                    <td className="px-2 py-2 text-[11px]">
                      {d.authorizedForRecipient ? <span className="text-emerald-700">✓ releasable to {recipientLabel}</span> : <span className="text-red-700">✕ not authorized for {recipientLabel}</span>}
                      <div className="text-slate-400">view: {d.policy.view.join(", ")}{d.policy.isDefault ? " (default)" : ""}</div>
                      {!d.authorizedForRecipient && <button onClick={() => authorize(d)} className="mt-0.5 text-indigo-700 underline">Authorize…</button>}
                    </td>
                    <td className="px-2 py-2 text-right">{inSel.has(d.revisionId) ? <button onClick={() => remove(d.revisionId)} className="btn-ghost !px-2 !py-0.5 !text-xs">Remove</button> : <button onClick={() => add(d.revisionId)} className="btn-ghost !px-2 !py-0.5 !text-xs">Add</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Package contents → combined PDFs</h2>
            <div className="flex gap-2 text-xs"><button onClick={() => mutate((g) => [...g, { id: `g-${Date.now().toString(36)}`, name: `Part ${g.length + 1}`, revisionIds: [] }])} className="text-indigo-700 underline">+ PDF group</button><button onClick={() => data && mutate(() => data.defaultGroups)} className="text-slate-500 underline">reset</button></div>
          </div>
          {groups.map((g, gi) => (
            <div key={g.id} className="card p-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase text-slate-400">PDF {gi + 1}</span>
                <input value={g.name} onChange={(e) => mutate((x) => { x[gi].name = e.target.value; return x; })} className="flex-1 rounded border border-slate-200 px-2 py-0.5 text-sm font-medium" />
                {groups.length > 1 && <button onClick={() => mutate((x) => x.filter((_, i) => i !== gi))} className="text-xs text-slate-400 hover:text-red-600">✕</button>}
              </div>
              <ol className="mt-2 space-y-1">
                {g.revisionIds.map((id, i) => {
                  const d = docById.get(id);
                  return (
                    <li key={id} className="flex items-center gap-1.5 rounded bg-slate-50 px-2 py-1 text-xs">
                      <span className="w-4 text-slate-400">{i + 1}.</span>
                      <span className="flex-1 truncate">{d ? `${d.name} Rev ${d.revLabel}` : id}{d && d.status !== "approved" ? " (not approved)" : d && !d.current ? " (superseded)" : ""}</span>
                      <button onClick={() => move(gi, i, -1)} className="px-1 text-slate-500 hover:text-slate-900">↑</button>
                      <button onClick={() => move(gi, i, 1)} className="px-1 text-slate-500 hover:text-slate-900">↓</button>
                      {groups.length > 1 && <select value={gi} onChange={(e) => toGroup(gi, i, Number(e.target.value))} className="rounded border border-slate-200 text-[10px]">{groups.map((x, xi) => <option key={x.id} value={xi}>PDF {xi + 1}</option>)}</select>}
                      <button onClick={() => remove(id)} className="px-1 text-slate-400 hover:text-red-600">✕</button>
                    </li>
                  );
                })}
                {!g.revisionIds.length && <li className="text-xs text-slate-400">Empty — add documents from the list.</li>}
              </ol>
            </div>
          ))}
          <button onClick={runCheck} disabled={!!busy} className="btn-primary w-full !py-2 !text-sm">{busy === "check" ? "Checking…" : "Run checks (Guardian preflight + access policy)"}</button>
        </section>
      </div>

      {check && (
        <section className={`card space-y-3 p-4 ${check.canGenerate ? "border-emerald-200" : "border-red-200"}`}>
          <div className={`rounded-lg p-3 text-sm ${check.canGenerate ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
            <b>{check.purpose.name}:</b> {check.canGenerate ? `ready — ${check.groups.filter((g) => g.documents.length).length} combined PDF(s) will be generated as ${check.nextReleaseId}.` : `${check.blockers.length} blocker(s) must be fixed before generating.`} <span className="text-xs">{check.warnings.length} warning(s) · <Link className="underline" href={`/sites/${siteId}/guardian?template=${check.purpose.templateId}`}>open Guardian</Link> · <Link className="underline" href={`/sites/${siteId}#tasks`}>reviews on the site page</Link> · <Link className="underline" href={`/sites/${siteId}/memory`}>project memory</Link></span>
          </div>
          {check.blockers.length > 0 && <ul className="space-y-1.5">{check.blockers.map((i, k) => <IssueRow key={k} i={i} />)}</ul>}
          {check.warnings.length > 0 && <details open={check.canGenerate}><summary className="cursor-pointer text-xs text-slate-600">Warnings ({check.warnings.length}) — not blocking</summary><ul className="mt-1.5 space-y-1.5">{check.warnings.map((i, k) => <IssueRow key={k} i={i} />)}</ul></details>}
          {check.canGenerate && (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={isEngineer ? "Engineer signoff note (required)" : "Engineer signoff required"} disabled={!isEngineer} className="min-w-[260px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
              <button onClick={generate} disabled={!isEngineer || note.trim().length < 3 || !!busy} className="btn-primary !py-1.5 !text-sm">{busy === "generate" ? "Generating PDFs…" : `Sign off & generate ${check.nextReleaseId.split("-").pop()}`}</button>
              {!isEngineer && <span className="text-xs text-slate-500">{userName} can prepare and check; an authorized engineer signs off.</span>}
            </div>
          )}
        </section>
      )}

      {result && (
        <section className="card space-y-3 border-emerald-200 p-4">
          <div className="text-sm"><b>Release {result.releaseId} sealed.</b> <Link className="text-indigo-700 underline" href={`/sites/${siteId}/releases/${encodeURIComponent(result.releaseId)}`}>Open release</Link> · <a className="text-indigo-700 underline" href={`/api/releases/${encodeURIComponent(result.releaseId)}/download`}>ZIP (originals + combined PDFs)</a></div>
          {result.outputs.map((o) => (
            <div key={o.groupId} className="rounded-lg bg-slate-50 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2"><a href={o.href} className="btn-primary !py-1 !text-xs">Download {o.fileName}</a><span>{o.pageCount} pages ({o.coverPages} cover/index)</span><span className="font-mono text-[10px] text-slate-500">sha256 {o.sha256.slice(0, 16)}…</span></div>
              <ol className="mt-2 space-y-0.5">{o.entries.map((e) => <li key={e.order}>{e.order}. {e.name} Rev {e.revLabel} — pp. {e.startPage}–{e.startPage + e.pageCount - 1}{e.rendering === "slip_sheet" ? " (slip sheet)" : ""} <span className="font-mono text-[10px] text-slate-400">{e.sourceSha256.slice(0, 12)}…</span></li>)}</ol>
              {o.warnings.map((w) => <div key={w} className="mt-1 text-amber-800">⚠ {w}</div>)}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
