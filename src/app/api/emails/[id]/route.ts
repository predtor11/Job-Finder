import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, parseBody } from "@/lib/api";

type Params = { id: string };

const patchSchema = z.object({
  subject: z.string().min(1).max(300).optional(),
  bodyText: z.string().min(1).max(20_000).optional(),
  toEmail: z.string().email().optional(),
  attachResume: z.boolean().optional(),
});

/** PATCH /api/emails/:id — edit a draft before approval. */
export const PATCH = withAuth<Params>(async ({ request, userId, params }) => {
  const body = await parseBody(request, patchSchema);

  const email = await prisma.email.findFirst({
    where: { id: params.id, userId },
  });
  if (!email)
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  if (!["DRAFT", "PENDING_APPROVAL"].includes(email.status)) {
    return NextResponse.json(
      { error: `Cannot edit an email in ${email.status} state.` },
      { status: 400 }
    );
  }

  const updated = await prisma.email.update({
    where: { id: email.id },
    data: body,
  });
  return NextResponse.json({ email: updated });
});

/** DELETE /api/emails/:id — remove a draft. */
export const DELETE = withAuth<Params>(async ({ userId, params }) => {
  const email = await prisma.email.findFirst({
    where: { id: params.id, userId },
  });
  if (!email)
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  if (["SENT", "SENDING"].includes(email.status)) {
    return NextResponse.json(
      { error: "Sent emails cannot be deleted from history." },
      { status: 400 }
    );
  }
  await prisma.email.delete({ where: { id: email.id } });
  return NextResponse.json({ ok: true });
});
