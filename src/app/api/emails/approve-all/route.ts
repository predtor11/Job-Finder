import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/api";
import { approveEmail } from "@/lib/engine/pipeline";

/**
 * POST /api/emails/approve-all — approve every pending APPLICATION and
 * FOLLOW_UP email in one click. Each gets its own naturally-paced send slot.
 * COLD_OUTREACH is deliberately excluded: those are approved one by one.
 */
export const POST = withAuth(async ({ userId }) => {
  const pending = await prisma.email.findMany({
    where: {
      userId,
      status: "PENDING_APPROVAL",
      type: { in: ["APPLICATION", "FOLLOW_UP"] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  let approved = 0;
  const errors: string[] = [];
  for (const email of pending) {
    try {
      await approveEmail(userId, email.id);
      approved++;
    } catch (error) {
      errors.push(String((error as Error).message).slice(0, 200));
    }
  }

  return NextResponse.json({
    approved,
    skippedColdOutreach: await prisma.email.count({
      where: { userId, status: "PENDING_APPROVAL", type: "COLD_OUTREACH" },
    }),
    errors,
  });
});
