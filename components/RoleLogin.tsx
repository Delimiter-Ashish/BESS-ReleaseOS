"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RoleLogin({ current }: { current: string }) {
  const router = useRouter();
  const [role, setRole] = useState("ahj");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");

  if (current !== "public")
    return (
      <button
        className="btn-ghost w-full"
        onClick={async () => {
          await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "public" }) });
          router.refresh();
        }}
      >
        Log out
      </button>
    );

  return (
    <div className="card p-4">
      <div className="mb-2 text-sm font-bold">🔒 Authorized access</div>
      <div className="flex gap-2">
        <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
          <option value="ahj">AHJ / Fire marshal</option>
          <option value="facility">Facility staff</option>
          <option value="eqore">EQORE</option>
          <option value="supplier">Supplier</option>
        </select>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Passcode" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
      <button
        className="btn-primary mt-2 w-full"
        onClick={async () => {
          const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, code }) });
          if (r.ok) { setErr(""); router.refresh(); } else setErr("Invalid passcode");
        }}
      >
        Unlock
      </button>
      <div className="mt-2 text-[11px] text-slate-400">Demo passcodes: ahj855 · site855 · eqore855 · supp855</div>
    </div>
  );
}
