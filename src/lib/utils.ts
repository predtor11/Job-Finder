import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className combiner (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** sha256 hex digest (Node runtime only). */
export async function sha256(input: string): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(input).digest("hex");
}

/** Normalize a company name for dedupe keys. */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/,?\s*(inc|llc|ltd|gmbh|pvt|private|limited|corp|co)\.?$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Human-friendly relative time, e.g. "3d ago". */
export function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** Truncate with ellipsis. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

/** Format a salary range like "$120k – $160k". */
export function formatSalary(
  min?: number | null,
  max?: number | null,
  currency?: string | null
): string | null {
  if (!min && !max) return null;
  const sym = currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
  if (min && max) return `${sym}${fmt(min)} – ${sym}${fmt(max)}`;
  return `${sym}${fmt((min ?? max)!)}${min && !max ? "+" : ""}`;
}
