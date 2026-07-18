import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, parseBody } from "@/lib/api";

type Params = { id: string };

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  subject: z.string().min(1).max(300).optional(),
  body: z.string().min(1).max(10_000).optional(),
  abGroup: z.string().max(50).nullish(),
  active: z.boolean().optional(),
});

export const PATCH = withAuth<Params>(async ({ request, userId, params }) => {
  const body = await parseBody(request, patchSchema);
  const updated = await prisma.emailTemplate.updateMany({
    where: { id: params.id, userId },
    data: body,
  });
  if (updated.count === 0)
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth<Params>(async ({ userId, params }) => {
  const deleted = await prisma.emailTemplate.deleteMany({
    where: { id: params.id, userId },
  });
  if (deleted.count === 0)
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
