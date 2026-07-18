import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, parseBody } from "@/lib/api";

type Params = { id: string };

/** GET /api/jobs/:id — full job detail. */
export const GET = withAuth<Params>(async ({ userId, params }) => {
  const job = await prisma.job.findFirst({
    where: { id: params.id, userId },
    include: {
      company: true,
      analysis: true,
      recruiters: true,
      applications: { select: { id: true, status: true } },
    },
  });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ job });
});

const patchSchema = z.object({
  status: z
    .enum(["NEW", "ANALYZED", "SHORTLISTED", "APPLIED", "ARCHIVED", "DISMISSED"])
    .optional(),
});

/** PATCH /api/jobs/:id — update status (shortlist/dismiss/archive). */
export const PATCH = withAuth<Params>(async ({ request, userId, params }) => {
  const body = await parseBody(request, patchSchema);
  const updated = await prisma.job.updateMany({
    where: { id: params.id, userId },
    data: body,
  });
  if (updated.count === 0)
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});

/** DELETE /api/jobs/:id */
export const DELETE = withAuth<Params>(async ({ userId, params }) => {
  const deleted = await prisma.job.deleteMany({
    where: { id: params.id, userId },
  });
  if (deleted.count === 0)
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
