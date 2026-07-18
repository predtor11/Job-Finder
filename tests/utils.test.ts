import { describe, it, expect } from "vitest";
import {
  normalizeCompanyName, formatSalary, truncate, extractEmails,
} from "@/lib/utils";
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

  it("decodes numeric entities including double-escaped (Algolia HN)", () => {
    expect(htmlToText("https:&#x2F;&#x2F;example.com We&#x27;re hiring")).toBe(
      "https://example.com We're hiring"
    );
    // Double-escaped: &amp;#x2F; → &#x2F; → /
    expect(htmlToText("https:&amp;#x2F;&amp;#x2F;example.com We&amp;#x27;re")).toBe(
      "https://example.com We're"
    );
    // Escaped tags become paragraph breaks, not glued text.
    expect(htmlToText("first.&lt;p&gt;Second sentence")).toBe(
      "first.\nSecond sentence"
    );
  });
});

describe("truncate", () => {
  it("keeps short strings and trims long ones", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("a".repeat(20), 10)).toHaveLength(10);
  });
});

describe("extractEmails (posting contacts)", () => {
  it("finds addresses literally present in the text", () => {
    expect(
      extractEmails("Interested? Email us at jobs@acme.dev or ping Priya (priya.s@acme.dev).")
    ).toEqual(["jobs@acme.dev", "priya.s@acme.dev"]);
  });

  it("filters noise and dedupes", () => {
    expect(
      extractEmails(
        "logo@2x.png noreply@acme.dev jobs@acme.dev again jobs@acme.dev"
      )
    ).toEqual(["jobs@acme.dev"]);
  });

  it("returns empty for text without addresses", () => {
    expect(extractEmails("Apply through our careers portal.")).toEqual([]);
  });
});
