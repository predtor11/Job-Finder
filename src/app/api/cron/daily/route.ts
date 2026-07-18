import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCron } from "@/lib/api";
import { runFollowUps } from "@/lib/engine/followups";
import { rollupDailySnapshot } from "@/lib/engine/analytics";

export const maxDuration = 300;

/** GET /api/cron/daily — follow-up drafts + analytics rollups for all users. */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.profile.findMany({ select: { id: true } });
  const results: Record<string, unknown> = {};

  for (const user of users) {
    try {
      const followUps = await runFollowUps(user.id);
      await rollupDailySnapshot(user.id);
      results[user.id] = { followUps };
    } catch (error) {
      results[user.id] = { error: String(error).slice(0, 300) };
    }
  }

  return NextResponse.json({ ok: true, users: users.length, results });
}
