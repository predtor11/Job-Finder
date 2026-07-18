import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCron } from "@/lib/api";
import { runDiscovery } from "@/lib/engine/discovery";

export const maxDuration = 300;

/** GET /api/cron/discovery — Vercel Cron: job discovery for all users. */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.profile.findMany({ select: { id: true } });
  const results: Record<string, unknown> = {};

  for (const user of users) {
    try {
      results[user.id] = await runDiscovery(user.id);
    } catch (error) {
      results[user.id] = { error: String(error).slice(0, 300) };
    }
  }

  return NextResponse.json({ ok: true, users: users.length, results });
}
