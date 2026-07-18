import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, parseBody } from "@/lib/api";

/** GET /api/recruiters — recruiter CRM list. */
export const GET = withAuth(async ({ request, userId }) => {
  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  const recruiters = await prisma.recruiter.findMany({
    where: {
      userId,
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { company: { name: { contains: query, mode: "insensitive" } } },
              { email: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      company: { select: { name: true, logoUrl: true } },
      job: { select: { id: true, title: true } },
      emails: {
        select: { id: true, status: true, type: true, sentAt: true },
        orderBy: { createdAt: "desc" },
        take: 3,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return NextResponse.json({ recruiters });
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  companyName: z.string().max(120).optional(),
  role: z.string().max(120).optional(),
  email: z.string().email().optional(),
  linkedinUrl: z.string().url().optional(),
  sourceUrl: z.string().url(),
  jobId: z.string().optional(),
});

/** POST /api/recruiters — manually add a public contact (source required). */
export const POST = withAuth(async ({ request, userId }) => {
  const body = await parseBody(request, createSchema);

  let companyId: string | undefined;
  if (body.companyName) {
    const normalized = body.companyName.toLowerCase().trim();
    const company = await prisma.company.upsert({
      where: { userId_normalized: { userId, normalized } },
      create: { userId, name: body.companyName, normalized },
      update: {},
    });
    companyId = company.id;
  }

  const recruiter = await prisma.recruiter.create({
    data: {
      userId,
      companyId,
      jobId: body.jobId,
      name: body.name,
      role: body.role,
      email: body.email,
      linkedinUrl: body.linkedinUrl,
      sourceUrl: body.sourceUrl,
      sourceType: "MANUAL",
      confidence: 1,
      verified: true,
    },
  });
  return NextResponse.json({ recruiter }, { status: 201 });
});
