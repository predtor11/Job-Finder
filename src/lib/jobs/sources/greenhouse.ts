import type { NormalizedJob, SourceAdapter, JobSourceConfig } from "@/lib/jobs/types";
import { fetchJson, htmlToText } from "@/lib/jobs/types";

/**
 * Greenhouse — official public job board API.
 * https://developers.greenhouse.io/job-board.html
 * One request per company board the user follows.
 */

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  updated_at?: string;
  metadata?: unknown;
}

export const greenhouseAdapter: SourceAdapter = {
  name: "greenhouse",

  async fetchJobs(config: JobSourceConfig): Promise<NormalizedJob[]> {
    if (!config.greenhouse?.enabled || !config.greenhouse.boards.length)
      return [];

    const jobs: NormalizedJob[] = [];
    for (const board of config.greenhouse.boards) {
      try {
        const data = await fetchJson<{ jobs: GreenhouseJob[] }>(
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`
        );
        for (const job of data.jobs) {
          const location = job.location?.name;
          jobs.push({
            source: "GREENHOUSE",
            sourceId: String(job.id),
            url: job.absolute_url,
            title: job.title,
            companyName: board,
            description: job.content ? htmlToText(job.content).slice(0, 12_000) : undefined,
            location,
            remote: /remote/i.test(location ?? ""),
            postedAt: job.updated_at ? new Date(job.updated_at) : undefined,
            raw: { board, id: job.id },
          });
        }
      } catch (error) {
        console.warn(`[greenhouse] board "${board}" failed:`, error);
      }
    }
    return jobs;
  },
};
