import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, parseBody } from "@/lib/api";

type Params = { id: string };

/** GET /api/applications/:id — full detail with timeline + thread. */
export const GET = withAuth<Params>(async ({ userId, params }) => {
  const application = await prisma.application.findFirst({
    where: { id: params.id, userId },
    include: {
      job: { include: { analysis: true } },
      company: true,
      recruiter: true,
      resume: { select: { id: true, label: true, fileName: true } },
      coverLetters: { orderBy: { createdAt: "desc" } },
      emails: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "asc" } },
      threads: {
        include: { messages: { orderBy: { receivedAt: "asc" } } },
      },
    },
  });
  if (!application)
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  return NextResponse.json({ application });
});

const patchSchema = z.object({
  status: z
    .enum([
      "DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "SENT", "REPLIED",
      "INTERVIEW", "ASSESSMENT", "OFFER", "REJECTED", "GHOSTED", "WITHDRAWN",
    ])
    .optional(),
  notes: z.string().max(10_000).nullish(),
  resumeId: z.string().optional(),
});

/** PATCH /api/applications/:id — manual status/notes/resume override. */
export const PATCH = withAuth<Params>(async ({ request, userId, params }) => {
  const body = await parseBody(request, patchSchema);

  const existing = await prisma.application.findFirst({
    where: { id: params.id, userId },
  });
  if (!existing)
    return NextResponse.json({ error: "Application not found" }, { status: 404 });

  const application = await prisma.application.update({
    where: { id: existing.id },
    data: {
      ...(body.status ? { status: body.status } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.resumeId ? { resumeId: body.resumeId } : {}),
    },
  });

  if (body.status && body.status !== existing.status) {
    await prisma.applicationEvent.create({
      data: {
        applicationId: application.id,
        type: "STATUS_CHANGE",
        title: `Status changed: ${existing.status} → ${body.status}`,
      },
    });
  }

  return NextResponse.json({ application });
});

/** DELETE /api/applications/:id */
export const DELETE = withAuth<Params>(async ({ userId, params }) => {
  const deleted = await prisma.application.deleteMany({
    where: { id: params.id, userId },
  });
  if (deleted.count === 0)
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
