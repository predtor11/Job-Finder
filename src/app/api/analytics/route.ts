import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import {
  getDashboardStats,
  getTimeSeries,
  getCompanyStats,
  getPerformanceStats,
} from "@/lib/engine/analytics";
import { getQuotaStatus } from "@/lib/email/scheduler";

/**
 * GET /api/analytics?scope=dashboard|full
 * dashboard: stats + 30d series + quota (fast, dashboard page)
 * full: adds company + resume/template performance (analytics page)
 */
export const GET = withAuth(async ({ request, userId }) => {
  const scope = request.nextUrl.searchParams.get("scope") ?? "dashboard";
  const days = Math.min(180, Math.max(7, Number(request.nextUrl.searchParams.get("days") ?? 30)));

  const [stats, series, quota] = await Promise.all([
    getDashboardStats(userId),
    getTimeSeries(userId, days),
    getQuotaStatus(userId),
  ]);

  if (scope === "full") {
    const [companies, performance] = await Promise.all([
      getCompanyStats(userId),
      getPerformanceStats(userId),
    ]);
    return NextResponse.json({ stats, series, quota, companies, performance });
  }

  return NextResponse.json({ stats, series, quota });
});
