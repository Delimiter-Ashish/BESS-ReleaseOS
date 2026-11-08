import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return NextResponse.json(sessionFromRequest(req));
}
