import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCron } from "@/lib/api";
import { syncInbox } from "@/lib/engine/inbox";

export const maxDuration = 300;

/** GET /api/cron/inbox — Vercel Cron (~10 min): sync Gmail replies. */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accounts = await prisma.gmailAccount.findMany({
    where: { status: "CONNECTED" },
    select: { userId: true },
    distinct: ["userId"],
  });

  const results: Record<string, unknown> = {};
  for (const { userId } of accounts) {
    try {
      results[userId] = await syncInbox(userId);
    } catch (error) {
      results[userId] = { error: String(error).slice(0, 300) };
    }
  }

  return NextResponse.json({ ok: true, results });
}
