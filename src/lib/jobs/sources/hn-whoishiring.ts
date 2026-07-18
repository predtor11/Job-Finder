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

      const parsed = parseHnPosting(text);
      if (!parsed) continue; // doesn't follow the posting convention → skip

      jobs.push({
        source: "HN_WHO_IS_HIRING",
        sourceId: String(comment.id),
        url: `https://news.ycombinator.com/item?id=${comment.id}`,
        title: parsed.title,
        companyName: parsed.company,
        description: text.slice(0, 8000),
        location: parsed.location,
        remote: parsed.remote,
        postedAt: comment.created_at ? new Date(comment.created_at) : undefined,
        raw: { threadId: thread.objectID, commentId: comment.id },
      });
    }
    return jobs;
  },
};

const ROLE_REGEX =
  /engineer|developer|programmer|designer|manager|scientist|analyst|founding|architect|devops|sre|frontend|backend|full[- ]?stack|mobile|ios|android|data|ml|ai |security|qa|cto|vp of|head of|director|intern|researcher/i;
const NOISE_REGEX = /^(https?:\/\/|www\.)|^(full|part)[- ]?time$|^(onsite|hybrid|remote)\b.{0,25}$|^location[s]?\b|^\$|^(salary|equity|visa|interview)/i;

/**
 * Parse the "Company | Role | Location | …" first-line convention of
 * HN Who-is-Hiring comments. Returns null for comments that don't follow it —
 * skipping those keeps garbage (walls of prose, bare links) out of the list.
 */
export function parseHnPosting(text: string): {
  company: string;
  title: string;
  location?: string;
  remote: boolean;
} | null {
  const firstLine = (text.split("\n")[0] ?? "").trim();
  const parts = firstLine.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  // Company = first segment, minus decorations like "(yuzu.health, Series A)".
  const company = parts[0].replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
  if (!company || company.length > 60 || /^https?:\/\//i.test(company)) return null;

  const rest = parts.slice(1);

  // Role = first non-noise segment mentioning a role word; fall back to the
  // first non-noise segment of sane length.
  const title =
    rest.find((p) => ROLE_REGEX.test(p) && !NOISE_REGEX.test(p) && p.length <= 120) ??
    rest.find((p) => !NOISE_REGEX.test(p) && p.length >= 6 && p.length <= 90);
  if (!title) return null;

  // Location = a segment that names a place or work mode (and isn't the title).
  const location = rest.find(
    (p) =>
      p !== title &&
      p.length <= 70 &&
      (/^(remote|onsite|hybrid)\b/i.test(p) ||
        /\b(remote|onsite|hybrid)\b/i.test(p) ||
        /^[A-Z][a-zA-Z]+(,\s*[A-Z][a-zA-Z .]+)+$/.test(p))
  );

  return {
    company: company.slice(0, 80),
    title: title.replace(/^location[s]?:\s*/i, "").slice(0, 140),
    location: location?.replace(/^location[s]?:\s*/i, "").slice(0, 100),
    remote: /\bremote\b/i.test(firstLine) || /\bremote\b/i.test(text.slice(0, 300)),
  };
}
