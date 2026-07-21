import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, parseBody } from "@/lib/api";
import { generateEmail } from "@/lib/ai/email-generator";

type Params = { id: string };

const schema = z.object({
  toEmail: z.string().email(),
  toName: z.string().max(120).optional(),
});

/**
 * POST /api/applications/:id/email — generate an application email draft to a
 * recipient the user supplies (e.g. an address they found in the posting or
 * on a public page when automatic discovery came up empty). Lands in the
 * approval queue like every other draft.
 */
export const POST = withAuth<Params>(async ({ request, userId, params }) => {
  const body = await parseBody(request, schema);

  const application = await prisma.application.findFirst({
    where: { id: params.id, userId },
    include: {
      job: true,
      company: true,
      coverLetters: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!application) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }
  if (!application.resumeId) {
    return NextResponse.json(
      { error: "Attach a resume to this application first." },
      { status: 400 }
    );
  }

  const pending = await prisma.email.findFirst({
    where: {
      applicationId: application.id,
      direction: "OUTBOUND",
      status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "QUEUED", "SENDING"] },
    },
  });
  if (pending) {
    return NextResponse.json(
      { error: "This application already has an unsent email draft — edit or cancel it in the Approval Queue." },
      { status: 400 }
    );
  }

  const generated = await generateEmail({
    userId,
    type: "APPLICATION",
    jobId: application.jobId,
    resumeId: application.resumeId,
    recruiterName: body.toName ?? null,
    companyName: application.company?.name,
    coverLetterExcerpt: application.coverLetters[0]?.content,
  });

  const email = await prisma.email.create({
    data: {
      userId,
      applicationId: application.id,
      resumeId: application.resumeId,
      type: "APPLICATION",
      status: "PENDING_APPROVAL",
      toEmail: body.toEmail,
      toName: body.toName,
      subject: generated.subject,
      bodyText: generated.body,
      abVariant: generated.abVariant,
      templateId: generated.templateId,
      contentHash: generated.contentHash,
    },
  });

  await prisma.application.update({
    where: { id: application.id },
    data: { status: "PENDING_APPROVAL" },
  });
  await prisma.applicationEvent.create({
    data: {
      applicationId: application.id,
      type: "DRAFT_CREATED",
      title: `Email drafted to ${body.toEmail}`,
      payload: { emailId: email.id },
    },
  });

  return NextResponse.json({ emailId: email.id }, { status: 201 });
});
