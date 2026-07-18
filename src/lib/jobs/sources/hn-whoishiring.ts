import type { NormalizedJob, SourceAdapter, JobSourceConfig } from "@/lib/jobs/types";
import { fetchJson, htmlToText } from "@/lib/jobs/types";

/**
 * Hacker News "Who is hiring?" — via the public Algolia HN API.
 * Finds the latest monthly thread and parses top-level comments into jobs.
 * Convention: first line is usually "Company | Role | Location | ...".
 */

interface AlgoliaSearchResult {
  hits: Array<{ objectID: string; title?: string; created_at?: string }>;
}

interface AlgoliaItem {
  id: number;
  children?: Array<{
    id: number;
    author?: string | null;
    text?: string | null;
    created_at?: string;
  }>;
}

export const hnWhoIsHiringAdapter: SourceAdapter = {
  name: "hn-whoishiring",

  async fetchJobs(config: JobSourceConfig): Promise<NormalizedJob[]> {
    if (!config.hnWhoIsHiring?.enabled) return [];

    // 1. Locate the newest "Ask HN: Who is hiring?" thread.
    const search = await fetchJson<AlgoliaSearchResult>(
      "https://hn.algolia.com/api/v1/search_by_date?query=%22who%20is%20hiring%22&tags=story,author_whoishiring&hitsPerPage=5"
    );
    const thread = search.hits.find((h) =>
      h.title?.toLowerCase().includes("who is hiring")
    );
    if (!thread) return [];

    // 2. Fetch the thread with top-level comments.
    const item = await fetchJson<AlgoliaItem>(
      `https://hn.algolia.com/api/v1/items/${thread.objectID}`
    );

    const keywords = (config.hnWhoIsHiring.keywords ?? []).map((k) =>
      k.toLowerCase()
    );

    const jobs: NormalizedJob[] = [];
    for (const comment of item.children ?? []) {
      if (!comment.text) continue;
      const text = htmlToText(comment.text);
      if (text.length < 80) continue; // too short to be a real posting

      if (
        keywords.length > 0 &&
        !keywords.some((k) => text.toLowerCase().includes(k))
      ) {
        continue;
      }

      // Parse the "Company | Role | Location" convention from line 1.
      const firstLine = text.split("\n")[0] ?? "";
      const parts = firstLine.split("|").map((p) => p.trim()).filter(Boolean);
      const companyName = parts[0]?.slice(0, 80) || "HN Poster";
      const title =
        parts.find((p) => /engineer|developer|designer|manager|scientist|analyst|founding|lead|architect/i.test(p)) ??
        parts[1] ??
        "See posting";
      const location = parts.find((p) => /remote|onsite|hybrid|[A-Z]{2,}|,/.test(p) && p !== title);

      jobs.push({
        source: "HN_WHO_IS_HIRING",
        sourceId: String(comment.id),
        url: `https://news.ycombinator.com/item?id=${comment.id}`,
        title: title.slice(0, 140),
        companyName,
        description: text.slice(0, 8000),
        location: location?.slice(0, 100),
        remote: /remote/i.test(text.slice(0, 400)),
        postedAt: comment.created_at ? new Date(comment.created_at) : undefined,
        raw: { threadId: thread.objectID, commentId: comment.id },
      });
    }
    return jobs;
  },
};
