import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/api";
import { analyzeJobFit, extractJobFields } from "@/lib/ai/job-analyzer";

type Params = { id: string };

/**
 * POST /api/jobs/:id/analyze — run field extraction (if description present
 * but fields empty) + resume fit analysis.
 */
export const POST = withAuth<Params>(async ({ userId, params }) => {
  const job = await prisma.job.findFirst({
    where: { id: params.id, userId },
  });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // Enrich structured fields when the source only gave us raw text.
  if (job.description && job.skills.length === 0) {
    const fields = await extractJobFields(userId, job.description);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        skills: fields.skills,
        techStack: job.techStack.length ? job.techStack : fields.techStack,
        requirements: fields.requirements,
        responsibilities: fields.responsibilities,
        experienceLevel: job.experienceLevel ?? fields.experienceLevel,
        employmentType: job.employmentType ?? fields.employmentType,
        salaryMin: job.salaryMin ?? fields.salaryMin ?? undefined,
        salaryMax: job.salaryMax ?? fields.salaryMax ?? undefined,
        salaryCurrency: job.salaryCurrency ?? fields.salaryCurrency ?? undefined,
      },
    });
  }

  const analysis = await analyzeJobFit(userId, job.id);
  if (!analysis) {
    return NextResponse.json(
      { error: "Upload and parse at least one resume to analyze fit." },
      { status: 400 }
    );
  }
  return NextResponse.json({ analysis });
});
