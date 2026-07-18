import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, parseBody } from "@/lib/api";

/** GET /api/searches — saved job searches. */
export const GET = withAuth(async ({ userId }) => {
  const searches = await prisma.jobSearch.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ searches });
});

const filtersSchema = z.object({
  title: z.string().optional(),
  location: z.string().optional(),
  remote: z.boolean().optional(),
  salaryMin: z.number().optional(),
  experience: z.string().optional(),
  company: z.string().optional(),
  techStack: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  filters: filtersSchema,
  notifyOnMatch: z.boolean().optional(),
});

/** POST /api/searches — save a search. */
export const POST = withAuth(async ({ request, userId }) => {
  const body = await parseBody(request, createSchema);
  const search = await prisma.jobSearch.create({
    data: {
      userId,
      name: body.name,
      filters: body.filters,
      notifyOnMatch: body.notifyOnMatch ?? true,
    },
  });
  return NextResponse.json({ search }, { status: 201 });
});
