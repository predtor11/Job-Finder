import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { analyzeJob } from "@/lib/ai/job-analyzer";

type Params = { id: string };

/**
 * POST /api/jobs/:id/analyze — enrich structured fields (skills, salary…)
 * from the posting text when missing, then score fit against every resume.
 */
export const POST = withAuth<Params>(async ({ userId, params }) => {
  const analysis = await analyzeJob(userId, params.id);
  if (!analysis) {
    return NextResponse.json(
      { error: "Upload and parse at least one resume to analyze fit." },
      { status: 400 }
    );
  }
  return NextResponse.json({ analysis });
});
