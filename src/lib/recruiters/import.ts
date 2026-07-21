import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { normalizeCompanyName } from "@/lib/utils";

/**
 * Contact list import — brings a user's own pre-existing HR/recruiter list
 * (spreadsheet export, pasted table) into the Recruiters CRM.
 *
 * This is NOT web discovery: there is no live page to point to, so contacts
 * land with sourceType IMPORTED_LIST and a plain-text sourceUrl instead of a
 * clickable link — the UI must render that honestly, not pretend it's a
 * verified public page. Confidence is medium (0.6) until the user verifies.
 *
 * Safety: importing contacts only populates the CRM. Sending is unaffected —
 * cold outreach still requires per-email approval and bulk-approve still
 * excludes COLD_OUTREACH, so a 2,000-row import can't become a mass blast.
 */

export interface ImportedContactRow {
  name: string;
  email: string;
  role?: string;
  companyName?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 5000;

const HEADER_ALIASES: Record<"name" | "email" | "role" | "company", string[]> = {
  name: ["name", "full name", "contact name", "hr name", "recruiter name"],
  email: ["email", "email id", "e-mail", "email address", "mail"],
  role: ["title", "role", "designation", "position"],
  company: ["company", "organisation", "organization", "company name", "employer"],
};

function matchHeader(headers: string[], field: keyof typeof HEADER_ALIASES): string | null {
  const normalized = headers.map((h) => h.toLowerCase().trim());
  for (const alias of HEADER_ALIASES[field]) {
    const idx = normalized.indexOf(alias);
    if (idx >= 0) return headers[idx];
  }
  return null;
}

/** Core mapper: header row + object rows (keyed by header) → clean contacts. */
function mapRows(rows: Record<string, unknown>[]): ImportedContactRow[] {
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const nameKey = matchHeader(headers, "name");
  const emailKey = matchHeader(headers, "email");
  const roleKey = matchHeader(headers, "role");
  const companyKey = matchHeader(headers, "company");

  if (!nameKey || !emailKey) {
    throw new Error(
      `Couldn't find "Name" and "Email" columns. Columns found: ${headers.join(", ")}`
    );
  }

  const seen = new Set<string>();
  const contacts: ImportedContactRow[] = [];
  for (const row of rows.slice(0, MAX_ROWS)) {
    const name = String(row[nameKey] ?? "").trim();
    const email = String(row[emailKey] ?? "").trim().toLowerCase();
    if (!name || !email || !EMAIL_REGEX.test(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    contacts.push({
      name: name.slice(0, 120),
      email,
      role: roleKey ? String(row[roleKey] ?? "").trim().slice(0, 120) || undefined : undefined,
      companyName: companyKey
        ? String(row[companyKey] ?? "").trim().slice(0, 120) || undefined
        : undefined,
    });
  }
  return contacts;
}

/** Parse an uploaded .xlsx, .xls, or .csv file. */
export function parseWorkbookBuffer(buffer: Buffer): ImportedContactRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets[sheetName],
    { defval: "" }
  );
  return mapRows(rows);
}

/**
 * Parse pasted tabular text — tab-separated (spreadsheet copy-paste),
 * comma-separated, or space-aligned. First line must be the header row.
 */
export function parseContactText(text: string): ImportedContactRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const splitLine = (line: string): string[] => {
    if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
    if (line.includes(",")) return line.split(",").map((c) => c.trim());
    return line.split(/\s{2,}/).map((c) => c.trim());
  };

  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
  return mapRows(rows);
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  totalRows: number;
}

/** Persist parsed contacts: dedupe by email, batch-upsert companies, insert. */
export async function importContacts(
  userId: string,
  rows: ImportedContactRow[]
): Promise<ImportResult> {
  if (rows.length === 0) return { imported: 0, duplicates: 0, totalRows: 0 };

  const existing = await prisma.recruiter.findMany({
    where: { userId, email: { not: null } },
    select: { email: true },
  });
  const existingEmails = new Set(existing.map((r) => r.email!.toLowerCase()));

  const fresh = rows.filter((r) => !existingEmails.has(r.email));
  const duplicates = rows.length - fresh.length;

  const companyNames = new Map<string, string>(); // normalized → display
  for (const r of fresh) {
    if (r.companyName) {
      const normalized = normalizeCompanyName(r.companyName);
      if (normalized && !companyNames.has(normalized)) {
        companyNames.set(normalized, r.companyName);
      }
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

  const CHUNK = 200;
  let imported = 0;
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const chunk = fresh.slice(i, i + CHUNK);
    const created = await prisma.recruiter.createMany({
      data: chunk.map((r) => ({
        userId,
        companyId: r.companyName
          ? companyId.get(normalizeCompanyName(r.companyName))
          : undefined,
        name: r.name,
        role: r.role,
        email: r.email,
        sourceUrl: "Personal contact list (imported by you)",
        sourceType: "IMPORTED_LIST" as const,
        confidence: 0.6,
      })),
    });
    imported += created.count;
  }

  return { imported, duplicates, totalRows: rows.length };
}
