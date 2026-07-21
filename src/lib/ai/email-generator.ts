import { z } from "zod";
import { generateJSON } from "@/lib/ai/gemini";
import { prisma } from "@/lib/prisma";
import { profileToPromptContext } from "@/lib/ai/resume-parser";
import { sha256 } from "@/lib/utils";
import type { EmailType } from "@prisma/client";

/**
 * Email Generator — application, cold outreach, and follow-up emails.
 *
 * Uniqueness guarantee: subjects + opening sentences of the user's recent
 * outbound emails are included as exclusions, and the rendered body's hash is
 * compared against prior contentHash values; a collision triggers one rewrite.
 *
 * A/B testing: when the user has ≥2 active templates in the same abGroup for
 * the email type, one is picked round-robin and recorded on the email row.
 */

const emailSchema = z.object({
  subject: z.string().min(4),
  body: z.string().min(40),
});

export type GeneratedEmail = z.infer<typeof emailSchema> & {
  abVariant: string | null;
  templateId: string | null;
  contentHash: string;
};

interface GenerateEmailParams {
  userId: string;
  type: EmailType;
  jobId?: string;
  recruiterName?: string | null;
  recruiterRole?: string | null;
  companyName?: string | null;
  resumeId: string;
  /** For follow-ups: the original email's subject + days since sent. */
  followUpContext?: { originalSubject: string; daysSinceSent: number; followUpNumber: number };
  coverLetterExcerpt?: string;
}

export async function generateEmail(
  params: GenerateEmailParams
): Promise<GeneratedEmail> {
  const { userId, type } = params;

  const [resume, recentEmails, settings, template] = await Promise.all([
    prisma.resume.findUniqueOrThrow({
      where: { id: params.resumeId },
      include: { profile: true },
    }),
    prisma.email.findMany({
      where: { userId, direction: "OUTBOUND" },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { subject: true, bodyText: true, contentHash: true },
    }),
    prisma.setting.findUnique({ where: { userId } }),
    pickTemplate(userId, type),
  ]);

  if (!resume.profile) throw new Error("Resume not parsed yet.");

  const job = params.jobId
    ? await prisma.job.findUnique({
        where: { id: params.jobId },
        include: { company: true },
      })
    : null;

  const companyName =
    params.companyName ?? job?.company?.name ?? "the company";
  const roleTitle = job?.title ?? "the role";

  const avoid = recentEmails
    .map((e) => {
      const opening = e.bodyText.split("\n").find((l) => l.trim())?.slice(0, 100);
      return `- subject: "${e.subject}"${opening ? ` / opening: "${opening}"` : ""}`;
    })
    .join("\n");

  const candidateName = resume.profile.name ?? "the candidate";

  const typeInstructions: Record<string, string> = {
    APPLICATION: `A job application email to ${params.recruiterName ?? "the hiring team"} for the ${roleTitle} position at ${companyName}.
- Who the candidate is (1-2 sentences), why this role at this company specifically (2-3 sentences, concrete — product, mission, or tech, not generic praise), 3 relevant qualifications/projects with specifics (not a bare list — weave in real detail and impact), note that resume ${params.coverLetterExcerpt ? "and cover letter are" : "is"} attached, warm professional closing.
- 220–300 words, 3-4 short paragraphs. Substantial enough to be memorable, never padded with filler.`,
    COLD_OUTREACH: `A cold outreach email to ${params.recruiterName ?? "a recruiter"}${params.recruiterRole ? ` (${params.recruiterRole})` : ""} at ${companyName} about the ${roleTitle} opening.
- Open with a specific, genuine reason for interest in ${companyName} — never generic flattery.
- Reference 2-3 pieces of directly relevant experience with concrete detail and real impact, not a bullet dump.
- 170–230 words, 2-3 short paragraphs — still respectful of their time, but substantial enough to make a real case. One clear, low-pressure ask (e.g. "would you be open to considering my application").
- Must NOT sound automated or templated. Warm, direct, specific.`,
    FOLLOW_UP: `A polite follow-up on an application sent ${params.followUpContext?.daysSinceSent ?? "several"} days ago (follow-up #${params.followUpContext?.followUpNumber ?? 1}) for ${roleTitle} at ${companyName}.
- Reference the original email (subject: "${params.followUpContext?.originalSubject ?? ""}").
- Reaffirm interest with ONE new angle or recent accomplishment — do not repeat the original pitch.
- 90–140 words. Gracious, low-pressure, easy to reply to — deliberately the shortest of the three email types.`,
  };

  const templateBlock = template
    ? `\nSTYLE TEMPLATE (match its tone/structure, but write fresh wording; substitute real details for {{placeholders}}):\nSubject: ${template.subject}\n${template.body}\n`
    : "";

  const prompt = `Write ${typeInstructions[type] ?? typeInstructions.APPLICATION}

CANDIDATE (${candidateName}):
${profileToPromptContext(resume.profile)}
${params.coverLetterExcerpt ? `\nCover letter excerpt (do not repeat verbatim): ${params.coverLetterExcerpt.slice(0, 500)}` : ""}
${templateBlock}
Hard rules:
- Address ${params.recruiterName ? `${params.recruiterName} by first name` : "the team as 'Hi,' or 'Hello,'"}.
- Plain text only. No markdown, no placeholders, no invented facts, no emojis.
- Do not mention AI or automation.
- End with the candidate's name only — the signature block is appended separately.
${settings?.emailSignature ? "" : ""}
- Every sentence must be specific to this company/role — nothing copy-paste generic.
${avoid ? `- Do NOT reuse these recent subjects/openings:\n${avoid}` : ""}

Return JSON: { "subject": "...", "body": "..." }`;

  let result = await generateJSON(prompt, emailSchema, {
    userId,
    tier: "smart",
    temperature: 0.9,
    maxOutputTokens: 4096, // headroom for models with non-disableable thinking
  });

  // Uniqueness check — one rewrite on collision with any recent email body.
  let contentHash = await sha256(normalizeForHash(result.body));
  if (recentEmails.some((e) => e.contentHash === contentHash)) {
    result = await generateJSON(
      `${prompt}\n\nYour previous draft duplicated an earlier email. Write it again with substantially different wording and structure.`,
      emailSchema,
      { userId, tier: "smart", temperature: 1.0, maxOutputTokens: 4096 }
    );
    contentHash = await sha256(normalizeForHash(result.body));
  }

  return {
    subject: result.subject.trim(),
    body: result.body.trim(),
    abVariant: template?.abGroup ? template.name : null,
    templateId: template?.id ?? null,
    contentHash,
  };
}

function normalizeForHash(body: string): string {
  return body.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Round-robin among active templates of this type that share an abGroup —
 * the least-recently-used variant wins, giving an even A/B split over time.
 */
async function pickTemplate(userId: string, type: EmailType) {
  const templates = await prisma.emailTemplate.findMany({
    where: { userId, type, active: true },
    include: {
      emails: {
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (templates.length === 0) return null;

  const abTemplates = templates.filter((t) => t.abGroup);
  const pool = abTemplates.length >= 2 ? abTemplates : templates;

  pool.sort((a, b) => {
    const aLast = a.emails[0]?.createdAt.getTime() ?? 0;
    const bLast = b.emails[0]?.createdAt.getTime() ?? 0;
    return aLast - bLast;
  });
  return pool[0];
}

/** Append the user's signature (Settings → Email Signature) to a body. */
export function withSignature(body: string, signature?: string | null): string {
  if (!signature?.trim()) return body;
  return `${body.trimEnd()}\n\n${signature.trim()}`;
}
