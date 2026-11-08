"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseEmailHeaders } from "@/lib/memory/email";

const CHANNELS = [
  { id: "email", label: "Email thread" },
  { id: "ahj_comment", label: "AHJ / plan-review comment" },
  { id: "engineering_note", label: "Engineering note" },
  { id: "meeting_note", label: "Meeting note" },
  { id: "other", label: "Other" },
];

/** Paste or import (.txt/.eml) a communication. Original text is stored verbatim; extraction results are suggestions. */
export default function ImportCommunication({ siteId, canImport, provider }: { siteId: string; canImport: boolean; provider: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState("email");
  const [sender, setSender] = useState("");
  const [sentAt, setSentAt] = useState("");
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ duplicate: boolean; engine: string; model?: string; fallback: boolean; count: number; warnings: string[] } | null>(null);
  const h = parseEmailHeaders(body);

  async function loadFile(f: File) {
    if (f.size > 200_000) return setErr("File too large (max 200 KB of text)");
    const text = await f.text();
    setBody(text);
    if (/ahj|fire|plan review/i.test(text.slice(0, 800))) setChannel("ahj_comment");
  }

  async function submit() {
    setBusy(true); setErr(""); setResult(null);
    const r = await fetch(`/api/sites/${siteId}/communications`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body, channel, sender: sender || undefined, sentAt: sentAt ? new Date(sentAt).toISOString() : undefined, subject: subject || undefined }) });
    const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    setBusy(false);
    if (!j.ok) return setErr(j.error);
    const a = j.communication.analysis;
    setResult({ duplicate: j.duplicate, engine: a.engine, model: a.model, fallback: a.fallback, count: j.items.length, warnings: a.warnings });
    if (!j.duplicate) { setBody(""); setSender(""); setSentAt(""); setSubject(""); }
    router.refresh();
  }

  if (!canImport) return <div className="card p-4 text-sm text-slate-500">Sign in as an EQORE user (e.g. A. Rivera, PM) to import communications.</div>;
  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Import a communication</h2>
          <p className="text-xs text-slate-500">Paste an email, AHJ comment or engineering note — or import a .txt/.eml file. Use synthetic or authorized content only.</p>
        </div>
        <span className="pill bg-slate-100 text-slate-700 ring-slate-200">Extraction: {provider}</span>
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} placeholder={"From: …\nDate: …\nSubject: …\n\nMessage text"} className="w-full rounded-lg border border-slate-300 p-2 font-mono text-xs" />
      <div className="grid gap-2 sm:grid-cols-4">
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          {CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <input value={sender} onChange={(e) => setSender(e.target.value)} placeholder={h.from ? `Sender: ${h.from.slice(0, 40)}` : "Sender (required if no From:)"} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        <input type="datetime-local" value={sentAt} onChange={(e) => setSentAt(e.target.value)} title={h.date ? `From Date: header — ${h.date}` : "Sent date/time"} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={h.subject ? `Subject: ${h.subject.slice(0, 40)}` : "Subject (optional)"} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
      </div>
      {(h.from || h.date) && <div className="text-[11px] text-slate-500">Detected from headers: {h.from ?? "—"} · {h.date ? new Date(h.date).toLocaleString() : "no date"}{h.subject ? ` · “${h.subject}”` : ""}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={submit} disabled={busy || body.trim().length < 20} className="btn-primary !py-1.5 !text-sm">{busy ? "Analyzing…" : "Import & extract"}</button>
        <label className="btn-ghost cursor-pointer !py-1.5 !text-sm">Import file…<input type="file" accept=".txt,.eml,text/plain,message/rfc822" className="hidden" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} /></label>
        <span className="text-[11px] text-slate-400">Extracted items are suggestions until a person confirms them. They never block a release on their own.</span>
      </div>
      {err && <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{err}</div>}
      {result && (
        <div className={`rounded-lg p-2 text-xs ${result.duplicate ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}>
          {result.duplicate ? "Already imported — this communication is on record; no duplicate items were created." : `Imported. ${result.count} suggestion(s) from ${result.engine === "openai" ? `OpenAI${result.model ? ` (${result.model})` : ""}` : `deterministic rules${result.fallback ? " (fallback)" : ""}`}.`}
          {result.warnings.map((w) => <div key={w} className="mt-1 text-amber-800">⚠ {w}</div>)}
        </div>
      )}
    </section>
  );
}
