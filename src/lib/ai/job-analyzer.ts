import { z } from "zod";
import { generateJSON } from "@/lib/ai/gemini";
import { prisma } from "@/lib/prisma";
import { profileToPromptContext } from "@/lib/ai/resume-parser";

/**
 * Job Analyzer — two fast-model passes:
 *  1. extractJobFields: raw posting → structured fields (skills, stack, salary,
 *     any hiring contact named IN the posting).
 *  2. analyzeJobFit: job vs the user's resume library → match score per resume,
 *     missing skills, strengths/weaknesses, resume suggestions.
 */

export const jobFieldsSchema = z.object({
  company: z.string().nullish(),
  role: z.string().nullish(),
  location: z.string().nullish(),
  remote: z.boolean().nullish(),
  employmentType: z.string().nullish(),
  experienceLevel: z.string().nullish(),
  salaryMin: z.number().nullish(),
  salaryMax: z.number().nullish(),
  salaryCurrency: z.string().nullish(),
  skills: z.array(z.string()).default([]),
  techStack: z.array(z.string()).default([]),
  requirements: z.array(z.string()).default([]),
  responsibilities: z.array(z.string()).default([]),
  hiringContact: z
    .object({
      name: z.string().nullish(),
      role: z.string().nullish(),
      email: z.string().nullish(),
    })
    .nullish(),
});

export type JobFields = z.infer<typeof jobFieldsSchema>;

const EXTRACT_PROMPT = (text: string) => `Extract structured fields from this job posting. Only use information explicitly present — never guess or invent (especially contact info; include "hiringContact" ONLY if a recruiter/hiring contact is literally named in the posting).

Salary: numbers only, annualized. "techStack" = concrete technologies; "skills" = all required skills.

Return JSON:
{ "company", "role", "location", "remote": bool, "employmentType", "experienceLevel",
  "salaryMin", "salaryMax", "salaryCurrency",
  "skills": [], "techStack": [], "requirements": [], "responsibilities": [],
  "hiringContact": { "name", "role", "email" } | null }

POSTING:
"""
${text.slice(0, 20_000)}
"""`;

export async function extractJobFields(
  userId: string,
  postingText: string
): Promise<JobFields> {
  return generateJSON(EXTRACT_PROMPT(postingText), jobFieldsSchema, {
    userId,
    tier: "fast",
    temperature: 0.1,
  });
}

export const jobFitSchema = z.object({
  resumeScores: z
    .array(
      z.object({
        resumeId: z.string(),
        score: z.number().min(0).max(100),
        reasons: z.string(),
      })
    )
    .default([]),
  missingSkills: z.array(z.string()).default([]),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  resumeSuggestions: z.array(z.string()).default([]),
});

export type JobFit = z.infer<typeof jobFitSchema>;

const FIT_PROMPT = (job: string, resumes: string) => `You are a technical recruiter scoring candidate-job fit.

JOB:
${job}

CANDIDATE RESUMES (multiple versions of the same person):
${resumes}

Score every resume 0-100 for this specific job:
- 90+: near-perfect skill & experience match
- 70-89: strong match, minor gaps
- 50-69: partial match, notable gaps
- <50: weak match
Be calibrated and honest — do not inflate.

Also provide, relative to the BEST resume:
- "missingSkills": required skills the candidate lacks or doesn't evidence
- "strengths": the candidate's strongest selling points for THIS job (specific)
- "weaknesses": honest gaps a recruiter would notice
- "resumeSuggestions": concrete edits that would improve the match (max 5)

Return JSON:
{ "resumeScores": [{ "resumeId", "score", "reasons" }],
  "missingSkills": [], "strengths": [], "weaknesses": [], "resumeSuggestions": [] }`;

/**
 * Analyze fit for a job against all parsed resumes; persists JobAnalysis and
 * returns it. Skips silently if the user has no parsed resumes yet.
 */
export async function analyzeJobFit(userId: string, jobId: string) {
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: { company: true },
  });

  const resumes = await prisma.resume.findMany({
    where: { userId, parseStatus: "PARSED" },
    include: { profile: true },
  });
  const withProfiles = resumes.filter((r) => r.profile);
  if (withProfiles.length === 0) return null;

  const jobContext = [
    `Title: ${job.title}`,
    job.company?.name ? `Company: ${job.company.name}` : null,
    job.location ? `Location: ${job.location}${job.remote ? " (remote)" : ""}` : null,
    job.experienceLevel ? `Level: ${job.experienceLevel}` : null,
    job.skills.length ? `Required skills: ${job.skills.join(", ")}` : null,
    job.techStack.length ? `Tech stack: ${job.techStack.join(", ")}` : null,
    job.requirements.length
      ? `Requirements:\n${job.requirements.slice(0, 12).map((r) => `- ${r}`).join("\n")}`
      : null,
    job.description ? `Description: ${job.description.slice(0, 4000)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const resumeContext = withProfiles
    .map(
      (r) =>
        `[resumeId: ${r.id}] "${r.label}"\n${profileToPromptContext(r.profile!)}`
    )
    .join("\n\n---\n\n");

  const fit = await generateJSON(
    FIT_PROMPT(jobContext, resumeContext),
    jobFitSchema,
    { userId, tier: "fast", temperature: 0.2 }
  );

  // Guard against hallucinated resume ids.
  const validIds = new Set(withProfiles.map((r) => r.id));
  const scores = fit.resumeScores.filter((s) => validIds.has(s.resumeId));
  const best = scores.reduce<(typeof scores)[number] | null>(
    (acc, s) => (acc === null || s.score > acc.score ? s : acc),
    null
  );

  const analysis = await prisma.jobAnalysis.upsert({
    where: { jobId },
    create: {
      jobId,
      matchScore: best?.score ?? 0,
      bestResumeId: best?.resumeId ?? null,
      resumeScores: scores,
      missingSkills: fit.missingSkills,
      strengths: fit.strengths,
      weaknesses: fit.weaknesses,
      resumeSuggestions: fit.resumeSuggestions,
    },
    update: {
      matchScore: best?.score ?? 0,
      bestResumeId: best?.resumeId ?? null,
      resumeScores: scores,
      missingSkills: fit.missingSkills,
      strengths: fit.strengths,
      weaknesses: fit.weaknesses,
      resumeSuggestions: fit.resumeSuggestions,
    },
  });

  await prisma.job.update({
    where: { id: jobId },
    data: { status: job.status === "NEW" ? "ANALYZED" : job.status },
  });

  return analysis;
}
