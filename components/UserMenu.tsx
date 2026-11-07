"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface U { id: string; name: string; title: string; engineer: boolean; passcode: string }

/** Demo sign-in (non-production). Passcodes are displayed for judges; the server issues a signed session cookie. */
export default function UserMenu({ current, users }: { current: { userId: string; name: string; engineer: boolean; role: string }; users: U[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function signIn(u: U) {
    setBusy(u.id); setErr("");
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: u.id, passcode: u.passcode }) });
    setBusy("");
    if (!r.ok) return setErr("Sign-in failed");
    setOpen(false);
    router.refresh();
  }
  async function signOut() {
    await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ logout: true }) });
    setOpen(false);
    router.refresh();
  }

  const signedIn = current.userId !== "public";
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition ${signedIn ? "border-slate-300 bg-white hover:bg-slate-50" : "border-indigo-300 bg-indigo-50 text-indigo-800 hover:bg-indigo-100"}`}>
        <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${current.engineer ? "bg-emerald-600 text-white" : signedIn ? "bg-slate-700 text-white" : "bg-indigo-200 text-indigo-800"}`}>
          {signedIn ? current.name.split(/[ ,.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("") : "?"}
        </span>
        <span className="hidden max-w-[160px] truncate sm:inline">{signedIn ? current.name : "Sign in"}</span>
        {current.engineer && <span className="pill bg-emerald-50 text-emerald-700 ring-emerald-200">Engineer</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Demo identities · not production auth</div>
          <ul className="space-y-1">
            {users.map((u) => (
              <li key={u.id}>
                <button disabled={!!busy} onClick={() => signIn(u)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50 ${current.userId === u.id ? "bg-slate-100" : ""}`}>
                  <span>
                    <span className="font-medium">{u.name}</span>
                    <span className="block text-xs text-slate-500">{u.title}</span>
                  </span>
                  <span className="flex flex-col items-end gap-0.5">
                    {u.engineer && <span className="pill bg-emerald-50 text-emerald-700 ring-emerald-200">Engineer</span>}
                    <span className="font-mono text-[10px] text-slate-400">{busy === u.id ? "…" : u.passcode}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {err && <div className="px-2 py-1 text-xs text-red-600">{err}</div>}
          {signedIn && <button onClick={signOut} className="mt-1 w-full rounded-lg px-2 py-2 text-left text-sm text-slate-600 hover:bg-slate-50">Sign out</button>}
          <p className="px-2 pt-2 text-[11px] leading-snug text-slate-400">Identity is held in a server-signed httpOnly cookie; APIs ignore any reviewer name sent by the browser.</p>
        </div>
      )}
    </div>
  );
}
