import { NextResponse } from "next/server";
import { requireCap } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getMemory } from "@/lib/memory/register";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Project register: all memory items (every status) + communication headers. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle(() => {
    requireCap(req, "memory");
    const { items, communications } = getMemory(params.id);
    const count = (s: string) => items.filter((i) => i.status === s).length;
    return NextResponse.json({
      ok: true, items,
      communications: communications.map(({ body, ...c }) => ({ ...c, bodyChars: body.length })),
      counts: { suggested: count("suggested"), confirmed: count("confirmed"), resolved: count("resolved"), dismissed: count("dismissed"), merged: count("merged") },
    });
  });
}
