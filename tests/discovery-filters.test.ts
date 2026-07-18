import { describe, it, expect, beforeAll } from "vitest";

// discovery.ts transitively constructs PrismaClient — give it harmless env.
beforeAll(() => {
  process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/test";
  process.env.DIRECT_URL ??= process.env.DATABASE_URL;
});

const baseJob = {
  title: "Senior Backend Engineer",
  location: "Berlin, Germany",
  remote: false,
  salaryMin: 90_000,
  salaryMax: 120_000,
  experienceLevel: "Senior",
  techStack: ["TypeScript", "PostgreSQL"],
  source: "GREENHOUSE" as const,
  description: "We use Node.js and Kubernetes in production.",
  companyName: "Acme",
};

describe("jobMatchesFilters (saved searches)", () => {
  it("matches on title substring, case-insensitive", async () => {
    const { jobMatchesFilters } = await import("@/lib/engine/discovery");
    expect(jobMatchesFilters(baseJob, { title: "backend" })).toBe(true);
    expect(jobMatchesFilters(baseJob, { title: "designer" })).toBe(false);
  });

  it("respects remote and location filters", async () => {
    const { jobMatchesFilters } = await import("@/lib/engine/discovery");
    expect(jobMatchesFilters(baseJob, { remote: true })).toBe(false);
    expect(jobMatchesFilters(baseJob, { location: "berlin" })).toBe(true);
    expect(
      jobMatchesFilters({ ...baseJob, remote: true }, { location: "tokyo" })
    ).toBe(true); // remote jobs satisfy any location
  });

  it("checks salary floor against the job's best number", async () => {
    const { jobMatchesFilters } = await import("@/lib/engine/discovery");
    expect(jobMatchesFilters(baseJob, { salaryMin: 100_000 })).toBe(true);
    expect(jobMatchesFilters(baseJob, { salaryMin: 150_000 })).toBe(false);
  });

  it("matches tech stack from tags or description", async () => {
    const { jobMatchesFilters } = await import("@/lib/engine/discovery");
    expect(jobMatchesFilters(baseJob, { techStack: ["typescript"] })).toBe(true);
    expect(jobMatchesFilters(baseJob, { techStack: ["kubernetes"] })).toBe(true); // via description
    expect(jobMatchesFilters(baseJob, { techStack: ["rust"] })).toBe(false);
  });

  it("combines filters with AND semantics", async () => {
    const { jobMatchesFilters } = await import("@/lib/engine/discovery");
    expect(
      jobMatchesFilters(baseJob, {
        title: "engineer",
        company: "acme",
        sources: ["GREENHOUSE"],
      })
    ).toBe(true);
    expect(
      jobMatchesFilters(baseJob, { title: "engineer", sources: ["LEVER"] })
    ).toBe(false);
  });
});

describe("buildPreferenceFilter (discovery relevance)", () => {
  const prefs = {
    preferredLocations: ["India"],
    preferredRoles: ["Backend Developer"],
    preferredTech: ["Python", "AWS"],
  };
  const job = (over: Record<string, unknown>) => ({
    source: "REMOTEOK" as const,
    title: "Backend Developer",
    remote: false,
    ...over,
  });

  it("keeps India-located jobs and drops foreign onsite jobs", async () => {
    const { buildPreferenceFilter } = await import("@/lib/engine/discovery");
    const filter = buildPreferenceFilter(prefs);
    expect(filter(job({ location: "Bengaluru, India" }))).toBe(true);
    expect(filter(job({ location: "Berlin, Germany" }))).toBe(false);
  });

  it("drops remote jobs locked to other regions", async () => {
    const { buildPreferenceFilter } = await import("@/lib/engine/discovery");
    const filter = buildPreferenceFilter(prefs);
    expect(filter(job({ remote: true, location: "Remote (US)" }))).toBe(false);
    expect(
      filter(
        job({
          remote: true,
          location: "Remote",
          description: "Remote from: Argentina, Brazil, Colombia, Mexico. LATAM only.",
        })
      )
    ).toBe(false);
    expect(
      filter(job({ remote: true, location: "Remote", description: "US time zones required" }))
    ).toBe(false);
  });

  it("keeps worldwide/India-inclusive remote jobs", async () => {
    const { buildPreferenceFilter } = await import("@/lib/engine/discovery");
    const filter = buildPreferenceFilter(prefs);
    expect(filter(job({ remote: true, location: "Remote (worldwide)" }))).toBe(true);
    expect(
      filter(job({ remote: true, location: "Remote", description: "Open to candidates in India and APAC." }))
    ).toBe(true);
  });

  it("requires role or tech overlap when preferences are set", async () => {
    const { buildPreferenceFilter } = await import("@/lib/engine/discovery");
    const filter = buildPreferenceFilter(prefs);
    expect(filter(job({ location: "Pune, India", title: "Sales Executive" }))).toBe(false);
    expect(
      filter(job({ location: "Pune, India", title: "Platform Engineer", techStack: ["AWS"] }))
    ).toBe(true);
  });
});
