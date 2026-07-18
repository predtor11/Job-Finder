import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, parseBody } from "@/lib/api";
import { importJob } from "@/lib/jobs/importer";
import type { Prisma } from "@prisma/client";

/** GET /api/jobs — filterable, paginated job list. */
export const GET = withAuth(async ({ request, userId }) => {
  const sp = request.nextUrl.searchParams;
  const query = sp.get("q") ?? undefined;
  const status = sp.get("status") ?? undefined;
  const source = sp.get("source") ?? undefined;
  const remote = sp.get("remote");
  const location = sp.get("location") ?? undefined;
  const company = sp.get("company") ?? undefined;
  const salaryMin = sp.get("salaryMin");
  const tech = sp.get("tech") ?? undefined;
  const minScore = sp.get("minScore");
  const page = Math.max(1, Number(sp.get("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? 25)));

  const where: Prisma.JobWhereInput = {
    userId,
    ...(status ? { status: status as Prisma.JobWhereInput["status"] } : { status: { not: "DISMISSED" } }),
    ...(source ? { source: source as Prisma.JobWhereInput["source"] } : {}),
    ...(remote === "true" ? { remote: true } : {}),
    ...(location
      ? { location: { contains: location, mode: "insensitive" } }
      : {}),
    ...(company
      ? { company: { name: { contains: company, mode: "insensitive" } } }
      : {}),
    ...(salaryMin ? { OR: [{ salaryMax: { gte: Number(salaryMin) } }, { salaryMin: { gte: Number(salaryMin) } }] } : {}),
    ...(tech ? { techStack: { has: tech } } : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
            { company: { name: { contains: query, mode: "insensitive" } } },
          ],
        }
      : {}),
    ...(minScore
      ? { analysis: { matchScore: { gte: Number(minScore) } } }
      : {}),
  };

  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      where,
      include: {
        company: { select: { name: true, logoUrl: true } },
        analysis: {
          select: { matchScore: true, missingSkills: true, bestResumeId: true },
        },
        applications: { select: { id: true, status: true } },
      },
      orderBy: [{ discoveredAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.job.count({ where }),
  ]);

  return NextResponse.json({ jobs, total, page, pageSize });
});

const importSchema = z.object({
  url: z.string().url().optional(),
  pastedText: z.string().min(100).optional(),
});

/** POST /api/jobs — import a job by URL or pasted description. */
export const POST = withAuth(async ({ request, userId }) => {
  const body = await parseBody(request, importSchema);
  const { jobId } = await importJob({ userId, ...body });
  return NextResponse.json({ jobId }, { status: 201 });
});
