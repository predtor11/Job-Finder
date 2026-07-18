import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, parseBody } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAndStoreResume } from "@/lib/ai/resume-parser";

type Params = { id: string };

const patchSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  isDefault: z.boolean().optional(),
  reparse: z.boolean().optional(),
});

/** PATCH /api/resumes/:id — rename, set default, or re-parse. */
export const PATCH = withAuth<Params>(async ({ request, userId, params }) => {
  const body = await parseBody(request, patchSchema);
  const resume = await prisma.resume.findFirst({
    where: { id: params.id, userId },
  });
  if (!resume)
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });

  if (body.isDefault) {
    await prisma.resume.updateMany({
      where: { userId },
      data: { isDefault: false },
    });
  }

  await prisma.resume.update({
    where: { id: resume.id },
    data: {
      ...(body.label ? { label: body.label } : {}),
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
    },
  });

  if (body.reparse && resume.rawText) {
    await prisma.resume.update({
      where: { id: resume.id },
      data: { parseStatus: "PARSING", parseError: null },
    });
    try {
      await parseAndStoreResume(userId, resume.id, resume.rawText);
    } catch (error) {
      await prisma.resume.update({
        where: { id: resume.id },
        data: { parseStatus: "FAILED", parseError: String(error).slice(0, 1000) },
      });
    }
  }

  const updated = await prisma.resume.findUnique({
    where: { id: resume.id },
    include: { profile: true },
  });
  return NextResponse.json({ resume: updated });
});

/** GET /api/resumes/:id — includes a short-lived signed download URL. */
export const GET = withAuth<Params>(async ({ userId, params }) => {
  const resume = await prisma.resume.findFirst({
    where: { id: params.id, userId },
    include: { profile: true },
  });
  if (!resume)
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });

  let downloadUrl: string | null = null;
  if (resume.storagePath) {
    const supabase = createAdminClient();
    const { data } = await supabase.storage
      .from("resumes")
      .createSignedUrl(resume.storagePath, 300);
    downloadUrl = data?.signedUrl ?? null;
  }
  return NextResponse.json({ resume, downloadUrl });
});

/** DELETE /api/resumes/:id — removes the file + profile. */
export const DELETE = withAuth<Params>(async ({ userId, params }) => {
  const resume = await prisma.resume.findFirst({
    where: { id: params.id, userId },
  });
  if (!resume)
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });

  if (resume.storagePath) {
    const supabase = createAdminClient();
    await supabase.storage.from("resumes").remove([resume.storagePath]);
  }
  await prisma.resume.delete({ where: { id: resume.id } });
  return NextResponse.json({ ok: true });
});
