import { limitLogin } from "@/lib/resource-limits";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { DEMO_USERS, encodeSession, SESSION_COOKIE } from "@/lib/auth";
import { asString, handle, jsonBody } from "@/lib/http";

export const runtime = "nodejs";

// DEMO-ONLY sign-in (non-production). Accepts { userId, passcode } or Kaushik's original { role, code }.
const LEGACY_ROLE_USER: Record<string, string> = { ahj: "ahj", facility: "facility", eqore: "arivera", supplier: "supplier" };
const eq = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(req: Request) {
  return handle(async () => {
    limitLogin();
    const b = await jsonBody(req, 4096);
    const role = asString(b.role, 20);
    if (role === "public" || b.logout === true) {
      const res = NextResponse.json({ ok: true });
      res.cookies.delete(SESSION_COOKIE);
      res.cookies.delete("role");
      return res;
    }
    const userId = asString(b.userId, 40) ?? (role ? LEGACY_ROLE_USER[role] : undefined);
    const code = asString(b.passcode, 40) ?? asString(b.code, 40) ?? "";
    const user = DEMO_USERS.find((u) => u.id === userId);
    if (!user || !eq(user.passcode, code)) return NextResponse.json({ ok: false, error: "Invalid user or passcode" }, { status: 401 });
    const res = NextResponse.json({ ok: true, user: { id: user.id, name: user.name, role: user.role, engineer: user.engineer } });
    res.cookies.set(SESSION_COOKIE, encodeSession(user.id), { httpOnly: true, sameSite: "lax", path: "/", secure: (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https", maxAge: 12 * 3600 });
    res.cookies.delete("role");
    return res;
  });
}
