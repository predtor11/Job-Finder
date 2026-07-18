import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateJSON } from "@/lib/ai/gemini";
import { htmlToText } from "@/lib/jobs/types";

/**
 * Recruiter Discovery — PUBLIC sources only.
 *
 * Sources, in order of trust:
 *  1. Contact named in the job posting itself (captured by the job analyzer).
 *  2. The company's own public pages: /careers, /jobs, /about, /team, /contact.
 *
 * Guarantees:
 *  • Every stored contact records sourceUrl + sourceType + confidence.
 *  • An email address is stored ONLY if it literally appears in the fetched
 *    page text (regex-verified) — the model cannot invent addresses.
 *  • Cold outreach to discovered contacts always requires manual approval
 *    (enforced in the email pipeline, regardless of send mode).
 */

const contactsSchema = z.object({
  contacts: z
    .array(
      z.object({
        name: z.string(),
        role: z.string().nullish(),
        email: z.string().nullish(),
        linkedinUrl: z.string().nullish(),
        isHiringRelated: z.boolean(),
        confidence: z.number().min(0).max(1),
      })
    )
    .default([]),
});

const CANDIDATE_PATHS = ["/careers", "/jobs", "/about", "/team", "/contact"];
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export interface DiscoveredContact {
  name: string;
  role: string | null;
  email: string | null;
  linkedinUrl: string | null;
  sourceUrl: string;
  confidence: number;
}

/**
 * Discover public hiring contacts for a job's company.
 * Returns newly stored recruiters (deduped against existing ones).
 */
export async function discoverRecruitersForJob(
  userId: string,
  jobId: string
): Promise<DiscoveredContact[]> {
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: { company: true },
  });

  const baseUrls = collectBaseUrls(
    job.url,
    job.company?.website,
    job.company?.careersUrl
  );
  if (baseUrls.length === 0) return [];

  const discovered: DiscoveredContact[] = [];

  for (const pageUrl of buildCandidateUrls(baseUrls)) {
    if (discovered.length >= 5) break;
    let pageText: string;
    try {
      const res = await fetch(pageUrl, {
        headers: { "user-agent": "job-finder-app/1.0 (personal job search tool)" },
        signal: AbortSignal.timeout(15_000),
        redirect: "follow",
      });
      if (!res.ok) continue;
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) continue;
      pageText = htmlToText(await res.text()).slice(0, 20_000);
    } catch {
      continue;
    }
    if (pageText.length < 300) continue;

    // Only worth an AI call if the page plausibly mentions people/hiring.
    if (!/(recruit|talent|hiring|people|team|hr|careers|contact)/i.test(pageText)) {
      continue;
    }

    let extraction;
    try {
      extraction = await generateJSON(
        `Identify people on this public company page who are recruiters, talent/people team members, or hiring managers.

STRICT RULES:
- Include ONLY people actually named on the page. Never invent names.
- "email": only if that person's email address is literally printed on the page, else null.
- "linkedinUrl": only if a LinkedIn URL for that person appears on the page, else null.
- "isHiringRelated": true only for recruiting/talent/HR/hiring roles (or founders at small startups explicitly handling hiring).
- "confidence": how sure you are this person is involved in hiring (0-1).
- Generic addresses (careers@, jobs@, talent@) may be returned as a contact named "Careers Team".

Return JSON: { "contacts": [{ "name", "role", "email", "linkedinUrl", "isHiringRelated", "confidence" }] }

PAGE (${pageUrl}):
"""
${pageText}
"""`,
        contactsSchema,
        { userId, tier: "fast", temperature: 0 }
      );
    } catch {
      continue;
    }

    // Anti-hallucination guard: emails must literally exist in the page text.
    const pageEmails = new Set(
      (pageText.match(EMAIL_REGEX) ?? []).map((e) => e.toLowerCase())
    );

    for (const contact of extraction.contacts) {
      if (!contact.isHiringRelated) continue;
      const email =
        contact.email && pageEmails.has(contact.email.toLowerCase())
          ? contact.email
          : null;

      discovered.push({
        name: contact.name.slice(0, 120),
        role: contact.role ?? null,
        email,
        linkedinUrl: contact.linkedinUrl ?? null,
        sourceUrl: pageUrl,
        confidence: Math.min(contact.confidence, email ? 1 : 0.7),
      });
    }
  }

  // Persist, deduped by (company, name) or email.
  const stored: DiscoveredContact[] = [];
  for (const contact of discovered) {
    const exists = await prisma.recruiter.findFirst({
      where: {
        userId,
        OR: [
          contact.email ? { email: { equals: contact.email, mode: "insensitive" } } : undefined,
          job.companyId
            ? { companyId: job.companyId, name: { equals: contact.name, mode: "insensitive" } }
            : undefined,
        ].filter(Boolean) as object[],
      },
    });
    if (exists) continue;

    await prisma.recruiter.create({
      data: {
        userId,
        companyId: job.companyId,
        jobId: job.id,
        name: contact.name,
        role: contact.role,
        email: contact.email,
        linkedinUrl: contact.linkedinUrl,
        sourceUrl: contact.sourceUrl,
        sourceType: contact.sourceUrl.includes("/team") || contact.sourceUrl.includes("/about")
          ? "TEAM_PAGE"
          : contact.sourceUrl.includes("/contact")
            ? "COMPANY_CONTACT"
            : "CAREERS_PAGE",
        confidence: contact.confidence,
      },
    });
    stored.push(contact);
  }

  if (stored.length > 0) {
    await prisma.notification.create({
      data: {
        userId,
        type: "RECRUITER_FOUND",
        title: `${stored.length} public hiring ${stored.length === 1 ? "contact" : "contacts"} found`,
        body: `${job.company?.name ?? "Company"} — ${stored.map((c) => c.name).slice(0, 3).join(", ")}`,
        link: `/recruiters`,
      },
    });
  }

  return stored;
}

function collectBaseUrls(...urls: Array<string | null | undefined>): string[] {
  const origins = new Set<string>();
  for (const url of urls) {
    if (!url) continue;
    try {
      const u = new URL(url);
      // Skip job-board hosts — their team pages are not the employer's.
      if (
        /greenhouse\.io|lever\.co|ashbyhq\.com|remoteok\.com|ycombinator\.com|news\.ycombinator/.test(
          u.hostname
        )
      )
        continue;
      origins.add(u.origin);
    } catch {
      /* ignore invalid urls */
    }
  }
  return [...origins];
}

function buildCandidateUrls(origins: string[]): string[] {
  const urls: string[] = [];
  for (const origin of origins.slice(0, 2)) {
    for (const path of CANDIDATE_PATHS) {
      urls.push(`${origin}${path}`);
    }
  }
  return urls;
}
