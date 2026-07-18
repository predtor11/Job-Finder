import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/api";
import { runDiscovery } from "@/lib/engine/discovery";

export const maxDuration = 300;

/** POST /api/jobs/discover — run discovery now for the current user. */
export const POST = withAuth(async ({ userId }) => {
  // One run at a time — a RUNNING row younger than 10 min blocks a new run.
  const active = await prisma.backgroundJob.findFirst({
    where: {
      userId,
      queue: "discovery",
      status: "RUNNING",
      createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
    },
  });
  if (active) {
    return NextResponse.json(
      { error: "Discovery is already running — watch its progress above the job list." },
      { status: 409 }
    );
  }

  const result = await runDiscovery(userId);
  return NextResponse.json(result);
});

/**
 * GET /api/jobs/discover — latest discovery run + live progress.
 * The Jobs page polls this while a run is active.
 */
export const GET = withAuth(async ({ userId }) => {
  const run = await prisma.backgroundJob.findFirst({
    where: { userId, queue: "discovery" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      payload: true,
      startedAt: true,
      finishedAt: true,
      error: true,
    },
  });
  return NextResponse.json({ run });
});
