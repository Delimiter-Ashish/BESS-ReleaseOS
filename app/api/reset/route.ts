import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { handle } from "@/lib/http";
import { resetStore } from "@/lib/store";

export const runtime = "nodejs";

/** Reset the in-memory demo store to the seed (EQORE roles only). */
export async function POST(req: Request) {
  return handle(() => {
    requireCap(req, "reset");
    resetStore();
    return NextResponse.json({ ok: true });
  });
}
