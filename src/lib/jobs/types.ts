import type { JobSource } from "@prisma/client";

/** A job normalized from any source, pre-dedupe/pre-persist. */
export interface NormalizedJob {
  source: JobSource;
  sourceId?: string;
  url?: string;
  title: string;
  companyName?: string;
  description?: string;
  location?: string;
  remote?: boolean;
  employmentType?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  techStack?: string[];
  postedAt?: Date;
  raw?: unknown;
}

/** Per-user source configuration stored in Setting.jobSources (JSON). */
export interface JobSourceConfig {
  remoteok?: { enabled: boolean; tags?: string[] };
  hnWhoIsHiring?: { enabled: boolean; keywords?: string[] };
  /** Company board tokens the user follows, e.g. ["stripe", "airbnb"]. */
  greenhouse?: { enabled: boolean; boards: string[] };
  /** Lever site names, e.g. ["netflix"]. */
  lever?: { enabled: boolean; sites: string[] };
  /** Ashby job board names, e.g. ["linear"]. */
  ashby?: { enabled: boolean; boards: string[] };
  /** Career page URLs the user follows — fetched + AI-extracted. */
  careerPages?: { enabled: boolean; urls: string[] };
}

export const DEFAULT_JOB_SOURCES: JobSourceConfig = {
  remoteok: { enabled: true, tags: [] },
  hnWhoIsHiring: { enabled: true, keywords: [] },
  greenhouse: { enabled: false, boards: [] },
  lever: { enabled: false, sites: [] },
  ashby: { enabled: false, boards: [] },
  careerPages: { enabled: false, urls: [] },
};

export interface SourceAdapter {
  name: string;
  fetchJobs(config: JobSourceConfig, userId: string): Promise<NormalizedJob[]>;
}

/** Shared fetch with sane defaults for public APIs. */
export async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      "user-agent": "job-finder-app/1.0 (personal job search tool)",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`${url} responded ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Strip HTML to readable text (descriptions from board APIs are HTML). */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?\s*>/gi, "\n")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    // Numeric entities (&#x2F; &#39; …) — HN comments are full of them.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
