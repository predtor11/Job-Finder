"use client";

import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";
import {
  Briefcase, Send, MessageSquare, CalendarClock, Trophy, Clock,
  TrendingUp, AlertCircle, Ghost, FileQuestion,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useApiQuery } from "@/hooks/use-api";
import type { DashboardStats, TimeSeriesPoint } from "@/lib/engine/analytics";

interface AnalyticsPayload {
  stats: DashboardStats;
  series: TimeSeriesPoint[];
  quota: { used: number; limit: number; remaining: number };
}

const seriesConfig = {
  applications: { label: "Applications", color: "var(--chart-1)" },
  replies: { label: "Replies", color: "var(--chart-2)" },
} satisfies ChartConfig;

const distributionConfig = {
  count: { label: "Applications", color: "var(--chart-1)" },
} satisfies ChartConfig;

export default function DashboardPage() {
  const { data, isLoading } = useApiQuery<AnalyticsPayload>(
    ["analytics", "dashboard"],
    "/api/analytics?scope=dashboard"
  );

  const stats = data?.stats;

  const tiles = [
    { label: "Jobs Found", value: stats?.jobsFound, icon: Briefcase, href: "/jobs" },
    { label: "Applications Sent", value: stats?.applicationsSent, icon: Send, href: "/applications" },
    { label: "Replies", value: stats?.replies, icon: MessageSquare, href: "/applications?status=REPLIED" },
    { label: "Interviews", value: stats?.interviews, icon: CalendarClock, href: "/applications?status=INTERVIEW" },
    { label: "Assessments", value: stats?.assessments, icon: FileQuestion, href: "/applications?status=ASSESSMENT" },
    { label: "Offers", value: stats?.offers, icon: Trophy, href: "/applications?status=OFFER" },
    { label: "Pending", value: stats?.pending, icon: Clock, href: "/emails" },
    { label: "Ghosted", value: stats?.ghosted, icon: Ghost, href: "/applications?status=GHOSTED" },
  ];

  return (
    <>
      <Topbar title="Dashboard" />
      <main className="flex-1 space-y-6 p-4 md:p-6">
        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {tiles.map((tile) => (
            <Link key={tile.label} href={tile.href}>
              <Card className="gap-2 py-4 transition-colors hover:bg-accent/50">
                <CardHeader className="px-4">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="text-xs font-medium">{tile.label}</span>
                    <tile.icon className="size-3.5" />
                  </div>
                </CardHeader>
                <CardContent className="px-4">
                  {isLoading ? (
                    <Skeleton className="h-7 w-10" />
                  ) : (
                    <p className="text-2xl font-semibold tracking-tight">
                      {tile.value ?? 0}
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Rate + quota + follow-up row */}
        <div className="grid gap-3 md:grid-cols-3">
          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <TrendingUp className="size-3.5" /> Response Rate
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <p className="text-2xl font-semibold tracking-tight">
                {stats?.responseRate ?? 0}%
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {stats?.avgResponseHours != null
                  ? `Avg response time ~${Math.round(stats.avgResponseHours / 24)}d ${stats.avgResponseHours % 24}h`
                  : "No replies measured yet"}
              </p>
            </CardContent>
          </Card>

          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Send className="size-3.5" /> Daily Email Quota
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <p className="text-2xl font-semibold tracking-tight">
                {data?.quota.used ?? 0}
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}/ {data?.quota.limit ?? 50}
                </span>
              </p>
              <Progress
                value={((data?.quota.used ?? 0) / (data?.quota.limit ?? 50)) * 100}
                className="mt-2 h-1.5"
              />
            </CardContent>
          </Card>

          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <AlertCircle className="size-3.5" /> Follow-ups Due
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-end justify-between px-4">
              <p className="text-2xl font-semibold tracking-tight">
                {stats?.followUpsDue ?? 0}
              </p>
              {(stats?.followUpsDue ?? 0) > 0 && (
                <Button asChild size="sm" variant="outline">
                  <Link href="/emails?status=PENDING_APPROVAL">Review</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid gap-3 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Applications & replies — last 30 days
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={seriesConfig} className="h-64 w-full">
                <AreaChart data={data?.series ?? []} margin={{ left: -20, right: 8 }}>
                  <CartesianGrid vertical={false} strokeOpacity={0.4} />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={40}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Area
                    dataKey="applications"
                    type="monotone"
                    fill="var(--color-applications)"
                    fillOpacity={0.08}
                    stroke="var(--color-applications)"
                    strokeWidth={2}
                  />
                  <Area
                    dataKey="replies"
                    type="monotone"
                    fill="var(--color-replies)"
                    fillOpacity={0.08}
                    stroke="var(--color-replies)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Match score distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={distributionConfig} className="h-64 w-full">
                <BarChart
                  data={stats?.matchScoreDistribution ?? []}
                  layout="vertical"
                  margin={{ left: 0, right: 24 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="bucket"
                    type="category"
                    tickLine={false}
                    axisLine={false}
                    width={52}
                  />
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Bar
                    dataKey="count"
                    fill="var(--color-count)"
                    radius={[0, 4, 4, 0]}
                    barSize={18}
                  >
                    <LabelList
                      dataKey="count"
                      position="right"
                      className="fill-foreground text-xs"
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}
