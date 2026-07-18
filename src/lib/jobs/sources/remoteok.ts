import type { NormalizedJob, SourceAdapter, JobSourceConfig } from "@/lib/jobs/types";
import { fetchJson, htmlToText } from "@/lib/jobs/types";

/**
 * RemoteOK — public JSON API (https://remoteok.com/api).
 * The API's first element is a legal notice object; jobs follow.
 */

interface RemoteOkItem {
  id?: string;
  slug?: string;
  position?: string;
  company?: string;
  location?: string;
  tags?: string[];
  description?: string;
  url?: string;
  apply_url?: string;
  salary_min?: number;
  salary_max?: number;
  date?: string;
  epoch?: number;
}

export const remoteokAdapter: SourceAdapter = {
  name: "remoteok",

  async fetchJobs(config: JobSourceConfig): Promise<NormalizedJob[]> {
    if (!config.remoteok?.enabled) return [];

    const items = await fetchJson<RemoteOkItem[]>("https://remoteok.com/api");
    const tags = (config.remoteok.tags ?? []).map((t) => t.toLowerCase());

    return items
      .filter((item) => item.position && item.company)
      .filter(
        (item) =>
          tags.length === 0 ||
          item.tags?.some((t) => tags.includes(t.toLowerCase()))
      )
      .map((item) => ({
        source: "REMOTEOK" as const,
        sourceId: String(item.id ?? item.slug),
        url: item.url,
        title: item.position!,
        companyName: item.company,
        description: item.description ? htmlToText(item.description) : undefined,
        location: item.location || "Remote",
        remote: true,
        salaryMin: item.salary_min || undefined,
        salaryMax: item.salary_max || undefined,
        salaryCurrency: item.salary_min ? "USD" : undefined,
        techStack: item.tags ?? [],
        postedAt: item.epoch ? new Date(item.epoch * 1000) : undefined,
        raw: item,
      }));
  },
};
