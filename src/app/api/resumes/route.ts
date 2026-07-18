import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractResumeText } from "@/lib/resumes/extract-text";
import { parseAndStoreResume } from "@/lib/ai/resume-parser";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
]);
const MAX_SIZE = 10 * 1024 * 1024;

/** GET /api/resumes — resume library with parsed profiles. */
export const GET = withAuth(async ({ userId }) => {
  const resumes = await prisma.resume.findMany({
    where: { userId },
    include: { profile: true, _count: { select: { applications: true } } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ resumes });
});

/**
 * POST /api/resumes — multipart upload: file + label.
 * Stores in Supabase Storage, extracts text, then AI-parses the profile.
 */
export const POST = withAuth(async ({ request, userId }) => {
  const formData = await request.formData();
  const file = formData.get("file");
  const label = String(formData.get("label") ?? "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json(
      { error: "Give this resume a label (e.g. 'Backend Engineer')." },
      { status: 400 }
    );
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Upload a PDF, DOCX, or TXT file." },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File exceeds 10 MB." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Extract text first — reject unreadable files before storing anything.
  let rawText: string;
  try {
    rawText = await extractResumeText(buffer, file.type, file.name);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 });
  }
  if (rawText.length < 100) {
    return NextResponse.json(
      { error: "Couldn't read meaningful text from this file (is it a scan?)." },
      { status: 400 }
    );
  }

  const isFirst = (await prisma.resume.count({ where: { userId } })) === 0;
  const resume = await prisma.resume.create({
    data: {
      userId,
      label,
      fileName: file.name,
      storagePath: "", // set after upload (path includes the id)
      mimeType: file.type,
      sizeBytes: file.size,
      rawText,
      isDefault: isFirst,
      parseStatus: "PARSING",
    },
  });

  const storagePath = `${userId}/${resume.id}/${file.name}`;
  const supabase = createAdminClient();
  const { error: uploadError } = await supabase.storage
    .from("resumes")
    .upload(storagePath, buffer, { contentType: file.type, upsert: true });

  if (uploadError) {
    await prisma.resume.delete({ where: { id: resume.id } });
    return NextResponse.json(
      { error: `Storage upload failed: ${uploadError.message}` },
      { status: 500 }
    );
  }

  await prisma.resume.update({
    where: { id: resume.id },
    data: { storagePath },
  });

  // Parse synchronously — the caller shows progress; failure is recoverable.
  try {
    await parseAndStoreResume(userId, resume.id, rawText);
  } catch (error) {
    await prisma.resume.update({
      where: { id: resume.id },
      data: { parseStatus: "FAILED", parseError: String(error).slice(0, 1000) },
    });
  }

  const complete = await prisma.resume.findUnique({
    where: { id: resume.id },
    include: { profile: true },
  });
  return NextResponse.json({ resume: complete }, { status: 201 });
});
