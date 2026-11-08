"use client";
// Energy Ignition — short, skippable brand reveal (SVG + CSS only). Shown only at /intro (never auto-played over the app).
// Sequence: pulse → electrical pathway → battery modules assemble → modules become document layers → evidence lines →
// ReleaseOS mark + tagline. prefers-reduced-motion shows the final frame immediately.
import Link from "next/link";
import { useEffect, useState } from "react";

export default function Ignition() {
  const [skip, setSkip] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDone(true), 4600); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setSkip(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === " ") setSkip(true); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const a = (delay: number, name: string, dur = 0.7) => (skip ? { animation: "none" } : { animation: `${name} ${dur}s cubic-bezier(.2,.8,.2,1) ${delay}s both` });
  return (
    <main className={`ign relative grid min-h-screen place-items-center overflow-hidden bg-[#080E19] text-white ${skip ? "ign-final" : ""}`} onClick={() => setSkip(true)} data-testid="ignition">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_320px_at_50%_42%,rgba(85,221,229,0.10),transparent_70%)]" />
      <svg viewBox="0 0 800 360" className="w-[min(92vw,820px)]" role="img" aria-label="ReleaseOS: energy flows into intelligence">
        {/* 1. pulse */}
        <circle cx="70" cy="180" r="5" fill="#55DDE5" style={{ transformBox: "fill-box", transformOrigin: "center", ...a(0.1, "ign-pulse", 0.9) }} />
        {/* 2. electrical pathway */}
        <path d="M70 180 H190 L215 150 L240 210 L265 180 H330" fill="none" stroke="#55DDE5" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="320" style={{ strokeDashoffset: skip ? 0 : 320, ...(skip ? {} : { animation: "ign-draw 0.9s ease-out 0.5s both" }), filter: "drop-shadow(0 0 4px rgba(85,221,229,.8))" }} />
        {/* 3. battery modules assemble into a BESS unit (then hand over to the document layers) */}
        <g style={skip ? { opacity: 0 } : a(2.15, "ign-fade-out", 0.5)}>
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={340 + (i % 2) * 34} y={146 + Math.floor(i / 2) * 36} width="30" height="32" rx="5" fill="rgba(114,225,187,0.10)" stroke="#72E1BB" strokeWidth="1.3" style={a(1.15 + i * 0.12, `ign-mod${i}`, 0.6)} />
          ))}
          <rect x="334" y="140" width="76" height="80" rx="9" fill="none" stroke="rgba(114,225,187,0.5)" style={a(1.7, "ign-in", 0.4)} />
        </g>
        {/* 4. document layers */}
        <g>
          {[0, 1, 2].map((i) => (
            <g key={i} style={a(2.2 + i * 0.12, "ign-layer", 0.6)}>
              <rect x={346 + i * 14} y={128 + i * 18} width="64" height="82" rx="7" fill="#101B2B" stroke="#9989E6" strokeOpacity={0.55 + i * 0.15} strokeWidth="1.2" />
              <path d={`M${356 + i * 14} ${146 + i * 18} h40 M${356 + i * 14} ${156 + i * 18} h30 M${356 + i * 14} ${166 + i * 18} h36`} stroke="rgba(203,213,225,0.45)" strokeWidth="1.2" />
            </g>
          ))}
          {/* 5. evidence lines */}
          {[[410, 160, 470, 120], [424, 186, 470, 180], [438, 214, 470, 240]].map(([x1, y1, x2, y2], i) => (
            <g key={i} style={a(2.75 + i * 0.1, "ign-in", 0.4)}>
              <path d={`M${x1} ${y1} C${x1 + 30} ${y1} ${x2 - 30} ${y2} ${x2} ${y2}`} fill="none" stroke="#55DDE5" strokeOpacity="0.6" strokeWidth="1" />
              <circle cx={x2} cy={y2} r="3.5" fill="#080E19" stroke="#55DDE5" strokeWidth="1.2" />
            </g>
          ))}
        </g>
        {/* 6. mark + title */}
        <g style={a(3.2, "ign-in", 0.7)}>
          <rect x="500" y="150" width="60" height="60" rx="14" fill="url(#ign-g)" />
          <path d="M534 160 520 184h12l-4 16 16-26h-12l4-14z" fill="#080E19" />
          <text x="574" y="178" fill="#F1F4F9" fontSize="30" fontWeight="600" letterSpacing="-0.5">ReleaseOS</text>
          <text x="575" y="200" fill="#8B98B3" fontSize="11.5" letterSpacing="2">FROM CHAOS TO CLARITY</text>
        </g>
        <defs><linearGradient id="ign-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#67E8F9" /><stop offset="1" stopColor="#2DD4BF" /></linearGradient></defs>
      </svg>
      <div className="absolute bottom-[14vh] left-0 right-0 text-center" style={a(3.6, "ign-in", 0.8)}>
        <div className="text-xl font-medium tracking-tight text-[#F1F4F9] sm:text-2xl">Every battery needs a living record.</div>
        <div className="mt-6 flex justify-center gap-3" onClick={(e) => e.stopPropagation()}>
          <Link href="/" className="rounded-xl bg-gradient-to-b from-[#67e8f9] to-[#2dd4bf] px-5 py-2.5 text-sm font-semibold text-[#080E19]">Enter ReleaseOS</Link>
        </div>
      </div>
      {!skip && !done && <button type="button" onClick={(e) => { e.stopPropagation(); setSkip(true); }} className="absolute right-5 top-5 rounded-lg px-3 py-1.5 text-xs text-[#8B98B3] ring-1 ring-inset ring-[rgba(148,163,184,0.25)] hover:text-white">Skip</button>}
      <p className="absolute bottom-4 text-[10px] text-[#5b6680]">Synthetic demo product · not affiliated with or endorsed by any event or sponsor</p>
    </main>
  );
}
