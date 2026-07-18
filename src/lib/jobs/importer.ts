import { prisma } from "@/lib/prisma";
import { extractJobFields } from "@/lib/ai/job-analyzer";
import { htmlToText } from "@/lib/jobs/types";
import { normalizeCompanyName, sha256 } from "@/lib/utils";
import type { JobSource } from "@prisma/client";

/**
 * Manual job importer — the ToS-compliant path for LinkedIn, Wellfound, and
 * anywhere else without a public API. The user pastes a URL and/or the posting
 * text; AI normalizes it into a structured Job. No scraping of gated sites.
 */

export async function importJob(params: {
  userId: string;
  url?: string;
  pastedText?: string;
  source?: JobSource;
}): Promise<{ jobId: string }> {
  const { userId, url, pastedText } = params;
  if (!url && !pastedText) {
    throw new Error("Provide a job URL or the pasted job description.");
  }

  let text = pastedText?.trim() ?? "";

  // Try fetching the page for publicly reachable URLs (career sites, boards).
  // Gated pages (LinkedIn auth-walls) will fail gracefully → user pastes text.
  if (!text && url) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; job-finder-app/1.0)" },
        signal: AbortSignal.timeout(20_000),
        redirect: "follow",
      });
      if (res.ok) {
        text = htmlToText(await res.text()).slice(0, 30_000);
      }
    } catch {
      /* fall through to error below */
    }
    if (text.length < 200) {
      throw new Error(
        "Couldn't read that page (it may require login). Paste the job description text instead."
      );
    }
  }

  const source: JobSource =
    params.source ??
    (url?.includes("linkedin.com")
      ? "LINKEDIN_IMPORT"
      : url?.includes("wellfound.com") || url?.includes("angel.co")
        ? "WELLFOUND_IMPORT"
        : "MANUAL");

  const fields = await extractJobFields(userId, text);
  const companyName = fields.company ?? "Unknown Company";
  const normalized = normalizeCompanyName(companyName);

  const company = await prisma.company.upsert({
    where: { userId_normalized: { userId, normalized } },
    create: { userId, name: companyName, normalized },
    update: {},
  });

  const fingerprint = await sha256(
    url ?? `${normalized}|${(fields.role ?? "").toLowerCase()}|${(fields.location ?? "").toLowerCase()}`
  );

  const job = await prisma.job.upsert({
    where: { userId_fingerprint: { userId, fingerprint } },
    create: {
      userId,
      companyId: company.id,
      source,
      fingerprint,
      url,
      title: fields.role ?? "Imported Job",
      description: text.slice(0, 20_000),
      location: fields.location,
      remote: fields.remote ?? false,
      employmentType: fields.employmentType,
      experienceLevel: fields.experienceLevel,
      salaryMin: fields.salaryMin ?? undefined,
      salaryMax: fields.salaryMax ?? undefined,
      salaryCurrency: fields.salaryCurrency ?? undefined,
      skills: fields.skills,
      techStack: fields.techStack,
      requirements: fields.requirements,
      responsibilities: fields.responsibilities,
      status: "NEW",
    },
    update: {}, // already imported — keep existing
  });

  // A contact named in the posting itself is a legitimate public contact.
  if (fields.hiringContact?.name || fields.hiringContact?.email) {
    const existing = await prisma.recruiter.findFirst({
      where: {
        userId,
        jobId: job.id,
        email: fields.hiringContact.email ?? undefined,
      },
    });
    if (!existing) {
      await prisma.recruiter.create({
        data: {
          userId,
          companyId: company.id,
          jobId: job.id,
          name: fields.hiringContact.name ?? "Hiring Contact",
          role: fields.hiringContact.role,
          email: fields.hiringContact.email,
          sourceUrl: url ?? "pasted job description",
          sourceType: "JOB_POSTING",
          confidence: 0.9,
        },
      });
    }
  }

  return { jobId: job.id };
}
