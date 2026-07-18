import type { NormalizedJob, SourceAdapter, JobSourceConfig } from "@/lib/jobs/types";
import { fetchJson, htmlToText } from "@/lib/jobs/types";

/**
 * Lever — official public postings API.
 * https://github.com/lever/postings-api
 */

interface LeverPosting {
  id: string;
  text: string; // title
  hostedUrl: string;
  categories?: {
    location?: string;
    commitment?: string;
    team?: string;
  };
  descriptionPlain?: string;
  createdAt?: number;
  salaryRange?: { min?: number; max?: number; currency?: string };
  workplaceType?: string;
}

export const leverAdapter: SourceAdapter = {
  name: "lever",

  async fetchJobs(config: JobSourceConfig): Promise<NormalizedJob[]> {
    if (!config.lever?.enabled || !config.lever.sites.length) return [];

    const jobs: NormalizedJob[] = [];
    for (const site of config.lever.sites) {
      try {
        const postings = await fetchJson<LeverPosting[]>(
          `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`
        );
        for (const posting of postings) {
          jobs.push({
            source: "LEVER",
            sourceId: posting.id,
            url: posting.hostedUrl,
            title: posting.text,
            companyName: site,
            description: posting.descriptionPlain
              ? posting.descriptionPlain.slice(0, 12_000)
              : undefined,
            location: posting.categories?.location,
            remote:
              posting.workplaceType === "remote" ||
              /remote/i.test(posting.categories?.location ?? ""),
            employmentType: posting.categories?.commitment,
            salaryMin: posting.salaryRange?.min,
            salaryMax: posting.salaryRange?.max,
            salaryCurrency: posting.salaryRange?.currency,
            postedAt: posting.createdAt ? new Date(posting.createdAt) : undefined,
            raw: { site, id: posting.id },
          });
        }
      } catch (error) {
        console.warn(`[lever] site "${site}" failed:`, error);
      }
    }
    return jobs;
  },
};

/** htmlToText re-exported for tests of shared parsing behavior. */
export { htmlToText };
