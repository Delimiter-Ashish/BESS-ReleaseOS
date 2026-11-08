"use client";
// Submission Studio — Choose → Select → Arrange → Verify (Guardian preflight) → Engineer signoff → Assemble & seal.
// Uses only real backends: POST /api/sites/:id/preflight (Guardian), POST /api/sites/:id/studio/check (gate + selection +
// recipient authorization) and POST /api/sites/:id/studio/release (engineer signoff → real combined PDFs + sealed release).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { EvidenceButton } from "@/components/evidence/EvidenceProvider";
import GuardianScan from "@/components/guardian/GuardianScan";
import { DocStatusPill, ReadinessPill } from "@/components/kit";
import { studioCheck, studioRelease, type ApiResult, type ReleaseResponse, type StudioOutput, type StudioSelectionBody } from "@/lib/api/client";
import type { PreflightReport } from "@/lib/guardian/types";
import type { PurposeId, StudioCheck, StudioIssue } from "@/lib/studio/types";
import type { DocStatus, EvidenceRef, ReadinessView } from "@/lib/workspace";

export interface LibraryDoc {
  requirementId: string; name: string; stage: string; status: DocStatus; reason: string; required: boolean;
  approved?: { id: string; revLabel: string; fileName: string; sha256: string; approvedBy?: string; approvedAt?: string; hasFile: boolean };
  pending?: { id: string; revLabel: string }; revisionCount: number; access: string[]; provenance: string; owner: string;
}
export interface StudioRelease { id: string; number: number; builtAt: string; builtBy: string; note?: string; state: string; reasons: string[]; manifestSha256: string; items: { requirementId: string; name: string; revLabel: string; revisionId: string; fileName: string; sha256: string }[] }

// External recipients known to the server-side access policy (lib/studio/access.ts).
const RECIPIENTS = [
  { id: "ahj", label: "Town building & fire (AHJ)" },
  { id: "planning", label: "Planning board" },
  { id: "utility", label: "Utility (interconnection)" },
  { id: "owner", label: "Facility owner" },
  { id: "supplier", label: "Supplier" },
] as const;
const DEFAULT_RECIPIENT: Record<string, string> = { ahj_permit: "ahj", interconnection: "utility", closeout: "owner", planning: "planning" };
// Named Studio purposes; any other template/recipient pairing is a "custom" submission (still fully checked server-side).
const NAMED: Record<string, { purpose: PurposeId; recipient: string }> = { ahj_permit: { purpose: "ahj", recipient: "ahj" }, planning: { purpose: "planning", recipient: "planning" }, interconnection: { purpose: "interconnection", recipient: "utility" } };
const purposeFor = (templateId: string, recipient: string): Pick<StudioSelectionBody, "purpose" | "templateId" | "recipient"> =>
  NAMED[templateId]?.recipient === recipient ? { purpose: NAMED[templateId].purpose } : { purpose: "custom", templateId, recipient };
// Default split into separate PDFs (editable): drawings vs equipment documentation vs everything else.
const defaultGroupFor = (stage: string) => (/design|plan/i.test(stage) ? 0 : /procure/i.test(stage) ? 1 : 2);
const DEFAULT_GROUP_NAMES = ["Plans and drawings", "Equipment documentation", "Supporting documents"];
const STEPS = ["Choose", "Select", "Arrange", "Verify", "Sign off", "Assemble"] as const;
const NOTE_MAX = 1000; // server truncates signoff notes at 1000 characters (lib/store.ts requireNote)

interface Draft { order: string[]; recipient: string; savedAt: string; groupOf?: Record<string, number>; groupNames?: string[] }
const draftKey = (site: string, tpl: string) => `releaseos:studio:${site}:${tpl}`;
function loadDraft(k: string): Draft | undefined { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as Draft) : undefined; } catch { return undefined; } }
function saveDraft(k: string, d: Draft) { try { localStorage.setItem(k, JSON.stringify(d)); } catch { /* storage unavailable: draft stays in memory */ } }

export default function SubmissionStudio(props: {
  site: { id: string; name: string; stage: string }; sites: { id: string; name: string }[];
  purposes: { templateId: string; label: string; audience: string; current: boolean }[]; templateId: string; templateLabel: string; basis: string;
  readiness: ReadinessView; library: LibraryDoc[]; byRev: Record<string, EvidenceRef>; releases: StudioRelease[];
  canSign: boolean; canVerify: boolean; userName: string; isEngineer: boolean;
}) {
  const { site, readiness: rd, library, byRev } = props;
  const router = useRouter();
  const byReq = useMemo(() => new Map(library.map((d) => [d.requirementId, d])), [library]);
  const requiredIncludable = rd.items.filter((i) => i.approved).map((i) => i.requirementId);
  const requiredMissing = rd.items.filter((i) => !i.approved);
  const key = draftKey(site.id, props.templateId);

  const [order, setOrder] = useState<string[]>(requiredIncludable);
  const [groupNames, setGroupNames] = useState<string[]>(DEFAULT_GROUP_NAMES);
  const [groupOf, setGroupOf] = useState<Record<string, number>>(() => Object.fromEntries(library.map((d) => [d.requirementId, defaultGroupFor(d.stage)])));
  const [check, setCheck] = useState<ApiResult<StudioCheck>>();
  const [outputs, setOutputs] = useState<StudioOutput[]>([]);
  const [recipient, setRecipient] = useState(DEFAULT_RECIPIENT[props.templateId] ?? "ahj");
  const [draftAt, setDraftAt] = useState<string>();
  const [q, setQ] = useState("");
  const [libFilter, setLibFilter] = useState<"all" | "approved" | "required">("all");
  const [report, setReport] = useState<PreflightReport>();
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<"idle" | "assembling" | "sealed" | "failed">("idle");
  const [result, setResult] = useState<ApiResult<{ release: ReleaseResponse; outputs: StudioOutput[] }>>();
  const [animDone, setAnimDone] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const loaded = useRef(false);

  // Restore the browser-local draft (order + recipient). Required documents are always re-included.
  useEffect(() => {
    const d = loadDraft(key);
    if (d) {
      const valid = d.order.filter((rid) => byReq.get(rid)?.approved);
      const merged = [...valid, ...requiredIncludable.filter((r) => !valid.includes(r))];
      setOrder(merged); setDraftAt(d.savedAt);
      if (RECIPIENTS.some((r) => r.id === d.recipient)) setRecipient(d.recipient);
      if (d.groupNames?.length) setGroupNames(d.groupNames);
      if (d.groupOf) setGroupOf((g) => ({ ...g, ...d.groupOf }));
    }
    loaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { if (!loaded.current) return; const at = new Date().toISOString(); saveDraft(key, { order, recipient, savedAt: at, groupOf, groupNames }); setDraftAt(at); }, [key, order, recipient, groupOf, groupNames]);

  const toggle = (rid: string) => {
    const d = byReq.get(rid);
    if (!d?.approved || d.required) return;
    setOrder((o) => (o.includes(rid) ? o.filter((x) => x !== rid) : [...o, rid]));
  };
  const move = (from: number, to: number) => setOrder((o) => { if (to < 0 || to >= o.length) return o; const n = o.slice(); const [x] = n.splice(from, 1); n.splice(to, 0, x); return n; });

  const selected = order.map((rid) => byReq.get(rid)!).filter(Boolean);
  const extras = selected.filter((d) => !d.required);
  const gOf = (rid: string) => Math.min(groupOf[rid] ?? 0, groupNames.length - 1);
  // The exact selection the server checks and generates from: groups in order, each a list of approved revision ids.
  const selection: StudioSelectionBody = useMemo(() => ({
    ...purposeFor(props.templateId, recipient),
    groups: groupNames.map((name, gi) => ({ id: `g-${gi + 1}`, name, revisionIds: order.filter((rid) => Math.min(groupOf[rid] ?? 0, groupNames.length - 1) === gi).map((rid) => byReq.get(rid)?.approved?.id).filter((x): x is string => !!x) })).filter((g) => g.revisionIds.length > 0),
  }), [props.templateId, recipient, groupNames, order, groupOf, byReq]);
  const selKey = JSON.stringify(selection);
  const checkData = check?.state === "ok" ? check.data : undefined;
  // Server decides: canGenerate = release gate + selection checks + recipient authorization all pass.
  const gateOk = !!checkData?.canGenerate;
  const token = checkData?.token ?? "";
  const nextNumber = rd.nextNumber;
  const noteBudget = NOTE_MAX;
  const reportKey = report?.ranAt;
  useEffect(() => {
    if (!props.canVerify || phase === "assembling" || phase === "sealed") return;
    let live = true;
    const t = setTimeout(async () => { const r = await studioCheck(site.id, selection); if (live) setCheck(r); }, 350);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, reportKey, props.canVerify, site.id]);

  const filtered = library.filter((d) => (libFilter === "all" || (libFilter === "approved" ? !!d.approved : d.required)) && (!q || `${d.name} ${d.approved?.fileName ?? ""}`.toLowerCase().includes(q.toLowerCase())));

  async function seal() {
    setPhase("assembling"); setResult(undefined); setAnimDone(false);
    const r = await studioRelease(site.id, { ...selection, note: note.trim(), token });
    setResult(r);
    if (r.state === "ok") { setOutputs(r.data.outputs); setPhase("sealed"); router.refresh(); }
    else { setPhase("failed"); setCheck(await studioCheck(site.id, selection)); if (r.state === "error" && r.status === 409) router.refresh(); }
  }
  const rel = result?.state === "ok" ? result.data.release : undefined;
  const moveToGroup = (rid: string, gi: number) => setGroupOf((g) => ({ ...g, [rid]: gi }));

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <ol className="glass sticky top-2 z-10 flex flex-wrap items-center gap-1 px-3 py-2 text-xs">
        {STEPS.map((s, i) => {
          const done = i === 0 || (i === 1 && selected.length > 0) || (i === 2 && selected.length > 0) || (i === 3 && !!report) || (i === 4 && phase !== "idle") || (i === 5 && phase === "sealed");
          return (
            <li key={s} className="flex items-center gap-1">
              {i > 0 && <span className="mx-1 h-px w-4 bg-slate-300" />}
              <a href={`#step-${i}`} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${done ? "text-cyan-700" : "text-slate-500"} hover:bg-slate-100`}>
                <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${done ? "bg-cyan-400 text-night-950" : "bg-slate-200 text-slate-600"}`}>{String.fromCharCode(65 + i)}</span>{s}
              </a>
            </li>
          );
        })}
        <span className="ml-auto flex items-center gap-2"><ReadinessPill s={rd.status} /><span className="text-slate-500">{props.templateLabel} · {site.name}</span></span>
      </ol>

      {/* A. Choose */}
      <Section id="step-0" letter="A" title="Choose the submission">
        <div className="grid gap-4 lg:grid-cols-3">
          <label className="text-xs text-slate-500">Project
            <select value={site.id} onChange={(e) => router.push(`/submissions?project=${e.target.value}`)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900">
              {props.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span className="mt-1 block text-[11px]">Current stage: {site.stage}</span>
          </label>
          <div className="text-xs text-slate-500 lg:col-span-2">Submission purpose
            <div className="mt-1 flex flex-wrap gap-2">
              {props.purposes.map((p) => (
                <button key={p.templateId} type="button" onClick={() => router.push(`/submissions?project=${site.id}&package=${p.templateId}`)} className={`rounded-xl px-3 py-2 text-left text-sm ring-1 ring-inset transition ${p.templateId === props.templateId ? "bg-cyan-50 text-cyan-800 ring-cyan-300" : "text-slate-700 ring-slate-300 hover:bg-slate-100"}`}>
                  {p.label}{p.current && <span className="ml-1 text-[10px] text-slate-500">· current</span>}<span className="block text-[10px] text-slate-500">{p.audience}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <label className="text-xs text-slate-500">Intended recipient / visibility
            <select value={recipient} onChange={(e) => setRecipient(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900">
              {RECIPIENTS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <span className="mt-1 block text-[11px]">Every selected document is checked on the server against the project&apos;s access policy for this recipient. A different recipient than the package default makes this a custom submission.</span>
          </label>
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 lg:col-span-2">
            <div className="font-semibold text-slate-800">Applicable requirements ({rd.items.length})</div>
            <div className="mt-1 flex flex-wrap gap-1">{rd.items.map((i) => <span key={i.requirementId} className={`rounded-md px-1.5 py-0.5 ${i.state === "ready" ? "bg-emerald-50 text-emerald-700" : i.state === "missing" ? "bg-red-50 text-red-700" : "bg-violet-50 text-violet-700"}`}>{i.name}</span>)}</div>
            <div className="mt-1.5 text-[11px] text-slate-500">Basis: {props.basis} (illustrative until EQORE confirms). Documents added by confirmed Project Memory requirements are included automatically by the backend gate.</div>
          </div>
        </div>
      </Section>

      {/* B. Select */}
      <Section id="step-1" letter="B" title="Select documents" hint="Only an engineer-approved revision can be included. A pending revision is never substituted — the approved one is used until an engineer decides.">
        <div className="mb-2 flex flex-wrap gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the project library…" className="min-w-[200px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm" />
          {(["all", "required", "approved"] as const).map((f) => <button key={f} type="button" onClick={() => setLibFilter(f)} className={`rounded-full px-3 py-1 text-xs ${libFilter === f ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>{f === "all" ? `All (${library.length})` : f === "required" ? "Required by package" : "Has approved revision"}</button>)}
        </div>
        <div className="max-h-[420px] overflow-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="w-10 px-3 py-2" /><th className="px-3 py-2">Document</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Approved revision</th><th className="px-3 py-2">Declared audience</th><th className="px-3 py-2" /></tr></thead>
            <tbody>
              {filtered.map((d) => {
                const inc = order.includes(d.requirementId);
                return (
                  <tr key={d.requirementId} className={`border-t border-slate-200 align-top ${inc ? "bg-cyan-50/40" : ""}`}>
                    <td className="px-3 py-2"><input type="checkbox" aria-label={`Include ${d.name}`} checked={inc} disabled={!d.approved || d.required} onChange={() => toggle(d.requirementId)} /></td>
                    <td className="px-3 py-2"><div className="font-medium">{d.name}{d.required && <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] text-slate-600">required</span>}</div><div className="text-[11px] text-slate-500">{d.stage} · {d.owner}</div></td>
                    <td className="px-3 py-2"><DocStatusPill s={d.status} /><div className="mt-0.5 max-w-[220px] text-[11px] text-slate-500">{d.reason}</div></td>
                    <td className="px-3 py-2 text-xs">{d.approved ? <><div>Rev {d.approved.revLabel} · {d.approved.approvedBy ?? "approved"}</div><div className="max-w-[200px] truncate text-[11px] text-slate-400">{d.approved.fileName}{d.approved.hasFile ? "" : " · metadata only (no file)"}</div></> : <span className="text-slate-400">—</span>}{d.pending && <div className="mt-0.5 text-[11px] text-violet-700">Rev {d.pending.revLabel} pending engineer review — not used</div>}</td>
                    <td className="px-3 py-2 text-[11px]">{d.access.map((a) => <span key={a} className={`mr-1 rounded px-1 ${a === recipient ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{a}</span>)}</td>
                    <td className="px-3 py-2 text-right">{d.approved && byRev[d.approved.id] && <EvidenceButton refs={byRev[d.approved.id]} label="Inspect" />}{!d.approved && d.status === "missing" && <Link href={`/inbox?project=${site.id}&expect=${d.requirementId}`} className="text-[11px] text-cyan-600 hover:underline">Import →</Link>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* C. Arrange */}
      <Section id="step-2" letter="C" title="Arrange the package" hint={`Drag to reorder, use the arrows, and choose which combined PDF each document goes into. ${draftAt ? `Draft saved in this browser ${new Date(draftAt).toLocaleTimeString()}.` : ""}`}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            {groupNames.map((gname, gi) => {
              const items = selected.map((d, i) => ({ d, i })).filter(({ d }) => gOf(d.requirementId) === gi);
              return (
                <div key={gi}>
                  <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <span>PDF {gi + 1}</span>
                    <input value={gname} onChange={(e) => setGroupNames((g) => g.map((x, k) => (k === gi ? e.target.value.slice(0, 80) : x)))} aria-label={`Name of PDF ${gi + 1}`} className="rounded border border-slate-200 bg-transparent px-1.5 py-0.5 text-[11px] normal-case tracking-normal text-slate-700" />
                    <span className="font-normal normal-case tracking-normal">{items.length} document(s){items.length === 0 ? " · no PDF will be produced" : ""}</span>
                    {groupNames.length > 1 && items.length === 0 && <button type="button" className="ml-auto text-[11px] font-normal normal-case text-slate-500 hover:underline" onClick={() => { setGroupNames((g) => g.filter((_, k) => k !== gi)); setGroupOf((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v > gi ? v - 1 : v]))); }}>Remove</button>}
                  </div>
                  <ol className="space-y-1.5">
                    {items.map(({ d, i }) => (
                      <li key={d.requirementId} draggable onDragStart={() => (dragFrom.current = i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragFrom.current !== null) { const from = order.indexOf(selected[dragFrom.current].requirementId); moveToGroup(selected[dragFrom.current].requirementId, gi); move(from, i); } dragFrom.current = null; }}
                        className="flex cursor-grab items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 transition hover:border-cyan-300 active:cursor-grabbing" data-testid="studio-item">
                        <span className="w-6 text-center font-mono text-xs text-slate-400">{i + 1}</span>
                        <span className="text-slate-400" aria-hidden>⋮⋮</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{d.name}</span><span className="block truncate text-[11px] text-slate-500">Rev {d.approved!.revLabel} · {d.approved!.fileName}{d.approved!.hasFile ? "" : " · no file (slip sheet)"}</span></span>
                        {!d.required && <span className="pill bg-amber-50 text-amber-700 ring-amber-200">supplemental</span>}
                        {groupNames.length > 1 && <select value={gi} onChange={(e) => moveToGroup(d.requirementId, Number(e.target.value))} aria-label={`PDF for ${d.name}`} className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px]">{groupNames.map((n, k) => <option key={k} value={k}>→ PDF {k + 1}</option>)}</select>}
                        <span className="flex gap-0.5">
                          <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className="btn-ghost !px-1.5 !py-0.5 !text-xs" aria-label={`Move ${d.name} up`}>↑</button>
                          <button type="button" onClick={() => move(i, i + 1)} disabled={i === selected.length - 1} className="btn-ghost !px-1.5 !py-0.5 !text-xs" aria-label={`Move ${d.name} down`}>↓</button>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
            {groupNames.length < 8 && <button type="button" className="btn-ghost !text-xs" onClick={() => setGroupNames((g) => [...g, `Combined PDF ${g.length + 1}`])}>+ Add another PDF</button>}
            <ol className="space-y-1.5">
              {requiredMissing.map((i) => <li key={i.requirementId} className="flex items-center gap-3 rounded-xl border border-dashed border-red-300 px-3 py-2 text-sm text-red-700"><span className="w-6" />✕ {i.name} — {i.state === "missing" ? "missing" : "no approved revision yet"}<Link href={i.href} className="ml-auto text-[11px] underline">{i.action}</Link></li>)}
            </ol>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <div className="font-semibold text-slate-800">What the server does with this arrangement</div>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li>Builds one combined PDF per non-empty group, in exactly this order, from the approved revisions&apos; original bytes.</li>
              <li>Each PDF starts with a cover/index listing every document, revision, SHA-256 and page range.</li>
              <li>The sealed release freezes groups, order, versions, every recipient-access decision and each PDF&apos;s hash. The original files are kept in the ZIP.</li>
              <li>Supplemental documents ({extras.length}) are included physically if the access policy allows them for this recipient.</li>
            </ul>
          </div>
        </div>
      </Section>

      {/* D. Verify */}
      <Section id="step-3" letter="D" title="Guardian preflight" hint="Runs the real backend preflight on the current project state. Blockers are exactly the release gate.">
        <GuardianScan compact site={{ id: site.id, name: site.name }} templateId={props.templateId} templateLabel={props.templateLabel} runLabel="Verify Submission" canRun={props.canVerify} onReport={setReport}
          docs={rd.items.map((i) => ({ requirementId: i.requirementId, name: i.name, state: i.state, revLabel: i.approved?.revLabel ?? i.pending?.revLabel, pendingLabel: i.approved && i.pending ? i.pending.revLabel : undefined }))} byRev={byRev}
          onShowInGraph={(n) => router.push(`/guardian?project=${site.id}&template=${props.templateId}&tab=graph&focus=${encodeURIComponent(n)}`)} />
        <div className="mt-4 rounded-xl border border-slate-200 p-3 text-xs" data-testid="studio-checks">
          <div className="font-semibold text-slate-800">Server checks for this selection <span className="font-normal text-slate-500">(release gate + selection + recipient authorization; re-run automatically when you change the selection)</span></div>
          {!props.canVerify ? <div className="mt-1.5 text-slate-500">Selection checks are available to EQORE users.</div>
            : !check ? <div className="mt-1.5 text-slate-500">Checking…</div>
            : check.state !== "ok" ? <div className="mt-1.5 text-red-700">Check failed: {check.error}</div>
            : (
              <ul className="mt-1.5 space-y-1">
                {checkData!.canGenerate && <Check ok>Ready: {selected.length} document(s) in {selection.groups.length} PDF(s) for {RECIPIENTS.find((r) => r.id === recipient)?.label} — {checkData!.nextReleaseId}.</Check>}
                {checkData!.blockers.map((i, k) => <Issue key={`b${k}`} i={i} />)}
                {checkData!.warnings.map((i, k) => <Issue key={`w${k}`} i={i} />)}
              </ul>
            )}
        </div>
      </Section>

      {/* E. Sign off */}
      <Section id="step-4" letter="E" title="Authorized engineer signoff">
        {!gateOk ? (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-800">Signoff is blocked: {checkData ? `${checkData.blockers.length} blocker(s) from the server checks above` : "waiting for the server check"}. Resolve them and the check re-runs automatically.</div>
        ) : !props.canSign ? (
          <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><b>Ready for authorized signoff.</b> {props.userName} is not an authorized engineer, so this package cannot be sealed from this identity (the server refuses it). An engineer (e.g. M. Chen, PE or R. Patel, PE) will see it under <i>Release Signoff</i>. Your order draft is kept in this browser.</div>
        ) : (
          <div className="space-y-2">
            <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, noteBudget))} rows={2} placeholder="Signoff note (required) — why this package is being issued" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500"><span>Signing as {props.userName}</span><span>· {note.length}/{noteBudget} characters</span><span>· check token {token.slice(0, 10)}… (the server re-verifies it before and after generating the PDFs)</span></div>
          </div>
        )}
      </Section>

      {/* F. Assemble & release */}
      <Section id="step-5" letter="F" title="Assemble & release">
        <Assembly docs={selected} phase={phase} onDone={() => setAnimDone(true)} />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={seal} disabled={!gateOk || !props.canSign || note.trim().length < 3 || phase === "assembling" || phase === "sealed" || selected.length === 0} className="btn-primary" data-testid="studio-seal">
            {phase === "assembling" ? "Generating PDFs & sealing on the server…" : phase === "sealed" ? `R${rel?.number} sealed` : `Sign off, generate ${selection.groups.length} PDF${selection.groups.length === 1 ? "" : "s"} & seal R${nextNumber}`}
          </button>
          <span className="text-[11px] text-slate-500">The server merges the approved source PDFs in your order, verifies page counts and hashes, and seals the release. Nothing is shown as done until it answers.</span>
        </div>
        {phase === "failed" && result && result.state !== "ok" && <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">The server did not seal the release: {result.error}. Nothing was created.</div>}
        {rel && animDone && (
          <div className="ros-rise mt-4 rounded-2xl border border-[rgba(45,212,191,0.4)] bg-night-950 p-5">
            <div className="flex flex-wrap items-center gap-4">
              <span className="ros-seal grid h-14 w-14 place-items-center rounded-full bg-gradient-to-b from-[#5eead4] to-[#14b8a6] text-2xl text-night-950">✓</span>
              <div>
                <div className="text-lg font-semibold text-ink">Release Sealed — {props.templateLabel} R{rel.number}</div>
                <div className="text-xs text-ink-muted">{rel.id} · {new Date(rel.builtAt).toLocaleString()} · signed off by {rel.builtBy}</div>
                <div className="font-mono text-[11px] text-ink-muted">manifest {rel.manifestSha256.slice(0, 20)}… · snapshot {rel.snapshotSha256?.slice(0, 20)}…</div>
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <a href={`/api/releases/${encodeURIComponent(rel.id)}/download`} className="btn-ghost">Download ZIP (originals + PDFs)</a>
                <a href={`/api/releases/${encodeURIComponent(rel.id)}/download?format=json`} target="_blank" className="btn-ghost">Manifest</a>
                <Link href={`/sites/${site.id}/releases/${encodeURIComponent(rel.id)}`} className="btn-ghost">Release page</Link>
              </div>
            </div>
            <div className="mt-4 space-y-3" data-testid="studio-outputs">
              {outputs.map((o) => (
                <div key={o.groupId} className="rounded-xl bg-[rgba(255,255,255,0.03)] p-3 ring-1 ring-inset ring-[rgba(148,163,184,0.14)]">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-semibold text-ink">{o.name}</span>
                    <span className="text-[11px] text-ink-muted">{o.pageCount} pages ({o.coverPages} cover) · <span className="font-mono">sha256 {o.sha256.slice(0, 16)}…</span></span>
                    <a href={o.href} className="btn-primary ml-auto !py-1 !text-xs" data-testid="studio-pdf-link">Download {o.fileName}</a>
                  </div>
                  <table className="mt-2 w-full text-xs">
                    <thead className="text-left text-[10px] uppercase tracking-wide text-ink-muted"><tr><th className="py-1">#</th><th>Document</th><th>Revision</th><th>Pages</th><th>Source SHA-256</th></tr></thead>
                    <tbody className="text-ink-soft">
                      {o.entries.map((e) => (
                        <tr key={e.revisionId} className="border-t border-[rgba(148,163,184,0.12)]">
                          <td className="py-1 font-mono">{e.order}</td><td>{e.name}</td><td className="font-mono">Rev {e.revLabel}</td>
                          <td className="font-mono">{e.startPage}–{e.startPage + e.pageCount - 1}{e.rendering === "slip_sheet" ? " (slip sheet)" : ""}</td><td className="font-mono">{e.sourceSha256.slice(0, 12)}…</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {o.warnings.map((w) => <div key={w} className="mt-1 text-[11px] text-amber-300">! {w}</div>)}
                </div>
              ))}
            </div>
            {rel.note && <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-[rgba(255,255,255,0.04)] p-2 text-[11px] text-ink-muted">{rel.note}</pre>}
          </div>
        )}
      </Section>

      {/* History */}
      <Section id="history" letter="◷" title="Release history" hint="Releases are immutable: a newer approval marks an older release outdated but never changes it.">
        {props.releases.length === 0 ? <div className="text-sm text-slate-500">No release built yet for this package.</div> : (
          <ul className="divide-y divide-slate-200">
            {props.releases.map((r, k) => {
              const prev = props.releases[k + 1];
              return (
                <li key={r.id} className="flex flex-wrap items-start gap-3 py-3">
                  <span className="font-mono text-sm font-semibold">R{r.number}</span>
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="text-slate-700">Sealed {new Date(r.builtAt).toLocaleString()} by {r.builtBy} · <span className="font-mono text-slate-500">{r.manifestSha256.slice(0, 12)}…</span></div>
                    <div className="mt-0.5 flex flex-wrap gap-1">{r.items.map((i) => <span key={i.revisionId} className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">{i.name} Rev {i.revLabel}</span>)}</div>
                    {r.reasons.map((x) => <div key={x} className="mt-0.5 text-[11px] text-amber-700">• {x}</div>)}
                  </div>
                  <span className={`pill ${r.state === "current" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : r.state === "stale" ? "bg-red-50 text-red-700 ring-red-200" : "bg-amber-50 text-amber-700 ring-amber-200"}`}>{r.state === "current" ? "Current" : r.state === "stale" ? "Outdated" : "Change pending review"}</span>
                  <span className="flex flex-wrap gap-2 text-xs">
                    <a href={`/api/releases/${encodeURIComponent(r.id)}/download`} className="text-cyan-600 hover:underline">ZIP</a>
                    <a href={`/api/releases/${encodeURIComponent(r.id)}/download?format=json`} target="_blank" className="text-cyan-600 hover:underline">Manifest</a>
                    {prev && <Link href={`/sites/${site.id}/releases/${encodeURIComponent(r.id)}?compare=${encodeURIComponent(prev.id)}`} className="text-cyan-600 hover:underline">Compare R{prev.number}→R{r.number}</Link>}
                    <Link href={`/guardian?project=${site.id}&template=${props.templateId}&tab=time&release=${encodeURIComponent(r.id)}`} className="text-cyan-600 hover:underline">Time Machine</Link>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ id, letter, title, hint, children }: { id: string; letter: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-20 p-5">
      <div className="mb-3 flex items-start gap-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[rgba(34,211,238,0.12)] text-xs font-bold text-cyan-700">{letter}</span>
        <div><h2 className="text-base font-semibold text-slate-900">{title}</h2>{hint && <p className="text-xs text-slate-500">{hint}</p>}</div>
      </div>
      {children}
    </section>
  );
}
function Issue({ i }: { i: StudioIssue }) {
  const blocker = i.severity === "blocker";
  return (
    <li className={`rounded-lg px-2 py-1.5 ${blocker ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`} data-testid={blocker ? "studio-blocker" : "studio-warning"}>
      <div className="flex gap-2"><span>{blocker ? "✕" : "!"}</span><span className="font-medium">{i.message}</span><span className="ml-auto font-mono text-[10px] opacity-60">{i.code}</span></div>
      {i.source?.label && <div className="pl-5 text-[11px] opacity-80">Source: {i.source.label}</div>}
      {i.evidence && <div className="pl-5 text-[11px] italic opacity-80">“{i.evidence}”</div>}
      <div className="pl-5 text-[11px]"><b>Fix:</b> {i.fix}{i.responsibleParty ? ` · ${i.responsibleParty}` : ""}</div>
    </li>
  );
}
const Check = ({ ok, warn, children }: { ok?: boolean; warn?: boolean; children: React.ReactNode }) => <li className={`flex gap-2 ${ok ? "text-emerald-700" : warn ? "text-amber-700" : "text-red-700"}`}><span>{ok ? "✓" : warn ? "!" : "✕"}</span><span>{children}</span></li>;

/** Magnetic assembly: cards align in the chosen order while the server request runs; the seal appears only after the server confirms. */
function Assembly({ docs, phase, onDone }: { docs: LibraryDoc[]; phase: "idle" | "assembling" | "sealed" | "failed"; onDone: () => void }) {
  const W = 190, H = 64, COLS = 3;
  const stacked = phase === "assembling" || phase === "sealed";
  const rows = Math.ceil(docs.length / COLS);
  const height = stacked ? Math.max(120, 40 + docs.length * 14 + H) : Math.max(120, rows * (H + 14) + 10);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (phase !== "sealed") return;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Transition length is fixed by CSS below; the server has already confirmed — this only lets the cards finish moving.
    const t = setTimeout(() => doneRef.current(), reduced ? 0 : 700 + docs.length * 60);
    return () => clearTimeout(t);
  }, [phase, docs.length]);
  if (!docs.length) return <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Select at least one approved document.</div>;
  return (
    <div className="relative overflow-hidden rounded-2xl bg-night-950 transition-[height] duration-500" style={{ height }} aria-live="polite" aria-label={phase === "assembling" ? "Server is sealing the release" : phase === "sealed" ? "Release sealed" : "Package preview"}>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(400px_200px_at_50%_30%,rgba(34,211,238,0.10),transparent_70%)]" />
      {docs.map((d, i) => {
        const gx = 16 + (i % COLS) * (W + 14), gy = 12 + Math.floor(i / COLS) * (H + 14);
        const sx = `calc(50% - ${W / 2}px)`, sy = 20 + i * 14;
        return (
          <div key={d.requirementId} className="absolute rounded-xl bg-night-700 p-2.5 shadow-lg ring-1 ring-inset ring-[rgba(148,163,184,0.18)]"
            style={{ width: W, height: H, left: stacked ? sx : gx, top: stacked ? sy : gy, transform: stacked ? "rotate(0deg)" : `rotate(${i % 2 ? 1.2 : -1.2}deg)`, transition: `left .6s cubic-bezier(.2,.8,.2,1) ${i * 60}ms, top .6s cubic-bezier(.2,.8,.2,1) ${i * 60}ms, transform .6s ${i * 60}ms, box-shadow .4s`, zIndex: i, boxShadow: phase === "sealed" ? "0 0 0 1px rgba(45,212,191,.45)" : undefined }}>
            <div className="flex items-center justify-between text-[10px] text-ink-muted"><span className="font-mono">{String(i + 1).padStart(2, "0")}</span><span>Rev {d.approved?.revLabel}</span></div>
            <div className="mt-0.5 truncate text-xs font-medium text-ink">{d.name}</div>
            <div className="truncate text-[10px] text-ink-muted">{d.approved?.fileName}</div>
          </div>
        );
      })}
      {phase === "assembling" && <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-[rgba(255,255,255,0.05)]"><span className="ros-indeterminate absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-[#22d3ee] to-transparent" /></div>}
      {phase === "assembling" && <div className="absolute bottom-3 right-4 text-[11px] text-[#67e8f9]">Waiting for the release engine…</div>}
    </div>
  );
}
