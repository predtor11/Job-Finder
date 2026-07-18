import { generateText } from "@/lib/ai/gemini";
import { prisma } from "@/lib/prisma";
import { profileToPromptContext } from "@/lib/ai/resume-parser";

/**
 * Cover Letter Generator — smart model, one unique letter per application.
 * Uniqueness: recent letters' opening lines are passed as "do not reuse"
 * context, and temperature stays high enough for natural variation.
 */

export async function generateCoverLetter(params: {
  userId: string;
  jobId: string;
  resumeId: string;
  applicationId?: string;
}): Promise<{ id: string; content: string }> {
  const { userId, jobId, resumeId, applicationId } = params;

  const [job, resume, recentLetters] = await Promise.all([
    prisma.job.findUniqueOrThrow({
      where: { id: jobId },
      include: { company: true, analysis: true },
    }),
    prisma.resume.findUniqueOrThrow({
      where: { id: resumeId },
      include: { profile: true },
    }),
    prisma.coverLetter.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { content: true },
    }),
  ]);

  if (!resume.profile) {
    throw new Error("Resume has not been parsed yet — upload and parse it first.");
  }

  const companyName = job.company?.name ?? "the company";
  const avoidOpenings = recentLetters
    .map((l) => l.content.split("\n").find((line) => line.trim().length > 0))
    .filter(Boolean)
    .map((line) => `- "${line!.slice(0, 120)}"`)
    .join("\n");

  const prompt = `Write a cover letter for this application.

JOB:
Title: ${job.title}
Company: ${companyName}
${job.location ? `Location: ${job.location}${job.remote ? " (remote)" : ""}` : ""}
${job.skills.length ? `Key skills sought: ${job.skills.slice(0, 15).join(", ")}` : ""}
${job.description ? `Description (excerpt): ${job.description.slice(0, 3000)}` : ""}

CANDIDATE:
${profileToPromptContext(resume.profile)}

${job.analysis?.strengths.length ? `Strongest angles for this job: ${job.analysis.strengths.slice(0, 4).join("; ")}` : ""}

Requirements:
- 220–320 words, 3–4 paragraphs. No address block, no date; start at the salutation.
- Mention ${companyName} and the ${job.title} role specifically — show genuine, concrete interest (product, mission, or tech; infer only from the posting).
- Weave in the 2–3 most relevant skills/projects with specifics, not lists.
- Explain why the candidate is a strong fit AND why they want this role.
- Confident, warm, human tone. No clichés ("I am writing to express…", "passionate", "dynamic"), no fabricated facts, no placeholder brackets.
${avoidOpenings ? `- Do NOT open with any of these previously used openings:\n${avoidOpenings}` : ""}

Return only the letter text.`;

  const content = (
    await generateText(prompt, {
      userId,
      tier: "smart",
      temperature: 0.85,
      maxOutputTokens: 1024,
    })
  ).trim();

  const letter = await prisma.coverLetter.create({
    data: {
      userId,
      jobId,
      resumeId,
      applicationId: applicationId ?? null,
      content,
      model: "smart",
    },
  });

  return { id: letter.id, content };
}
