import { z } from "zod";
import { generateJSON } from "@/lib/ai/gemini";
import { prisma } from "@/lib/prisma";

/**
 * Resume Parser — resume text → structured, searchable profile.
 * Uses the smart model once per resume upload (quality matters more than cost
 * here; a resume is parsed rarely and reused everywhere).
 */

const educationSchema = z.object({
  institution: z.string(),
  degree: z.string().nullish(),
  field: z.string().nullish(),
  start: z.string().nullish(),
  end: z.string().nullish(),
  grade: z.string().nullish(),
});

const experienceSchema = z.object({
  company: z.string(),
  title: z.string(),
  start: z.string().nullish(),
  end: z.string().nullish(),
  location: z.string().nullish(),
  highlights: z.array(z.string()).default([]),
});

const projectSchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  technologies: z.array(z.string()).default([]),
  url: z.string().nullish(),
});

const certificationSchema = z.object({
  name: z.string(),
  issuer: z.string().nullish(),
  year: z.string().nullish(),
});

export const parsedResumeSchema = z.object({
  name: z.string().nullish(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  portfolio: z.string().nullish(),
  github: z.string().nullish(),
  linkedin: z.string().nullish(),
  website: z.string().nullish(),
  summary: z.string().nullish(),
  education: z.array(educationSchema).default([]),
  experience: z.array(experienceSchema).default([]),
  projects: z.array(projectSchema).default([]),
  certifications: z.array(certificationSchema).default([]),
  skills: z.array(z.string()).default([]),
  technologies: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  achievements: z.array(z.string()).default([]),
  preferredRoles: z.array(z.string()).default([]),
  preferredLocations: z.array(z.string()).default([]),
  yearsOfExperience: z.number().nullish(),
});

export type ParsedResume = z.infer<typeof parsedResumeSchema>;

const PROMPT = (resumeText: string) => `You are an expert resume parser. Extract structured data from the resume below.

Rules:
- Extract ONLY information present in the resume. Never invent or embellish.
- "skills": every skill mentioned (technical + soft).
- "technologies": concrete tools/frameworks/languages only (subset of skills).
- "keywords": 10-20 search terms a recruiter would use to find this candidate.
- "achievements": quantified or notable accomplishments, verbatim where possible.
- "preferredRoles": job titles this resume targets (from objective/summary/title, or infer 2-4 from experience).
- "preferredLocations": only if the resume states location preferences or willingness to relocate/remote.
- "yearsOfExperience": total professional years, computed from the earliest job start (number, may be fractional).
- Dates as written (e.g. "Jan 2022"). Use null for anything absent.

Return JSON with exactly these keys:
{ "name", "email", "phone", "portfolio", "github", "linkedin", "website", "summary",
  "education": [{ "institution", "degree", "field", "start", "end", "grade" }],
  "experience": [{ "company", "title", "start", "end", "location", "highlights": [] }],
  "projects": [{ "name", "description", "technologies": [], "url" }],
  "certifications": [{ "name", "issuer", "year" }],
  "skills": [], "technologies": [], "keywords": [], "achievements": [],
  "preferredRoles": [], "preferredLocations": [], "yearsOfExperience" }

RESUME:
"""
${resumeText.slice(0, 30_000)}
"""`;

/** Parse resume text and persist the structured profile. */
export async function parseAndStoreResume(
  userId: string,
  resumeId: string,
  resumeText: string
): Promise<ParsedResume> {
  const parsed = await generateJSON(PROMPT(resumeText), parsedResumeSchema, {
    userId,
    tier: "smart",
    temperature: 0.1,
  });

  await prisma.resumeProfile.upsert({
    where: { resumeId },
    create: {
      resumeId,
      ...toDbShape(parsed),
    },
    update: toDbShape(parsed),
  });

  await prisma.resume.update({
    where: { id: resumeId },
    data: { parseStatus: "PARSED", parseError: null },
  });

  return parsed;
}

function toDbShape(parsed: ParsedResume) {
  return {
    name: parsed.name ?? null,
    email: parsed.email ?? null,
    phone: parsed.phone ?? null,
    portfolio: parsed.portfolio ?? null,
    github: parsed.github ?? null,
    linkedin: parsed.linkedin ?? null,
    website: parsed.website ?? null,
    summary: parsed.summary ?? null,
    education: parsed.education,
    experience: parsed.experience,
    projects: parsed.projects,
    certifications: parsed.certifications,
    skills: parsed.skills,
    technologies: parsed.technologies,
    keywords: parsed.keywords,
    achievements: parsed.achievements,
    preferredRoles: parsed.preferredRoles,
    preferredLocations: parsed.preferredLocations,
    yearsOfExperience: parsed.yearsOfExperience ?? null,
  };
}

/**
 * Compact profile summary passed to downstream AI modules — keeps prompts
 * small (free-tier friendly) while carrying everything generation needs.
 */
export function profileToPromptContext(profile: {
  name?: string | null;
  summary?: string | null;
  skills: string[];
  technologies: string[];
  achievements: string[];
  experience?: unknown;
  projects?: unknown;
  yearsOfExperience?: number | null;
}): string {
  const experience = Array.isArray(profile.experience)
    ? (profile.experience as Array<Record<string, unknown>>)
        .slice(0, 5)
        .map(
          (e) =>
            `- ${e.title} @ ${e.company} (${e.start ?? "?"}–${e.end ?? "present"}): ${(Array.isArray(e.highlights) ? e.highlights.slice(0, 3).join("; ") : "")}`
        )
        .join("\n")
    : "";
  const projects = Array.isArray(profile.projects)
    ? (profile.projects as Array<Record<string, unknown>>)
        .slice(0, 4)
        .map(
          (p) =>
            `- ${p.name}: ${p.description ?? ""} [${Array.isArray(p.technologies) ? p.technologies.join(", ") : ""}]`
        )
        .join("\n")
    : "";

  return [
    profile.name ? `Candidate: ${profile.name}` : null,
    profile.yearsOfExperience
      ? `Experience: ~${profile.yearsOfExperience} years`
      : null,
    profile.summary ? `Summary: ${profile.summary}` : null,
    `Skills: ${profile.skills.slice(0, 30).join(", ")}`,
    `Technologies: ${profile.technologies.slice(0, 25).join(", ")}`,
    experience ? `Recent experience:\n${experience}` : null,
    projects ? `Projects:\n${projects}` : null,
    profile.achievements.length
      ? `Achievements:\n${profile.achievements.slice(0, 6).map((a) => `- ${a}`).join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}
