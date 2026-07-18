import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, parseBody } from "@/lib/api";
import { createApplication } from "@/lib/engine/pipeline";
import type { Prisma } from "@prisma/client";

/** GET /api/applications — CRM list (optionally filtered by status). */
export const GET = withAuth(async ({ request, userId }) => {
  const sp = request.nextUrl.searchParams;
  const status = sp.get("status") ?? undefined;
  const query = sp.get("q") ?? undefined;

  const where: Prisma.ApplicationWhereInput = {
    userId,
    ...(status ? { status: status as Prisma.ApplicationWhereInput["status"] } : {}),
    ...(query
      ? {
          OR: [
            { job: { title: { contains: query, mode: "insensitive" } } },
            { company: { name: { contains: query, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const applications = await prisma.application.findMany({
    where,
    include: {
      job: { select: { id: true, title: true, url: true, location: true, remote: true } },
      company: { select: { name: true, logoUrl: true } },
      recruiter: { select: { name: true, email: true } },
      resume: { select: { label: true } },
      emails: {
        select: { id: true, status: true, type: true, scheduledAt: true, sentAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });

  return NextResponse.json({ applications });
});

const createSchema = z.object({
  jobId: z.string().min(1),
  resumeId: z.string().optional(),
  recruiterId: z.string().optional(),
  toEmailOverride: z.string().email().optional(),
});

/** POST /api/applications — start the pipeline for a job. */
export const POST = withAuth(async ({ request, userId }) => {
  const body = await parseBody(request, createSchema);
  const result = await createApplication({ userId, ...body });
  return NextResponse.json(result, { status: 201 });
});
