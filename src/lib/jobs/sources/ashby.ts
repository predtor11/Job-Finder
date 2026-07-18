import type { NormalizedJob, SourceAdapter, JobSourceConfig } from "@/lib/jobs/types";
import { fetchJson } from "@/lib/jobs/types";

/**
 * Ashby — official public job posting API.
 * https://developers.ashbyhq.com/docs/public-job-posting-api
 */

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: Array<{ location?: string }>;
  department?: string;
  team?: string;
  employmentType?: string;
  isRemote?: boolean;
  descriptionPlain?: string;
  jobUrl?: string;
  applyUrl?: string;
  publishedAt?: string;
  compensation?: {
    compensationTierSummary?: string;
  };
}

export const ashbyAdapter: SourceAdapter = {
  name: "ashby",

  async fetchJobs(config: JobSourceConfig): Promise<NormalizedJob[]> {
    if (!config.ashby?.enabled || !config.ashby.boards.length) return [];

    const jobs: NormalizedJob[] = [];
    for (const board of config.ashby.boards) {
      try {
        const data = await fetchJson<{ jobs: AshbyJob[] }>(
          `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`
        );
        for (const job of data.jobs ?? []) {
          jobs.push({
            source: "ASHBY",
            sourceId: job.id,
            url: job.jobUrl ?? job.applyUrl,
            title: job.title,
            companyName: board,
            description: job.descriptionPlain?.slice(0, 12_000),
            location: job.location,
            remote: job.isRemote ?? /remote/i.test(job.location ?? ""),
            employmentType: job.employmentType,
            postedAt: job.publishedAt ? new Date(job.publishedAt) : undefined,
            raw: { board, id: job.id, compensation: job.compensation },
          });
        }
      } catch (error) {
        console.warn(`[ashby] board "${board}" failed:`, error);
      }
    }
    return jobs;
  },
};
