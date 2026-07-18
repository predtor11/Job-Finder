import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, parseBody } from "@/lib/api";
import { createColdOutreach } from "@/lib/engine/pipeline";
import type { Prisma } from "@prisma/client";

/** GET /api/emails — approval queue + history. */
export const GET = withAuth(async ({ request, userId }) => {
  const sp = request.nextUrl.searchParams;
  const status = sp.get("status") ?? undefined;
  const type = sp.get("type") ?? undefined;

  const where: Prisma.EmailWhereInput = {
    userId,
    direction: "OUTBOUND",
    ...(status ? { status: status as Prisma.EmailWhereInput["status"] } : {}),
    ...(type ? { type: type as Prisma.EmailWhereInput["type"] } : {}),
  };

  const emails = await prisma.email.findMany({
    where,
    include: {
      application: {
        select: {
          id: true,
          job: { select: { title: true } },
          company: { select: { name: true } },
        },
      },
      recruiter: { select: { name: true, sourceUrl: true, sourceType: true } },
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    take: 300,
  });

  return NextResponse.json({ emails });
});

const outreachSchema = z.object({
  recruiterId: z.string().min(1),
  jobId: z.string().optional(),
  resumeId: z.string().optional(),
});

/** POST /api/emails — draft a cold outreach email (always needs approval). */
export const POST = withAuth(async ({ request, userId }) => {
  const body = await parseBody(request, outreachSchema);
  const result = await createColdOutreach({ userId, ...body });
  return NextResponse.json(result, { status: 201 });
});
