import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, parseBody } from "@/lib/api";

type Params = { id: string };

const patchSchema = z.object({
  verified: z.boolean().optional(),
  notes: z.string().max(5000).nullish(),
  email: z.string().email().nullish(),
  role: z.string().max(120).nullish(),
});

/** PATCH /api/recruiters/:id — verify / annotate a contact. */
export const PATCH = withAuth<Params>(async ({ request, userId, params }) => {
  const body = await parseBody(request, patchSchema);
  const updated = await prisma.recruiter.updateMany({
    where: { id: params.id, userId },
    data: {
      ...(body.verified !== undefined ? { verified: body.verified } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.role !== undefined ? { role: body.role } : {}),
    },
  });
  if (updated.count === 0)
    return NextResponse.json({ error: "Recruiter not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});

/** DELETE /api/recruiters/:id */
export const DELETE = withAuth<Params>(async ({ userId, params }) => {
  const deleted = await prisma.recruiter.deleteMany({
    where: { id: params.id, userId },
  });
  if (deleted.count === 0)
    return NextResponse.json({ error: "Recruiter not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
