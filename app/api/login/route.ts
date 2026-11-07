import { NextResponse } from "next/server";

// Demo-only role login. Passcodes are shown on the login form for judges.
const CODES: Record<string, string> = { ahj: "ahj855", facility: "site855", eqore: "eqore855", supplier: "supp855" };

export async function POST(req: Request) {
  const { role, code } = await req.json();
  if (role === "public") {
    const res = NextResponse.json({ ok: true });
    res.cookies.delete("role");
    return res;
  }
  if (!CODES[role] || CODES[role] !== code) return NextResponse.json({ ok: false, error: "Invalid passcode" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set("role", role, { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}
