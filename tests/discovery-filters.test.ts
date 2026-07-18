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
