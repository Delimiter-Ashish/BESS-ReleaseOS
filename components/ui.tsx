// Small presentational primitives shared by server and client components.
import type { Fact, FactChange } from "@/lib/types";

export const SIG_META = {
  material: { label: "Material change", cls: "bg-red-50 text-red-700 ring-red-200" },
  cosmetic: { label: "Cosmetic", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
  informational: { label: "Metadata", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
} as const;

export function SignificanceBadge({ s }: { s?: FactChange["significance"] }) {
  const m = SIG_META[s ?? "material"];
  return <span className={`pill ${m.cls}`}>{m.label}</span>;
}

export function EngineBadge({ engine, model, fallback }: { engine?: string; model?: string; fallback?: boolean }) {
  if (engine === "openai") return <span className="pill bg-emerald-50 text-emerald-800 ring-emerald-200" title={model}>✦ OpenAI{model ? ` · ${model}` : ""}</span>;
  if (engine === "claude") return <span className="pill bg-amber-50 text-amber-800 ring-amber-200" title={model}>✦ Anthropic{model ? ` · ${model}` : ""}</span>;
  if (engine === "seed") return <span className="pill bg-slate-100 text-slate-600 ring-slate-200">Seeded record</span>;
  return <span className={`pill ${fallback ? "bg-orange-50 text-orange-800 ring-orange-200" : "bg-slate-100 text-slate-700 ring-slate-200"}`}>⚙ Deterministic rules{fallback ? " (fallback)" : ""}</span>;
}

export function EvidenceStatus({ f }: { f: Pick<Fact, "evidenceVerified" | "pageVerified" | "page" | "status" | "origin"> }) {
  if (f.status === "ambiguous") return <span className="pill bg-orange-50 text-orange-800 ring-orange-200">Ambiguous</span>;
  if (f.status === "uncertain") return <span className="pill bg-amber-50 text-amber-800 ring-amber-200">Uncertain</span>;
  if (f.evidenceVerified) return <span className="pill bg-emerald-50 text-emerald-700 ring-emerald-200" title="Quote found verbatim in the PDF text layer">✓ Quote verified{f.page ? ` · p.${f.page}` : ""}</span>;
  return <span className="pill bg-slate-100 text-slate-600 ring-slate-200" title="No text layer to check against (scan/image) — verify visually">Unverified{f.page ? ` · p.${f.page}?` : ""}</span>;
}

export function Confidence({ c }: { c: number }) {
  const cls = c >= 0.85 ? "text-emerald-700 bg-emerald-50" : c >= 0.6 ? "text-amber-700 bg-amber-50" : "text-red-700 bg-red-50";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${cls}`}>{Math.round(c * 100)}%</span>;
}

export function Hash({ h, n = 12 }: { h?: string; n?: number }) {
  if (!h) return null;
  return <span className="font-mono text-[11px] text-slate-400" title={h}>{h.slice(0, n)}…</span>;
}

/** Old → new value cell used in every comparison table. */
export function ValueChange({ c }: { c: FactChange }) {
  const material = c.significance === "material";
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1.5">
      <span className={material ? "text-slate-500 line-through decoration-red-400" : "text-slate-500"}>{c.before ?? "—"}</span>
      <span className="text-slate-400">→</span>
      <span className={material ? "rounded bg-red-50 px-1 font-semibold text-red-700" : "font-medium text-slate-800"}>{c.after ?? "—"}</span>
      {(c.key.startsWith("rating.") || c.key === "equipment.quantity") && c.normalizedAfter && c.after && c.normalizedAfter.toLowerCase() !== c.after.toLowerCase() && <span className="text-[11px] text-slate-400">({c.normalizedBefore ?? "—"} → {c.normalizedAfter})</span>}
    </span>
  );
}

export function ChangeTable({ changes, showImpact = true }: { changes: FactChange[]; showImpact?: boolean }) {
  if (!changes.length) return <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">No fact-level differences detected.</div>;
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
          <tr><th className="px-3 py-2">Fact</th><th className="px-3 py-2">Previous → new</th><th className="px-3 py-2">Classification</th><th className="px-3 py-2">Evidence (new revision)</th></tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.key} className={`border-t border-slate-100 align-top ${c.significance === "material" ? "bg-red-50/30" : ""}`}>
              <td className="px-3 py-2 font-medium text-slate-700">{c.label}</td>
              <td className="px-3 py-2"><ValueChange c={c} /></td>
              <td className="px-3 py-2">
                <SignificanceBadge s={c.significance} />
                {c.reason && <div className="mt-1 max-w-[220px] text-[11px] text-slate-500">{c.reason}</div>}
              </td>
              <td className="px-3 py-2 text-xs">
                {c.evidenceAfter ? <span className="italic text-slate-600">“{c.evidenceAfter}”</span> : <span className="text-slate-400">—</span>}
                <div className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-slate-400">
                  {c.pageAfter ? <span>p.{c.pageAfter}</span> : null}
                  {c.evidenceVerifiedAfter ? <span className="text-emerald-600">✓ verified in text layer</span> : c.evidenceAfter ? <span>not machine-verified</span> : null}
                </div>
                {c.evidenceBefore && <div className="mt-1 text-[11px] text-slate-400">was: “{c.evidenceBefore}”{c.pageBefore ? ` · p.${c.pageBefore}` : ""}</div>}
                {showImpact && c.impact && (
                  <div className="mt-2 rounded-md bg-amber-50 p-2 text-[11px] text-amber-900">
                    <span className="font-semibold">{c.impactSource === "openai" ? "AI-suggested impact" : "Rule-based impact note"}:</span> {c.impact}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
