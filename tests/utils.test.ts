import { describe, it, expect } from "vitest";
import { normalizeCompanyName, formatSalary, truncate } from "@/lib/utils";
import { htmlToText } from "@/lib/jobs/types";

describe("normalizeCompanyName", () => {
  it("strips legal suffixes and punctuation", () => {
    expect(normalizeCompanyName("Acme, Inc.")).toBe("acme");
    expect(normalizeCompanyName("Globex LLC")).toBe("globex");
    expect(normalizeCompanyName("Wayne Enterprises Ltd")).toBe(
      "wayne enterprises"
    );
  });
  it("dedupes case/spacing variants to the same key", () => {
    expect(normalizeCompanyName("  STRIPE  ")).toBe(
      normalizeCompanyName("Stripe")
    );
  });
});

describe("formatSalary", () => {
  it("formats ranges", () => {
    expect(formatSalary(120_000, 160_000, "USD")).toBe("$120k – $160k");
  });
  it("formats open-ended minimums", () => {
    expect(formatSalary(90_000, null, "EUR")).toBe("€90k+");
  });
  it("returns null when unknown", () => {
    expect(formatSalary(null, null, null)).toBeNull();
  });
});

describe("htmlToText", () => {
  it("converts breaks and strips tags", () => {
    expect(htmlToText("<p>Hello<br>world</p><li>item</li>")).toContain(
      "Hello\nworld"
    );
    expect(htmlToText("<b>Senior</b> &amp; <i>Staff</i>")).toBe(
      "Senior & Staff"
    );
  });
});

describe("truncate", () => {
  it("keeps short strings and trims long ones", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("a".repeat(20), 10)).toHaveLength(10);
  });
});
