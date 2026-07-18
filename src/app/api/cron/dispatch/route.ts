import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCron } from "@/lib/api";
import { dispatchDueEmails } from "@/lib/email/scheduler";

export const maxDuration = 300;

/** GET /api/cron/dispatch — Vercel Cron (~5 min): send due emails. */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only users with something due — cheap pre-filter.
  const dueUsers = await prisma.email.groupBy({
    by: ["userId"],
    where: { status: "QUEUED", scheduledAt: { lte: new Date() } },
  });

  const results: Record<string, unknown> = {};
  for (const { userId } of dueUsers) {
    try {
      results[userId] = await dispatchDueEmails(userId);
    } catch (error) {
      results[userId] = { error: String(error).slice(0, 300) };
    }
  }

  return NextResponse.json({ ok: true, results });
}
