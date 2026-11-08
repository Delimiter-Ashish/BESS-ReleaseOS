// DEMO AUTHENTICATION — NOT FOR PRODUCTION.
// Users and passcodes are fixed demo identities (shown on the sign-in menu for judges).
// What IS real: identity comes only from an HMAC-signed, httpOnly session cookie set by the
// server. Request bodies can never claim a reviewer name or role. Replace with SSO/OIDC for production.
import { limitMutation } from "./resource-limits";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { Role } from "./requirements";

export interface DemoUser {
  id: string;
  name: string;
  role: Role;
  /** Licensed engineer: may approve/reject revisions, resolve dependency reviews, sign off releases. */
  engineer: boolean;
  passcode: string;
  title: string;
}

export const DEMO_USERS: DemoUser[] = [
  { id: "rpatel", name: "R. Patel, PE", role: "eqore", engineer: true, passcode: "eng855", title: "EQORE engineer of record" },
  { id: "mchen", name: "M. Chen, PE", role: "eqore", engineer: true, passcode: "eng856", title: "EQORE electrical engineer" },
  { id: "kaushik", name: "Kaushik Joshi", role: "eqore", engineer: false, passcode: "pm855", title: "EQORE project manager (demo)" },
  { id: "arivera", name: "A. Rivera", role: "eqore", engineer: false, passcode: "eqore855", title: "EQORE project manager" },
  { id: "supplier", name: "Northbridge supplier portal", role: "supplier", engineer: false, passcode: "supp855", title: "Supplier (fictional)" },
  { id: "ahj", name: "Holliston Fire Marshal", role: "ahj", engineer: false, passcode: "ahj855", title: "AHJ reviewer" },
  { id: "facility", name: "Facility staff", role: "facility", engineer: false, passcode: "site855", title: "Facility" },
];
export const USER_BY_ID = Object.fromEntries(DEMO_USERS.map((u) => [u.id, u])) as Record<string, DemoUser>;

export interface Session {
  userId: string;
  name: string;
  role: Role;
  engineer: boolean;
  roles: string[]; // core-style roles, e.g. ["eqore", "engineer"]
}
export const PUBLIC_SESSION: Session = { userId: "public", name: "Public (not signed in)", role: "public", engineer: false, roles: [] };

export const SESSION_COOKIE = "ros_session";
const g = globalThis as unknown as { __rosSecret?: string };
function secret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) return process.env.SESSION_SECRET;
  // No configured secret: random per-process key. Sessions end on restart (documented).
  if (!g.__rosSecret) g.__rosSecret = randomBytes(32).toString("hex");
  return g.__rosSecret;
}
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function encodeSession(userId: string) {
  const payload = Buffer.from(JSON.stringify({ u: userId, iat: Date.now() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(token: string | undefined): Session {
  if (!token || !token.includes(".")) return PUBLIC_SESSION;
  const [payload, sig] = token.split(".");
  const expected = sign(payload);
  const a = Buffer.from(sig ?? ""), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return PUBLIC_SESSION;
  try {
    const { u, iat } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u: string; iat: number };
    if (typeof iat !== "number" || Date.now() - iat > 12 * 3600_000) return PUBLIC_SESSION; // 12h expiry
    const user = USER_BY_ID[u];
    if (!user) return PUBLIC_SESSION;
    return { userId: user.id, name: user.name, role: user.role, engineer: user.engineer, roles: user.engineer ? [user.role, "engineer"] : [user.role] };
  } catch {
    return PUBLIC_SESSION;
  }
}

/** Server components and route handlers. */
export async function getSession(): Promise<Session> {
  return decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export function sessionFromRequest(req: Request): Session {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return decodeSession(m ? decodeURIComponent(m.slice(SESSION_COOKIE.length + 1)) : undefined);
}

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

export type Capability = "upload" | "review" | "release" | "read_private" | "reset" | "memory";
export function can(s: Session, cap: Capability) {
  switch (cap) {
    case "upload":
      return s.role === "eqore" || s.role === "supplier";
    case "review":
    case "release":
      return s.engineer;
    case "reset":
    case "memory": // import communications, read/confirm/dismiss/resolve project memory (internal EQORE data)
      return s.role === "eqore";
    case "read_private":
      return s.role !== "public";
  }
}

export function requireCap(req: Request, cap: Capability): Session {
  const s = sessionFromRequest(req);
  if (s.role === "public") throw new AuthError(401, "Sign in required");
  if (!can(s, cap)) throw new AuthError(403, cap === "review" || cap === "release" ? `${s.name} is not an authorized engineer for this action` : `${s.name} is not permitted to ${cap}`);
  limitMutation(req, s.userId);
  return s;
}
