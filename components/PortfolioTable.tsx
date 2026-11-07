"use client";
import Link from "next/link";
import { useMemo, useState } from "react";

export interface Row {
  id: string;
  name: string;
  city: string;
  state: string;
  stage: string;
  stageLabel: string;
  utility: string;
  kwh: number;
  score: number;
  health: "red" | "amber" | "green";
  missing: number;
  outdated: number;
  overdue: number;
  dueSoon: number;
  review: number;
}

const HEALTH = { red: "bg-red-500", amber: "bg-amber-400", green: "bg-emerald-500" };

export default function PortfolioTable({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState("all");
  const [health, setHealth] = useState("all");

  const filtered = useMemo(
    () =>
      rows
        .filter((r) => (state === "all" ? true : r.state === state))
        .filter((r) => (health === "all" ? true : r.health === health))
        .filter((r) => `${r.name} ${r.city} ${r.id} ${r.utility}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => a.score - b.score || b.missing + b.outdated + b.overdue - (a.missing + a.outdated + a.overdue)),
    [rows, q, state, health],
  );

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search site, town, utility…"
          className="w-56 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500"
        />
        <select value={state} onChange={(e) => setState(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          <option value="all">All regions</option>
          <option value="MA">Massachusetts</option>
          <option value="CA">Bay Area</option>
        </select>
        <select value={health} onChange={(e) => setHealth(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          <option value="all">All statuses</option>
          <option value="red">Needs action</option>
          <option value="amber">Watch</option>
          <option value="green">Compliant</option>
        </select>
        <span className="ml-auto text-xs text-slate-500">{filtered.length} sites</span>
      </div>
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Site</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">Compliance</th>
              <th className="px-3 py-2">Issues</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link href={`/sites/${r.id}`} className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${HEALTH[r.health]}`} />
                    <span>
                      <span className="font-medium">{r.name}</span>
                      <span className="block text-xs text-slate-500">
                        {r.id} · {r.city}, {r.state} · {r.utility} · {r.kwh.toLocaleString()} kWh
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-slate-600">{r.stageLabel}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
                      <div className={`h-full ${r.score >= 90 ? "bg-emerald-500" : r.score >= 70 ? "bg-amber-400" : "bg-red-500"}`} style={{ width: `${r.score}%` }} />
                    </div>
                    <span className="tabular-nums text-xs text-slate-600">{r.score}%</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs">
                  <div className="flex flex-wrap gap-1">
                    {r.missing > 0 && <span className="pill bg-red-50 text-red-700 ring-red-200">{r.missing} missing</span>}
                    {r.outdated > 0 && <span className="pill bg-orange-50 text-orange-700 ring-orange-200">{r.outdated} outdated</span>}
                    {r.overdue > 0 && <span className="pill bg-red-50 text-red-700 ring-red-200">{r.overdue} overdue</span>}
                    {r.dueSoon > 0 && <span className="pill bg-amber-50 text-amber-700 ring-amber-200">{r.dueSoon} due soon</span>}
                    {r.review > 0 && <span className="pill bg-violet-50 text-violet-700 ring-violet-200">{r.review} review</span>}
                    {r.missing + r.outdated + r.overdue + r.dueSoon + r.review === 0 && <span className="text-slate-400">—</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
