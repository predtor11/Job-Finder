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
import { analyzeJob } from "@/lib/ai/job-analyzer";
import { createApplication } from "@/lib/engine/pipeline";
import { AiBudgetExceededError, AiKeyMissingError } from "@/lib/ai/gemini";
import type { Job, Prisma } from "@prisma/client";

/**
 * Job Discovery Engine — runs every few hours per user (cron/queue) or on
 * demand from the UI.
 *
 *  1. Fan out to enabled source adapters (independent failures tolerated),
 *     reporting per-source progress into a BackgroundJob row the UI polls.
 *  2. Dedupe by fingerprint: sha256(url) or sha256(company|title|location).
 *  3. Batch-persist: one lookup + chunked createMany instead of per-job
 *     round-trips (matters — the DB may be 100ms+ away from the runtime).
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

export interface SourceProgress {
  status: "pending" | "running" | "ok" | "error";
  fetched: number;
  error?: string;
}

export interface DiscoveryProgress {
  stage:
    | "fetching"
    | "saving"
    | "matching"
    | "analyzing"
    | "drafting"
    | "done"
    | "error";
  sources: Record<string, SourceProgress>;
  fetched: number;
  inserted: number;
  duplicates: number;
  /** Dropped by the preference filter (location/role mismatch). */
  skippedIrrelevant: number;
  /** Jobs auto-scored against the resume library this run. */
  analyzed: number;
  /** Applications auto-drafted for strong matches this run. */
  drafted: number;
  errors: string[];
  startedAt: string;
  finishedAt?: string;
}

export interface DiscoveryResult {
  fetched: number;
  inserted: number;
  duplicates: number;
  errors: string[];
}

const CHUNK_SIZE = 100;

/** Max jobs auto-scored per discovery run (2 AI calls each — budget guard). */
const AUTO_ANALYZE_LIMIT = 10;

/** Max applications auto-drafted per run (~3 AI calls each). */
const AUTO_DRAFT_LIMIT = 5;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Words in role preferences that don't identify the role itself. */
const ROLE_STOPWORDS = new Set([
  "senior", "junior", "staff", "principal", "lead", "sr", "jr", "mid",
  "level", "remote", "the", "and", "of", "a",
]);

/** Signals that a remote job is open to the user's region (or the world). */
const OPEN_REGION_REGEX = /\b(worldwide|global|anywhere|apac|asia)\b/i;

/** Phrases that restrict a remote job to somewhere else. */
const REGION_RESTRICTIONS: RegExp[] = [
  /remote\s*\(\s*(us|usa|u\.s|uk|eu|europe|emea|latam|americas?|canada|north america)[^)]*\)/i,
  /\b(us|usa|u\.s\.|uk|eu|europe|latam|canada)[- ](only|based)\b/i,
  /\bonly\s+(in|from|for)?\s*(the\s+)?(us|usa|united states|uk|europe|eu|latam|canada)\b/i,
  /\b(must|need to)\s+(be\s+)?(located|based|reside)\s+in\s+(the\s+)?(us|usa|united states|uk|europe|canada)\b/i,
  /\bremote\s+(in|from)[:\s]+(the\s+)?(us|usa|united states|uk|europe|latam|argentina|brazil|colombia|mexico)\b/i,
  /\bus\s+(time\s?zones?|hours|business hours)\b/i,
  /\b(authorized|eligible)\s+to\s+work\s+in\s+(the\s+)?(us|usa|united states|uk|eu)\b/i,
];

/**
 * Can someone in the user's preferred countries actually take this remote job?
 * Checks the location string + the head of the description for region locks.
 */
function remoteEligible(
  job: NormalizedJob,
  preferredLocations: string[]
): boolean {
  const text = `${job.location ?? ""} ${(job.description ?? "").slice(0, 600)}`.toLowerCase();
  if (preferredLocations.some((l) => text.includes(l))) return true;
  if (OPEN_REGION_REGEX.test(text)) return true;
  return !REGION_RESTRICTIONS.some((r) => r.test(text));
}

/**
 * Build a relevance predicate from the user's preferences.
 *
 *  • Locations ("India", "Bangalore"…): a job passes when it is remote OR its
 *    location matches one of them — i.e. local jobs always, foreign only when
 *    remote. No locations configured → no location filtering.
 *  • Roles/tech: when configured, the title or tech stack must share at least
 *    one significant token with a preferred role, or mention a preferred
 *    technology. Loose on purpose — "Software Engineer" matches any
 *    engineering title. Nothing configured → no role filtering.
 */
export function buildPreferenceFilter(prefs: {
  preferredLocations: string[];
  preferredRoles: string[];
  preferredTech: string[];
}): (job: NormalizedJob) => boolean {
  const locations = prefs.preferredLocations
    .map((l) => l.toLowerCase().trim())
    .filter((l) => l && l !== "remote"); // "remote" is the remote flag, not a place
  const roleTokens = [
    ...new Set(
      prefs.preferredRoles
        .flatMap((r) => r.toLowerCase().split(/[^a-z0-9+#.]+/))
        .filter((t) => t.length > 2 && !ROLE_STOPWORDS.has(t))
    ),
  ];
  const tech = prefs.preferredTech.map((t) => t.toLowerCase().trim()).filter(Boolean);

  return (job: NormalizedJob) => {
    if (locations.length > 0) {
      const location = (job.location ?? "").toLowerCase();
      const inPreferredPlace = locations.some((l) => location.includes(l));
      if (!job.remote && !inPreferredPlace) return false;
      // Remote is only good if it's remote *for you* — "Remote (US only)"
      // or LATAM-locked postings are dropped.
      if (job.remote && !inPreferredPlace && !remoteEligible(job, locations)) {
        return false;
      }
    }

    if (roleTokens.length > 0 || tech.length > 0) {
      const haystack = `${job.title} ${(job.techStack ?? []).join(" ")}`.toLowerCase();
      const roleHit = roleTokens.some((t) => haystack.includes(t));
      const techHit = tech.some((t) => haystack.includes(t));
      if (!roleHit && !techHit) return false;
    }

    return true;
  };
}

export async function runDiscovery(userId: string): Promise<DiscoveryResult> {
  const settings = await prisma.setting.findUnique({ where: { userId } });
  const config: JobSourceConfig = {
    ...DEFAULT_JOB_SOURCES,
    ...((settings?.jobSources as JobSourceConfig | null) ?? {}),
  };

  const progress: DiscoveryProgress = {
    stage: "fetching",
    sources: Object.fromEntries(
      ADAPTERS.map((a) => [a.name, { status: "pending", fetched: 0 }])
    ),
    fetched: 0,
    inserted: 0,
    duplicates: 0,
    skippedIrrelevant: 0,
    analyzed: 0,
    drafted: 0,
    errors: [],
    startedAt: new Date().toISOString(),
  };

  // Progress row the UI polls (GET /api/jobs/discover).
  const run = await prisma.backgroundJob.create({
    data: {
      userId,
      queue: "discovery",
      name: "discovery.run",
      status: "RUNNING",
      startedAt: new Date(),
      payload: progress as unknown as Prisma.InputJsonValue,
    },
  });

  const saveProgress = async () => {
    await prisma.backgroundJob
      .update({
        where: { id: run.id },
        data: { payload: progress as unknown as Prisma.InputJsonValue },
      })
      .catch(() => {}); // progress reporting must never kill the run
  };

  try {
    // ── 1. Fetch from all enabled sources in parallel ──
    const normalized: NormalizedJob[] = [];
    await Promise.all(
      ADAPTERS.map(async (adapter) => {
        progress.sources[adapter.name].status = "running";
        await saveProgress();
        try {
          const jobs = await adapter.fetchJobs(config, userId);
          normalized.push(...jobs);
          progress.sources[adapter.name] = { status: "ok", fetched: jobs.length };
          progress.fetched += jobs.length;
        } catch (error) {
          const message = String(error).slice(0, 300);
          progress.sources[adapter.name] = {
            status: "error",
            fetched: 0,
            error: message,
          };
          progress.errors.push(`${adapter.name}: ${message}`);
        }
        await saveProgress();
      })
    );

    // ── 2. Preference filter ──
    // Keep a job when it's in a preferred location OR remote-and-eligible;
    // and when its title/stack overlaps the user's roles or skills. Skills
    // come from the parsed resumes themselves, not just the settings lists —
    // discovery stays aligned with what the user can actually evidence.
    const resumeProfiles = await prisma.resumeProfile.findMany({
      where: { resume: { userId, parseStatus: "PARSED" } },
      select: { technologies: true },
    });
    const resumeTech = [
      ...new Set(resumeProfiles.flatMap((p) => p.technologies)),
    ].slice(0, 80);

    const prefs = buildPreferenceFilter({
      preferredLocations: settings?.preferredLocations ?? [],
      preferredRoles: settings?.preferredRoles ?? [],
      preferredTech: [
        ...new Set([...(settings?.preferredTech ?? []), ...resumeTech]),
      ],
    });
    const relevant = normalized.filter((job) => prefs(job));
    progress.skippedIrrelevant = normalized.length - relevant.length;

    // ── 3. Fingerprint + in-batch dedupe ──
    progress.stage = "saving";
    await saveProgress();

    const byFingerprint = new Map<string, NormalizedJob>();
    for (const job of relevant) {
      const fingerprint = await sha256(
        job.url ??
          `${normalizeCompanyName(job.companyName ?? "")}|${job.title.toLowerCase()}|${(job.location ?? "").toLowerCase()}`
      );
      if (!byFingerprint.has(fingerprint)) byFingerprint.set(fingerprint, job);
    }
    const fingerprints = [...byFingerprint.keys()];

    // ── 3. One lookup for already-known jobs ──
    const existing = new Set<string>();
    for (const batch of chunk(fingerprints, 500)) {
      const rows = await prisma.job.findMany({
        where: { userId, fingerprint: { in: batch } },
        select: { fingerprint: true },
      });
      rows.forEach((r) => existing.add(r.fingerprint));
    }
    const fresh = fingerprints.filter((f) => !existing.has(f));
    progress.duplicates = relevant.length - fresh.length;

    // ── 4. Batch-upsert companies ──
    const companyNames = new Map<string, string>(); // normalized → display
    for (const f of fresh) {
      const job = byFingerprint.get(f)!;
      if (job.companyName) {
        const norm = normalizeCompanyName(job.companyName);
        if (norm && !companyNames.has(norm)) companyNames.set(norm, job.companyName);
      }
    }
    if (companyNames.size > 0) {
      await prisma.company.createMany({
        data: [...companyNames.entries()].map(([normalized, name]) => ({
          userId,
          name,
          normalized,
        })),
        skipDuplicates: true,
      });
    }
    const companyRows = await prisma.company.findMany({
      where: { userId, normalized: { in: [...companyNames.keys()] } },
      select: { id: true, normalized: true },
    });
    const companyId = new Map(companyRows.map((c) => [c.normalized, c.id]));

    // ── 5. Chunked createMany for new jobs ──
    for (const batch of chunk(fresh, CHUNK_SIZE)) {
      const created = await prisma.job.createMany({
        data: batch.map((fingerprint) => {
          const job = byFingerprint.get(fingerprint)!;
          return {
            userId,
            companyId: job.companyName
              ? companyId.get(normalizeCompanyName(job.companyName))
              : undefined,
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
          };
        }),
        skipDuplicates: true,
      });
      progress.inserted += created.count;
      await saveProgress(); // UI sees the count climb chunk by chunk
    }

    // ── 6. Saved searches → notifications ──
    progress.stage = "matching";
    await saveProgress();

    let createdJobs: Job[] = [];
    if (fresh.length > 0) {
      createdJobs = await prisma.job.findMany({
        where: { userId, fingerprint: { in: fresh } },
      });
      await evaluateSavedSearches(userId, createdJobs);
    }

    // ── 7. Auto-analyze the newest jobs so Match scores appear unprompted ──
    // Capped per run to stay inside the free-tier AI budget; the rest can be
    // analyzed on demand from the job page.
    const parsedResumes = await prisma.resume.count({
      where: { userId, parseStatus: "PARSED" },
    });
    const analyzedJobIds: string[] = [];
    if (parsedResumes > 0 && createdJobs.length > 0) {
      progress.stage = "analyzing";
      await saveProgress();

      const targets = [...createdJobs]
        .sort(
          (a, b) =>
            (b.postedAt?.getTime() ?? b.discoveredAt.getTime()) -
            (a.postedAt?.getTime() ?? a.discoveredAt.getTime())
        )
        .slice(0, AUTO_ANALYZE_LIMIT);

      for (const job of targets) {
        try {
          await analyzeJob(userId, job.id);
          analyzedJobIds.push(job.id);
          progress.analyzed++;
          await saveProgress();
        } catch (error) {
          if (error instanceof AiBudgetExceededError) {
            progress.errors.push("AI budget reached — remaining jobs left unscored.");
            break;
          }
          if (error instanceof AiKeyMissingError) {
            progress.errors.push(
              "No Gemini API key configured — add yours in Settings → AI to enable scoring."
            );
            break;
          }
          // One bad posting must not stop the rest.
        }
      }
    }

    // ── 8. Autopilot: draft applications for the strongest matches ──
    // Cover letter + email (when a public contact exists) land in the
    // approval queue — nothing sends without the user's send rules.
    if ((settings?.autoDraftEnabled ?? true) && analyzedJobIds.length > 0) {
      const threshold = settings?.autoDraftThreshold ?? 70;
      const strong = await prisma.job.findMany({
        where: {
          id: { in: analyzedJobIds },
          userId,
          analysis: { matchScore: { gte: threshold } },
          applications: { none: {} },
        },
        include: { analysis: { select: { matchScore: true } } },
        orderBy: { discoveredAt: "desc" },
        take: AUTO_DRAFT_LIMIT,
      });

      if (strong.length > 0) {
        progress.stage = "drafting";
        await saveProgress();

        for (const job of strong) {
          try {
            await createApplication({ userId, jobId: job.id });
            progress.drafted++;
            await saveProgress();
          } catch (error) {
            if (
              error instanceof AiBudgetExceededError ||
              error instanceof AiKeyMissingError
            ) {
              progress.errors.push("AI limit reached — remaining drafts skipped.");
              break;
            }
          }
        }

        if (progress.drafted > 0) {
          await prisma.notification.create({
            data: {
              userId,
              type: "NEW_JOBS",
              title: `${progress.drafted} application draft${progress.drafted === 1 ? "" : "s"} ready for review`,
              body: "Auto-drafted for your strongest matches — review and approve in one click.",
              link: "/emails?status=PENDING_APPROVAL",
            },
          });
        }
      }
    }

    progress.stage = "done";
    progress.finishedAt = new Date().toISOString();
    await prisma.backgroundJob.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        finishedAt: new Date(),
        payload: progress as unknown as Prisma.InputJsonValue,
      },
    });

    await prisma.activityLog.create({
      data: {
        userId,
        level: progress.errors.length ? "WARN" : "INFO",
        event: "discovery.run",
        message: `Discovery: ${progress.inserted} new, ${progress.duplicates} duplicate, ${progress.errors.length} errors`,
        metadata: progress as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    progress.stage = "error";
    progress.errors.push(String(error).slice(0, 500));
    progress.finishedAt = new Date().toISOString();
    await prisma.backgroundJob.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: String(error).slice(0, 1000),
        payload: progress as unknown as Prisma.InputJsonValue,
      },
    });
    throw error;
  }

  return {
    fetched: progress.fetched,
    inserted: progress.inserted,
    duplicates: progress.duplicates,
    errors: progress.errors,
  };
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
