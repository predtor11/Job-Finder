import { subDays, startOfDay } from "date-fns";
import { prisma } from "@/lib/prisma";

/**
 * Analytics Engine — live dashboard aggregates, nightly snapshots, insights.
 */

export interface DashboardStats {
  jobsFound: number;
  applicationsSent: number;
  replies: number;
  interviews: number;
  assessments: number;
  rejections: number;
  offers: number;
  pending: number;
  ghosted: number;
  followUpsDue: number;
  responseRate: number; // 0-100
  avgResponseHours: number | null;
  matchScoreDistribution: Array<{ bucket: string; count: number }>;
}

export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const [jobsFound, statusCounts, followUpsDue, applications] =
    await Promise.all([
      prisma.job.count({ where: { userId } }),
      prisma.application.groupBy({
        by: ["status"],
        where: { userId },
        _count: true,
      }),
      prisma.application.count({
        where: { userId, nextFollowUpDue: { lte: new Date() } },
      }),
      prisma.application.findMany({
        where: { userId },
        select: { matchScore: true, appliedAt: true, status: true, id: true },
      }),
    ]);

  const count = (statuses: string[]) =>
    statusCounts
      .filter((s) => statuses.includes(s.status))
      .reduce((sum, s) => sum + s._count, 0);

  const sent = count([
    "SENT", "REPLIED", "INTERVIEW", "ASSESSMENT", "OFFER", "REJECTED", "GHOSTED",
  ]);
  const replied = count(["REPLIED", "INTERVIEW", "ASSESSMENT", "OFFER", "REJECTED"]);

  // Average time from send → first inbound reply.
  const replyEvents = await prisma.applicationEvent.findMany({
    where: {
      application: { userId },
      type: { in: ["REPLY_RECEIVED", "INTERVIEW", "ASSESSMENT", "OFFER", "REJECTED"] },
    },
    orderBy: { createdAt: "asc" },
    select: { applicationId: true, createdAt: true },
  });
  const firstReplyByApp = new Map<string, Date>();
  for (const event of replyEvents) {
    if (!firstReplyByApp.has(event.applicationId)) {
      firstReplyByApp.set(event.applicationId, event.createdAt);
    }
  }
  const responseTimes: number[] = [];
  for (const app of applications) {
    const reply = firstReplyByApp.get(app.id);
    if (app.appliedAt && reply && reply > app.appliedAt) {
      responseTimes.push((reply.getTime() - app.appliedAt.getTime()) / 3_600_000);
    }
  }

  const buckets = [
    { bucket: "90+", min: 90, max: 101 },
    { bucket: "70–89", min: 70, max: 90 },
    { bucket: "50–69", min: 50, max: 70 },
    { bucket: "<50", min: 0, max: 50 },
  ];

  return {
    jobsFound,
    applicationsSent: sent,
    replies: replied,
    interviews: count(["INTERVIEW"]),
    assessments: count(["ASSESSMENT"]),
    rejections: count(["REJECTED"]),
    offers: count(["OFFER"]),
    pending: count(["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED"]),
    ghosted: count(["GHOSTED"]),
    followUpsDue,
    responseRate: sent > 0 ? Math.round((replied / sent) * 100) : 0,
    avgResponseHours:
      responseTimes.length > 0
        ? Math.round(
            responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
          )
        : null,
    matchScoreDistribution: buckets.map(({ bucket, min, max }) => ({
      bucket,
      count: applications.filter(
        (a) => a.matchScore !== null && a.matchScore >= min && a.matchScore < max
      ).length,
    })),
  };
}

export interface TimeSeriesPoint {
  date: string; // yyyy-MM-dd
  applications: number;
  replies: number;
  jobsFound: number;
}

/** Daily series for charts, spanning the last `days` days. */
export async function getTimeSeries(
  userId: string,
  days = 30
): Promise<TimeSeriesPoint[]> {
  const since = startOfDay(subDays(new Date(), days - 1));

  const [apps, replyEvents, jobs] = await Promise.all([
    prisma.application.findMany({
      where: { userId, appliedAt: { gte: since } },
      select: { appliedAt: true },
    }),
    prisma.applicationEvent.findMany({
      where: {
        application: { userId },
        type: { in: ["REPLY_RECEIVED", "INTERVIEW", "ASSESSMENT", "OFFER"] },
        createdAt: { gte: since },
      },
      select: { createdAt: true },
    }),
    prisma.job.findMany({
      where: { userId, discoveredAt: { gte: since } },
      select: { discoveredAt: true },
    }),
  ]);

  const series = new Map<string, TimeSeriesPoint>();
  for (let i = 0; i < days; i++) {
    const d = subDays(new Date(), days - 1 - i);
    const key = d.toISOString().slice(0, 10);
    series.set(key, { date: key, applications: 0, replies: 0, jobsFound: 0 });
  }
  const bump = (date: Date | null, field: "applications" | "replies" | "jobsFound") => {
    if (!date) return;
    const point = series.get(date.toISOString().slice(0, 10));
    if (point) point[field]++;
  };
  apps.forEach((a) => bump(a.appliedAt, "applications"));
  replyEvents.forEach((e) => bump(e.createdAt, "replies"));
  jobs.forEach((j) => bump(j.discoveredAt, "jobsFound"));

  return [...series.values()];
}

/** Per-company response stats for the "most responsive companies" insight. */
export async function getCompanyStats(userId: string) {
  const applications = await prisma.application.findMany({
    where: { userId, appliedAt: { not: null } },
    include: { company: { select: { name: true } } },
  });

  const byCompany = new Map<string, { sent: number; replied: number }>();
  for (const app of applications) {
    const name = app.company?.name ?? "Unknown";
    const entry = byCompany.get(name) ?? { sent: 0, replied: 0 };
    entry.sent++;
    if (["REPLIED", "INTERVIEW", "ASSESSMENT", "OFFER"].includes(app.status)) {
      entry.replied++;
    }
    byCompany.set(name, entry);
  }

  return [...byCompany.entries()]
    .map(([company, s]) => ({
      company,
      sent: s.sent,
      replied: s.replied,
      rate: s.sent ? Math.round((s.replied / s.sent) * 100) : 0,
    }))
    .sort((a, b) => b.replied - a.replied || b.rate - a.rate)
    .slice(0, 15);
}

/** Resume + template performance for the analytics page. */
export async function getPerformanceStats(userId: string) {
  const [resumes, templates, missingSkills] = await Promise.all([
    prisma.resume.findMany({
      where: { userId },
      include: {
        applications: {
          select: { status: true },
          where: { appliedAt: { not: null } },
        },
      },
    }),
    prisma.emailTemplate.findMany({
      where: { userId },
      include: {
        emails: {
          select: { status: true, applicationId: true, application: { select: { status: true } } },
          where: { status: "SENT" },
        },
      },
    }),
    prisma.jobAnalysis.findMany({
      where: { job: { userId } },
      select: { missingSkills: true },
      take: 300,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const positive = ["REPLIED", "INTERVIEW", "ASSESSMENT", "OFFER"];

  const skillCounts = new Map<string, number>();
  for (const analysis of missingSkills) {
    for (const skill of analysis.missingSkills) {
      const key = skill.toLowerCase();
      skillCounts.set(key, (skillCounts.get(key) ?? 0) + 1);
    }
  }

  return {
    resumePerformance: resumes.map((r) => ({
      label: r.label,
      sent: r.applications.length,
      replies: r.applications.filter((a) => positive.includes(a.status)).length,
    })),
    templatePerformance: templates.map((t) => ({
      name: t.name,
      type: t.type,
      abGroup: t.abGroup,
      sent: t.emails.length,
      replies: t.emails.filter((e) =>
        positive.includes(e.application?.status ?? "")
      ).length,
    })),
    topMissingSkills: [...skillCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([skill, count]) => ({ skill, count })),
  };
}

/** Nightly rollup into AnalyticsSnapshot (idempotent per user/day). */
export async function rollupDailySnapshot(userId: string): Promise<void> {
  const today = startOfDay(new Date());
  const stats = await getDashboardStats(userId);
  const emailsSentToday = await prisma.email.count({
    where: { userId, status: "SENT", sentAt: { gte: today } },
  });
  const jobsToday = await prisma.job.count({
    where: { userId, discoveredAt: { gte: today } },
  });

  await prisma.analyticsSnapshot.upsert({
    where: { userId_date: { userId, date: today } },
    create: {
      userId,
      date: today,
      jobsFound: jobsToday,
      applicationsSent: stats.applicationsSent,
      replies: stats.replies,
      interviews: stats.interviews,
      assessments: stats.assessments,
      rejections: stats.rejections,
      offers: stats.offers,
      emailsSent: emailsSentToday,
    },
    update: {
      jobsFound: jobsToday,
      applicationsSent: stats.applicationsSent,
      replies: stats.replies,
      interviews: stats.interviews,
      assessments: stats.assessments,
      rejections: stats.rejections,
      offers: stats.offers,
      emailsSent: emailsSentToday,
    },
  });
}
