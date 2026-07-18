import { z } from "zod";
import type { NormalizedJob, SourceAdapter, JobSourceConfig } from "@/lib/jobs/types";
import { htmlToText } from "@/lib/jobs/types";
import { generateJSON } from "@/lib/ai/gemini";

/**
 * Career pages the user explicitly follows — fetched and AI-extracted.
 * One fast-model call per page per discovery run; capped to protect quota.
 */

const pageJobsSchema = z.object({
  companyName: z.string().nullish(),
  jobs: z
    .array(
      z.object({
        title: z.string(),
        location: z.string().nullish(),
        remote: z.boolean().nullish(),
        url: z.string().nullish(),
        description: z.string().nullish(),
      })
    )
    .default([]),
});

const MAX_PAGES_PER_RUN = 10;

export const careerPageAdapter: SourceAdapter = {
  name: "career-page",

  async fetchJobs(
    config: JobSourceConfig,
    userId: string
  ): Promise<NormalizedJob[]> {
    if (!config.careerPages?.enabled || !config.careerPages.urls.length)
      return [];

    const jobs: NormalizedJob[] = [];
    for (const url of config.careerPages.urls.slice(0, MAX_PAGES_PER_RUN)) {
      try {
        const res = await fetch(url, {
          headers: { "user-agent": "job-finder-app/1.0 (personal job search tool)" },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) continue;
        const text = htmlToText(await res.text()).slice(0, 25_000);
        if (text.length < 200) continue;

        const extracted = await generateJSON(
          `Extract job openings listed on this careers page. Only include real openings actually present. Use absolute URLs when links appear in the text; otherwise null.

Return JSON: { "companyName", "jobs": [{ "title", "location", "remote": bool, "url", "description" }] }

PAGE (${url}):
"""
${text}
"""`,
          pageJobsSchema,
          { userId, tier: "fast", temperature: 0 }
        );

        for (const job of extracted.jobs.slice(0, 50)) {
          jobs.push({
            source: "CAREER_PAGE",
            url: job.url ?? url,
            title: job.title,
            companyName: extracted.companyName ?? new URL(url).hostname.replace(/^www\./, ""),
            description: job.description ?? undefined,
            location: job.location ?? undefined,
            remote: job.remote ?? undefined,
            raw: { pageUrl: url },
          });
        }
      } catch (error) {
        console.warn(`[career-page] ${url} failed:`, error);
      }
    }
    return jobs;
  },
};
