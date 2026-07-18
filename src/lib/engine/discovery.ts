import { prisma } from "@/lib/prisma";
import { remoteokAdapter } from "@/lib/jobs/sources/remoteok";
import { hnWhoIsHiringAdapter } from "@/lib/jobs/sources/hn-whoishiring";
import { greenhouseAdapter } from "@/lib/jobs/sources/greenhouse";
import { leverAdapter } from "@/lib/jobs/sources/lever";
import { ashbyAdapter } from "@/lib/jobs/sources/ashby";
import { careerPageAdapter } from "@/lib/jobs/sources/career-page";
import {
  DEFAULT_JOB_SOURCES,
  type JobSourceConfig,
  type NormalizedJob,
} from "@/lib/jobs/types";
import { normalizeCompanyName, sha256 } from "@/lib/utils";
import type { Job, Prisma } from "@prisma/client";

/**
 * Job Discovery Engine — runs every few hours per user (cron/queue).
 *  1. Fan out to enabled source adapters (independent failures tolerated).
 *  2. Dedupe by fingerprint: sha256(url) or sha256(company|title|location).
 *  3. Upsert Company + Job rows.
 *  4. Evaluate saved searches → notify on new matches.
 */

const ADAPTERS = [
  remoteokAdapter,
  hnWhoIsHiringAdapter,
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  careerPageAdapter,
];

export interface DiscoveryResult {
  fetched: number;
  inserted: number;
  duplicates: number;
  errors: string[];
}

export async function runDiscovery(userId: string): Promise<DiscoveryResult> {
  const settings = await prisma.setting.findUnique({ where: { userId } });
  const config: JobSourceConfig = {
    ...DEFAULT_JOB_SOURCES,
    ...((settings?.jobSources as JobSourceConfig | null) ?? {}),
  };

  const result: DiscoveryResult = {
    fetched: 0,
    inserted: 0,
    duplicates: 0,
    errors: [],
  };

  const settled = await Promise.allSettled(
    ADAPTERS.map((a) => a.fetchJobs(config, userId))
  );

  const normalized: NormalizedJob[] = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") {
      normalized.push(...outcome.value);
    } else {
      result.errors.push(`${ADAPTERS[i].name}: ${outcome.reason}`);
    }
  });
  result.fetched = normalized.length;

  const newJobs: Job[] = [];
  for (const job of normalized) {
    try {
      const inserted = await upsertJob(userId, job);
      if (inserted) {
        newJobs.push(inserted);
        result.inserted++;
      } else {
        result.duplicates++;
      }
    } catch (error) {
      result.errors.push(`persist "${job.title}": ${error}`);
    }
  }

  if (newJobs.length > 0) {
    await evaluateSavedSearches(userId, newJobs);
  }

  await prisma.activityLog.create({
    data: {
      userId,
      level: result.errors.length ? "WARN" : "INFO",
      event: "discovery.run",
      message: `Discovery: ${result.inserted} new, ${result.duplicates} duplicate, ${result.errors.length} errors`,
      metadata: result as unknown as Prisma.InputJsonValue,
    },
  });

  return result;
}

/** Insert if unseen; returns the Job when newly created, null when duplicate. */
async function upsertJob(
  userId: string,
  job: NormalizedJob
): Promise<Job | null> {
  const fingerprint = await sha256(
    job.url ??
      `${normalizeCompanyName(job.companyName ?? "")}|${job.title.toLowerCase()}|${(job.location ?? "").toLowerCase()}`
  );

  const existing = await prisma.job.findUnique({
    where: { userId_fingerprint: { userId, fingerprint } },
    select: { id: true },
  });
  if (existing) return null;

  let companyId: string | undefined;
  if (job.companyName) {
    const normalized = normalizeCompanyName(job.companyName);
    const company = await prisma.company.upsert({
      where: { userId_normalized: { userId, normalized } },
      create: { userId, name: job.companyName, normalized },
      update: {},
    });
    companyId = company.id;
  }

  return prisma.job.create({
    data: {
      userId,
      companyId,
      source: job.source,
      sourceId: job.sourceId,
      fingerprint,
      url: job.url,
      title: job.title.slice(0, 200),
      description: job.description,
      location: job.location,
      remote: job.remote ?? false,
      employmentType: job.employmentType,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      salaryCurrency: job.salaryCurrency,
      techStack: job.techStack ?? [],
      postedAt: job.postedAt,
      raw: (job.raw ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

export interface SearchFilters {
  title?: string;
  location?: string;
  remote?: boolean;
  salaryMin?: number;
  experience?: string;
  company?: string;
  techStack?: string[];
  sources?: string[];
}

/** Does a job match a saved search's filters? (all provided filters must hit) */
export function jobMatchesFilters(
  job: Pick<
    Job,
    | "title"
    | "location"
    | "remote"
    | "salaryMax"
    | "salaryMin"
    | "experienceLevel"
    | "techStack"
    | "source"
    | "description"
  > & { companyName?: string | null },
  filters: SearchFilters
): boolean {
  const contains = (haystack: string | null | undefined, needle: string) =>
    (haystack ?? "").toLowerCase().includes(needle.toLowerCase());

  if (filters.title && !contains(job.title, filters.title)) return false;
  if (filters.location && !contains(job.location, filters.location) && !job.remote)
    return false;
  if (filters.remote === true && !job.remote) return false;
  if (
    filters.salaryMin &&
    (job.salaryMax ?? job.salaryMin ?? 0) < filters.salaryMin
  )
    return false;
  if (filters.experience && !contains(job.experienceLevel, filters.experience))
    return false;
  if (filters.company && !contains(job.companyName, filters.company))
    return false;
  if (filters.sources?.length && !filters.sources.includes(job.source))
    return false;
  if (filters.techStack?.length) {
    const stack = job.techStack.map((t) => t.toLowerCase());
    const description = (job.description ?? "").toLowerCase();
    const hit = filters.techStack.some(
      (t) => stack.includes(t.toLowerCase()) || description.includes(t.toLowerCase())
    );
    if (!hit) return false;
  }
  return true;
}

async function evaluateSavedSearches(userId: string, newJobs: Job[]) {
  const searches = await prisma.jobSearch.findMany({
    where: { userId, notifyOnMatch: true },
  });
  if (searches.length === 0) return;

  const companies = await prisma.company.findMany({
    where: { id: { in: newJobs.map((j) => j.companyId).filter((x): x is string => !!x) } },
    select: { id: true, name: true },
  });
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  for (const search of searches) {
    const filters = search.filters as SearchFilters;
    const matches = newJobs.filter((job) =>
      jobMatchesFilters(
        { ...job, companyName: job.companyId ? companyName.get(job.companyId) : null },
        filters
      )
    );
    if (matches.length > 0) {
      await prisma.notification.create({
        data: {
          userId,
          type: "NEW_JOBS",
          title: `${matches.length} new ${matches.length === 1 ? "job matches" : "jobs match"} "${search.name}"`,
          body: matches
            .slice(0, 3)
            .map((m) => m.title)
            .join(" · "),
          link: `/jobs?search=${search.id}`,
        },
      });
    }
    await prisma.jobSearch.update({
      where: { id: search.id },
      data: { lastRunAt: new Date() },
    });
  }
}
