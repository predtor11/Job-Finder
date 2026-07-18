import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, parseBody } from "@/lib/api";

/** GET /api/templates — email templates with usage counts. */
export const GET = withAuth(async ({ userId }) => {
  const templates = await prisma.emailTemplate.findMany({
    where: { userId },
    include: { _count: { select: { emails: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ templates });
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["APPLICATION", "COLD_OUTREACH", "FOLLOW_UP"]),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(10_000),
  abGroup: z.string().max(50).nullish(),
  active: z.boolean().optional(),
});

/** POST /api/templates */
export const POST = withAuth(async ({ request, userId }) => {
  const body = await parseBody(request, createSchema);
  const template = await prisma.emailTemplate.create({
    data: { userId, ...body },
  });
  return NextResponse.json({ template }, { status: 201 });
});
