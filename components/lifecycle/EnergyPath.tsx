"use client";
// Living lifecycle pathway: energy flows up to the CURRENT stage only (completed = restrained mint, current = cyan,
// future = understated). Amber dots come from real per-stage counts (missing / overdue / needs review) passed in by the
// page — the path never implies a project is complete or compliant. Re-animates when the stage changes (keyed by index).
import { useEffect, useState } from "react";

export interface PathStage { id: string; short: string; label: string; attention?: number; attentionLabel?: string }

export default function EnergyPath({ stages, current, compact }: { stages: PathStage[]; current: number; compact?: boolean }) {
  const [charged, setCharged] = useState(false);
  useEffect(() => { setCharged(false); const t = requestAnimationFrame(() => requestAnimationFrame(() => setCharged(true))); return () => cancelAnimationFrame(t); }, [current]);
  const n = stages.length;
  const pct = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const reach = pct(Math.max(0, current));
  return (
    <div className={`relative ${compact ? "px-2 pb-1 pt-3" : "px-3 pb-2 pt-4"}`} role="img" aria-label={`Lifecycle: stage ${current + 1} of ${n}, ${stages[current]?.label}`} data-testid="energy-path" data-current={current}>
      <div className="relative mx-3 h-[3px] rounded-full bg-[rgba(148,163,184,0.16)]">
        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[rgba(114,225,187,0.55)] to-[#55DDE5] shadow-[0_0_12px_rgba(85,221,229,0.45)]"
          style={{ width: charged ? `${reach}%` : "0%", transition: "width 1.1s cubic-bezier(.25,.8,.25,1)" }} />
        {stages.map((s, i) => {
          const done = i < current, cur = i === current;
          return (
            <div key={s.id} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pct(i)}%` }}>
              <span className={`block rounded-full transition-all duration-500 ${cur ? "h-3.5 w-3.5 bg-[#55DDE5] shadow-[0_0_0_4px_rgba(85,221,229,0.18),0_0_16px_rgba(85,221,229,0.7)]" : done ? "h-2.5 w-2.5 bg-[#72E1BB]" : "h-2 w-2 bg-[rgba(148,163,184,0.35)]"}`}
                style={{ transitionDelay: charged ? `${(i / Math.max(1, current)) * 900}ms` : "0ms", opacity: charged || !(done || cur) ? 1 : 0.4 }} />
              {(s.attention ?? 0) > 0 && <span title={s.attentionLabel} className="absolute -right-1.5 -top-2 h-2 w-2 rounded-full bg-[#F1B56A] shadow-[0_0_6px_rgba(241,181,106,0.8)]" aria-label={s.attentionLabel} />}
            </div>
          );
        })}
      </div>
      {!compact && (
        <div className="relative mx-3 mt-3 hidden h-4 sm:block">
          {stages.map((s, i) => (
            <span key={s.id} className={`absolute -translate-x-1/2 whitespace-nowrap text-[10px] ${i === current ? "font-semibold text-[#a5f3fc]" : i < current ? "text-ink-soft" : "text-ink-muted/60"}`} style={{ left: `${pct(i)}%` }}>{s.short}</span>
          ))}
        </div>
      )}
    </div>
  );
}
