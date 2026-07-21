import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseWorkbookBuffer, parseContactText } from "@/lib/recruiters/import";

describe("parseContactText (pasted tables)", () => {
  it("parses tab-separated text with Name/Email/Title/Company headers", () => {
    const text = [
      "Name\tEmail\tTitle\tCompany",
      "Akanksha Puri\takanksha.puri@sourcefuse.com\tAssociate Director HR\tSourceFuse Technologies",
      "Akhil Jogiparthi\takhil@ibhubs.co\tVP Talent\tiB Hubs",
    ].join("\n");

    const rows = parseContactText(text);
    expect(rows).toEqual([
      {
        name: "Akanksha Puri",
        email: "akanksha.puri@sourcefuse.com",
        role: "Associate Director HR",
        companyName: "SourceFuse Technologies",
      },
      {
        name: "Akhil Jogiparthi",
        email: "akhil@ibhubs.co",
        role: "VP Talent",
        companyName: "iB Hubs",
      },
    ]);
  });

  it("parses lowercase headers without a title column (Airtel-style paste)", () => {
    const text = [
      "name\temail\tcompany",
      "Anjali Singh\tanjali.singh@in.airtel.com\tAirtel",
      "Nishant Agarwal\tnishant.agarwal@airtel.com\tAirtel",
    ].join("\n");

    const rows = parseContactText(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      name: "Anjali Singh",
      email: "anjali.singh@in.airtel.com",
      role: undefined,
      companyName: "Airtel",
    });
  });

  it("falls back to comma separation", () => {
    const text = "name,email,company\nJane Doe,jane@acme.com,Acme";
    expect(parseContactText(text)).toEqual([
      { name: "Jane Doe", email: "jane@acme.com", role: undefined, companyName: "Acme" },
    ]);
  });

  it("drops rows with missing or invalid emails, dedupes by email", () => {
    const text = [
      "name\temail\tcompany",
      "No Email\t\tAcme",
      "Bad Email\tnot-an-email\tAcme",
      "Jane Doe\tjane@acme.com\tAcme",
      "Jane Duplicate\tjane@acme.com\tAcme",
    ].join("\n");
    const rows = parseContactText(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Jane Doe");
  });

  it("returns empty for a header-only or empty paste", () => {
    expect(parseContactText("name\temail")).toEqual([]);
    expect(parseContactText("")).toEqual([]);
  });
});

describe("parseWorkbookBuffer (.xlsx/.csv upload)", () => {
  it("parses an in-memory workbook built the same way a real export would be", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["SNo", "Name", "Email", "Title", "Company"],
      [1, "Akanksha Puri", "akanksha.puri@sourcefuse.com", "Associate Director HR", "SourceFuse Technologies"],
      [2, "Akhila Chandan", "akhila@estuate.com", "AVP HR", "Estuate"],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    const rows = parseWorkbookBuffer(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      name: "Akanksha Puri",
      email: "akanksha.puri@sourcefuse.com",
      role: "Associate Director HR",
      companyName: "SourceFuse Technologies",
    });
  });

  it("throws a clear error when Name/Email columns are missing", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Foo", "Bar"],
      ["x", "y"],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    expect(() => parseWorkbookBuffer(buffer)).toThrow(/Name.*Email/);
  });
});
