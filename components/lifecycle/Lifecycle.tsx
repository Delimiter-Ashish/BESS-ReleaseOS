"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { LifecycleView, ObligationStatus, ObligationView, SiteChange } from "@/lib/lifecycle/types";

const STATUS: Record<ObligationStatus, { label: string; cls: string }> = {
  overdue: { label: "Overdue", cls: "bg-red-50 text-red-700 ring-red-200" },
  needs_review: { label: "Needs review", cls: "bg-orange-50 text-orange-700 ring-orange-200" },
  due_soon: { label: "Due soon", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  awaiting_review: { label: "Awaiting review", cls: "bg-violet-50 text-violet-700 ring-violet-200" },
  open: { label: "Open", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  upcoming: { label: "Upcoming", cls: "bg-slate-50 text-slate-700 ring-slate-200" },
  completed: { label: "Completed", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  not_applicable: { label: "Not yet applicable", cls: "bg-slate-50 text-slate-400 ring-slate-200" },
};
const ORDER: ObligationStatus[] = ["overdue", "needs_review", "due_soon", "awaiting_review", "open", "upcoming", "completed", "not_applicable"];
const KINDS = [
  ["inverter_replace", "Inverter / PCS replaced"], ["add_modules", "Battery modules added / removed"], ["setpoint_change", "Set points or firmware changed"],
  ["occupancy_change", "Occupancy or layout changed"], ["contact_change", "Emergency / service contacts changed"], ["monitoring_device_replace", "Monitoring / metering device replaced like-for-like"],
] as const;
const STAGES = ["contract", "intake", "design", "procurement", "interconnection", "permitting", "installation", "commissioning", "pto", "operations", "decommissioning"];

export default function Lifecycle({ siteId, isEqore, isEngineer, canRecord }: { siteId: string; isEqore: boolean; isEngineer: boolean; canRecord: boolean }) {
  const [v, setV] = useState<LifecycleView | null>(null);
  const [asOf, setAsOf] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [chg, setChg] = useState({ kind: "inverter_replace", description: "", from: "", to: "", effectiveDate: "" });

  const load = useCallback(async () => {
    const j = await (await fetch(`/api/sites/${siteId}/lifecycle${asOf ? `?asOf=${asOf}` : ""}`)).json().catch(() => ({ ok: false, error: "request failed" }));
    if (!j.ok) return setErr(j.error);
    setErr(""); setV(j.lifecycle);
  }, [siteId, asOf]);
  useEffect(() => { load(); }, [load]);

  async function act(body: Record<string, unknown>, done?: string) {
    setBusy(true); setErr(""); setMsg("");
    const r = await fetch(`/api/sites/${siteId}/lifecycle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    setBusy(false);
    if (!j.ok) return setErr(`${r.status}: ${j.error}`);
    setMsg(done ?? "Saved."); await load();
    return j;
  }
  const ask = (q: string, d = "") => window.prompt(q, d)?.trim();

  if (!v) return <div className="card p-5 text-sm text-slate-500">{err || "Loading lifecycle register…"}</div>;
  const openImpacts = v.impacts.filter((i) => i.status === "open");
  const attention = v.obligations.filter((o) => ["overdue", "needs_review", "due_soon", "awaiting_review"].includes(o.status));
  const byCat = Array.from(new Set(v.obligations.map((o) => o.categoryLabel)));

  return (
    <div className="space-y-5">
      {(err || msg) && <div className={`card p-3 text-sm ${err ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{err || msg}</div>}

      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Lifecycle stage</div>
            <div className="text-xl font-semibold" data-testid="stage">{v.stageLabel}</div>
            <div className="text-xs text-slate-500">Status as of <b data-testid="asof">{v.asOf}</b> ({v.timezone}, {v.clock === "frozen" ? "frozen demo clock" : "system clock"}) · warning window {v.warningDays} days</div>
          </div>
          <div className="flex flex-wrap items-end gap-2 text-xs">
            <label className="flex flex-col">Preview status as of<input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="rounded border px-2 py-1" /></label>
            {asOf && <button className="btn-ghost text-xs" onClick={() => setAsOf("")}>Today</button>}
            {isEqore && (
              <>
                <select className="rounded border px-2 py-1.5" defaultValue="" onChange={async (e) => { const to = e.target.value; e.target.value = ""; if (!to) return; const note = ask(`Reason for moving to ${to}:`); if (note) await act({ action: "set_stage", to, note }, `Stage changed to ${to}.`); }}>
                  <option value="">Move stage…</option>
                  {STAGES.filter((s) => s !== v.stage).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button className="btn-ghost text-xs" disabled={busy} onClick={async () => { const w = ask("Default warning window (days):", String(v.warningDays)); if (w === undefined) return; const note = ask("Why?"); if (note) await act({ action: "settings", warningDays: Number(w), note }); }}>Warning window</button>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {ORDER.map((s) => <span key={s} className={`pill ${STATUS[s].cls}`} data-testid={`count-${s}`}>{STATUS[s].label}: {v.counts[s]}</span>)}
        </div>
        <p className="text-[11px] text-slate-500">{v.disclaimer}</p>
        {v.viewer.restricted && <p className="text-xs text-amber-700">Restricted view ({v.viewer.role}): only obligations whose documents the access policy lets you see; internal notes, change records and evidence quotes are hidden.</p>}
      </section>

      {isEqore && (
        <section className="card space-y-3 p-5" id="impacts">
          <h2 className="text-lg font-semibold">Re-review after confirmed site changes <span className="text-sm font-normal text-slate-500">({openImpacts.length} open)</span></h2>
          {openImpacts.length === 0 && <p className="text-sm text-slate-500">No open impacts.</p>}
          <ul className="space-y-3">
            {openImpacts.map((i) => {
              const ob = v.obligations.find((o) => o.id === i.obligationId);
              return (
                <li key={i.id} className="rounded-lg border border-orange-200 bg-orange-50/50 p-3 text-sm" data-testid="impact">
                  <div className="font-medium">{ob?.title ?? i.requirementId} — may need review</div>
                  <div className="mt-1 text-xs"><b>What changed:</b> {i.what}</div>
                  <div className="mt-0.5 text-xs"><b>Why:</b> {i.why}</div>
                  {i.evidence.map((e, k) => <div key={k} className="mt-0.5 text-xs italic text-slate-700">Evidence: <Link className="underline" href={`/sites/${siteId}/documents/${encodeURIComponent(e.revisionId)}`}>Rev {e.revLabel} p.{e.page}</Link> “{e.quote}”</div>)}
                  <div className="mt-0.5 text-xs"><b>Source:</b> {i.source.label} ({i.source.citation})</div>
                  <div className="mt-0.5 text-xs"><b>Update:</b> {i.documentToUpdate} · <b>Responsible:</b> {i.responsible} · <b>Reviewer:</b> licensed engineer</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link className="btn-ghost text-xs" href={`/inbox?project=${siteId}&expect=${i.requirementId}`}>Upload updated document</Link>
                    <Link className="btn-ghost text-xs" href={`/reviews?project=${siteId}`}>Review uploads</Link>
                    <button className="btn-primary text-xs" disabled={busy || !isEngineer} title={isEngineer ? "" : "Engineer only"} onClick={async () => { const note = ask("Resolution note (the updated revision must already be approved):"); if (note) await act({ action: "resolve_impact", impactId: i.id, resolution: "new_revision_approved", note }, "Resolved with the approved updated revision."); }}>Resolve: updated revision approved</button>
                    <button className="btn-ghost text-xs" disabled={busy || !isEngineer} onClick={async () => { const note = ask("Justify why no change is needed (≥ 20 characters):"); if (note) await act({ action: "resolve_impact", impactId: i.id, resolution: "confirmed_no_change", note }, "Resolved: no change needed."); }}>No change needed…</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {attention.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-2 text-lg font-semibold">Needs attention</h2>
          <ul className="space-y-1 text-sm">{attention.map((o) => <li key={o.id}><span className={`pill mr-2 ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span><a href={`#${o.id}`} className="font-medium hover:underline">{o.title}</a> <span className="text-xs text-slate-500">— {o.statusReason}</span></li>)}</ul>
        </section>
      )}

      {(isEqore || canRecord) && (
        <section className="card space-y-3 p-5">
          <h2 className="text-lg font-semibold">Record a site change</h2>
          <p className="text-xs text-slate-500">A recorded change is only a proposal. Nothing is flagged until an EQORE user confirms it; then ReleaseOS lists the obligations that may need review, with evidence, for an engineer to resolve.</p>
          <div className="grid gap-2 text-sm md:grid-cols-5">
            <select className="rounded border px-2 py-1.5" value={chg.kind} onChange={(e) => setChg({ ...chg, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <input className="rounded border px-2 py-1.5 md:col-span-2" placeholder="Description" value={chg.description} onChange={(e) => setChg({ ...chg, description: e.target.value })} />
            <input className="rounded border px-2 py-1.5" placeholder="Replaced (e.g. 2 x Dynapower MPS125)" value={chg.from} onChange={(e) => setChg({ ...chg, from: e.target.value })} />
            <input className="rounded border px-2 py-1.5" placeholder="New (e.g. 2 x Northbridge NPI-125)" value={chg.to} onChange={(e) => setChg({ ...chg, to: e.target.value })} />
            <input type="date" className="rounded border px-2 py-1.5" value={chg.effectiveDate} onChange={(e) => setChg({ ...chg, effectiveDate: e.target.value })} />
            <button className="btn-primary" disabled={busy} onClick={() => act({ action: "propose_change", ...chg }, "Change recorded as a proposal.")}>Record change</button>
          </div>
          {isEqore && v.changes.length > 0 && (
            <ul className="divide-y divide-slate-100 text-sm">
              {[...v.changes].reverse().map((c: SiteChange) => (
                <li key={c.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`pill ${c.status === "confirmed" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : c.status === "proposed" ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-slate-50 text-slate-500 ring-slate-200"}`}>{c.status}</span>
                    <span className="font-medium">{c.description}</span>
                    <span className="text-xs text-slate-500">{c.effectiveDate} · {c.origin === "memory_suggestion" ? "from project-memory suggestion" : "manual"} · by {c.proposedBy}</span>
                    {c.status === "proposed" && <>
                      <button className="btn-primary text-xs" disabled={busy} onClick={async () => { const note = ask("Confirmation note (who verified this change on site?):"); if (note) await act({ action: "confirm_change", changeId: c.id, note }, "Change confirmed; impacted obligations flagged for review."); }}>Confirm</button>
                      <button className="btn-ghost text-xs" disabled={busy} onClick={async () => { const note = ask("Why dismiss?"); if (note) await act({ action: "dismiss_change", changeId: c.id, note }); }}>Dismiss</button>
                    </>}
                  </div>
                  {c.assessment && (
                    <details className="mt-1 text-xs text-slate-600"><summary className="cursor-pointer">Assessment: {c.assessment.filter((x) => x.flagged).length} flagged / {c.assessment.length} obligations checked</summary>
                      <ul className="ml-4 list-disc">{c.assessment.map((x) => <li key={x.obligationId} className={x.flagged ? "text-orange-800" : ""}>{x.flagged ? "Flagged — " : "Not flagged — "}{x.reason}</li>)}</ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {isEqore && (
        <section className="card space-y-2 p-5">
          <h2 className="text-lg font-semibold">Add a project-specific scheduled record</h2>
          <p className="text-xs text-slate-500">Due dates are configured per project (synthetic in this demo). ReleaseOS does not supply NFPA deadlines or maintenance frequencies.</p>
          <button className="btn-ghost text-sm" disabled={busy} onClick={async () => {
            const title = ask("Title:", "Scheduled maintenance inspection record"); if (!title) return;
            const dueDate = ask("Due date (YYYY-MM-DD):"); if (!dueDate) return;
            const warningDays = ask("Warning window in days (blank = site default):", "7");
            const note = ask("Basis for this schedule (project-specific):", "Owner O&M agreement schedule (synthetic demo data)"); if (!note) return;
            await act({ action: "add_obligation", requirementId: "ops_record", category: "operations_records", kind: "record", title, dueDate, ...(warningDays ? { warningDays: Number(warningDays) } : {}), note }, "Scheduled record added.");
          }}>+ Scheduled maintenance / test record</button>
        </section>
      )}

      <section className="space-y-4">
        {byCat.map((cat) => (
          <div key={cat} className="card p-5">
            <h2 className="mb-2 text-base font-semibold">{cat}</h2>
            <ul className="divide-y divide-slate-100">
              {v.obligations.filter((o) => o.categoryLabel === cat).map((o) => <ObligationRow key={o.id} o={o} siteId={siteId} isEqore={isEqore} isEngineer={isEngineer} canRecord={canRecord} busy={busy} act={act} ask={ask} />)}
            </ul>
          </div>
        ))}
      </section>

      {isEqore && (
        <section className="card space-y-2 p-5" id="publications">
          <h2 className="text-lg font-semibold">First-responder (QR) publication</h2>
          <p className="text-xs text-slate-500">Nothing is public by default. An engineer must explicitly publish each approved revision; the public page serves it only while it is still the current approved revision and its hash matches. <Link className="underline" href={`/p/${siteId}`} target="_blank">Open public QR page ↗</Link></p>
          <ul className="text-sm">{v.publications.map((p) => <li key={p.id} className="flex items-center gap-2 py-1"><span className={`pill ${p.status === "published" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-50 text-slate-500 ring-slate-200"}`}>{p.status}</span>{p.title} <span className="text-xs text-slate-500">by {p.publishedBy}</span>{p.status === "published" && <button className="btn-ghost text-xs" disabled={busy} onClick={async () => { const note = ask("Why withdraw?"); if (note) await act({ action: "withdraw_emergency", publicationId: p.id, note }); }}>Withdraw</button>}</li>)}</ul>
          <div className="flex flex-wrap gap-2">{v.publishCandidates.map((c) => <button key={c.revisionId} className="btn-ghost text-xs" disabled={busy || !isEngineer} title={isEngineer ? "" : "Engineer only"} onClick={async () => { const note = ask(`Publish “${c.title}” to the public QR page? Approval note:`); if (note) await act({ action: "publish_emergency", revisionId: c.revisionId, note }, "Published to the public emergency page."); }}>Publish {c.title}</button>)}</div>
        </section>
      )}
    </div>
  );
}

function ObligationRow({ o, siteId, isEqore, isEngineer, canRecord, busy, act, ask }: { o: ObligationView; siteId: string; isEqore: boolean; isEngineer: boolean; canRecord: boolean; busy: boolean; act: (b: Record<string, unknown>, d?: string) => Promise<unknown>; ask: (q: string, d?: string) => string | undefined }) {
  const pending = o.events.filter((e) => !e.evidenceRevisionId);
  return (
    <li id={o.id} className="py-3 text-sm" data-testid="obligation">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{o.title} {o.kind === "record" && <span className="pill ml-1 bg-slate-50 text-slate-600 ring-slate-200">scheduled record</span>}</div>
          <div className="text-xs text-slate-600">{o.statusReason}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            Stage: {o.stageLabel} · Responsible: {o.responsible} · Source: {o.source.label} ({o.source.citation})
            {o.currentRevision && <> · <Link className="underline" href={o.currentRevision.href}>Rev {o.currentRevision.revLabel}</Link></>}
            {o.pendingRevision && <> · <Link className="underline" href={o.pendingRevision.href}>Rev {o.pendingRevision.revLabel} pending</Link></>}
            {o.due && <> · Due <b>{o.due.date}</b> ({o.due.daysRemaining >= 0 ? `${o.due.daysRemaining}d left` : `${-o.due.daysRemaining}d late`}, window {o.due.warningDays}d) <span className="text-amber-700">project-specific{o.due.synthetic ? " · synthetic" : ""}</span></>}
            {" "}· Visible to: {o.access.view.join(", ")}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-700"><b>Next:</b> {o.nextAction}</div>
          {o.completion && o.status === "completed" && o.kind === "record" && <div className="mt-0.5 text-[11px] text-emerald-700">Verified by {o.completion.verifiedBy}; evidence {o.completion.evidenceRevisionId}</div>}
        </div>
        <span className={`pill shrink-0 ${STATUS[o.status].cls}`} data-testid="status">{STATUS[o.status].label}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {isEqore && <button className="btn-ghost text-xs" disabled={busy} onClick={async () => { const dueDate = ask("Project-specific due date (YYYY-MM-DD):", o.due?.date ?? ""); if (!dueDate) return; const w = ask("Warning window days (blank = site default):", o.due?.warningDays ? String(o.due.warningDays) : ""); const note = ask("Basis (project-specific):"); if (note) await act({ action: "set_due", obligationId: o.id, dueDate, ...(w ? { warningDays: Number(w) } : {}), note }); }}>Set due date</button>}
        {o.kind === "record" && canRecord && o.status !== "not_applicable" && <button className="btn-ghost text-xs" disabled={busy} onClick={async () => { const performedOn = ask("Performed on (YYYY-MM-DD):"); if (!performedOn) return; const performedBy = ask("Performed by:"); const summary = ask("What was done / result:"); if (performedBy && summary) await act({ action: "record_event", obligationId: o.id, type: "maintenance", performedOn, performedBy, summary }, "Event recorded — not complete until evidence is reviewed."); }}>Record event</button>}
        {o.kind === "record" && pending.length > 0 && isEngineer && (o.evidenceCandidates ?? []).map((c) => (
          <button key={c.id} className="btn-primary text-xs" disabled={busy} onClick={async () => { const note = ask(`Verify ${pending[0].performedOn} event against Rev ${c.revLabel} (${c.fileName})? Note:`); if (note) await act({ action: "verify_completion", obligationId: o.id, eventId: pending[0].id, evidenceRevisionId: c.id, note }, "Completion verified."); }}>Verify with Rev {c.revLabel}</button>
        ))}
        {isEqore && (o.status === "open" || o.status === "needs_review" || o.status === "overdue" || o.status === "due_soon") && <Link className="btn-ghost text-xs" href={`/inbox?project=${siteId}&expect=${o.requirementId}`}>Upload</Link>}
      </div>
      {isEqore && o.history && o.history.length > 1 && (
        <details className="mt-1 text-[11px] text-slate-500"><summary className="cursor-pointer">History ({o.history.length})</summary><ul className="ml-4 list-disc">{o.history.map((h, k) => <li key={k}>{h.at.slice(0, 16).replace("T", " ")} · {h.by} · {h.action}: {h.detail}</li>)}</ul></details>
      )}
    </li>
  );
}
