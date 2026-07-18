"use client";

import {
  Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, XAxis, YAxis,
} from "recharts";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip,
  ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useApiQuery } from "@/hooks/use-api";
import type { DashboardStats, TimeSeriesPoint } from "@/lib/engine/analytics";

interface FullAnalytics {
  stats: DashboardStats;
  series: TimeSeriesPoint[];
  quota: { used: number; limit: number };
  companies: Array<{ company: string; sent: number; replied: number; rate: number }>;
  performance: {
    resumePerformance: Array<{ label: string; sent: number; replies: number }>;
    templatePerformance: Array<{
      name: string; type: string; abGroup: string | null; sent: number; replies: number;
    }>;
    topMissingSkills: Array<{ skill: string; count: number }>;
  };
}

const activityConfig = {
  jobsFound: { label: "Jobs found", color: "var(--chart-3)" },
  applications: { label: "Applications", color: "var(--chart-1)" },
  replies: { label: "Replies", color: "var(--chart-2)" },
} satisfies ChartConfig;

const resumeConfig = {
  sent: { label: "Sent", color: "var(--chart-1)" },
  replies: { label: "Replies", color: "var(--chart-2)" },
} satisfies ChartConfig;

const skillsConfig = {
  count: { label: "Jobs requiring it", color: "var(--chart-1)" },
} satisfies ChartConfig;

export default function AnalyticsPage() {
  const { data, isLoading } = useApiQuery<FullAnalytics>(
    ["analytics", "full"],
    "/api/analytics?scope=full&days=60"
  );

  return (
    <>
      <Topbar title="Analytics" />
      <main className="flex-1 space-y-4 p-4 md:p-6">
        {isLoading || !data ? (
          <div className="space-y-4">
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        ) : (
          <>
            {/* Activity over time */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  Pipeline activity — last 60 days
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={activityConfig} className="h-72 w-full">
                  <LineChart data={data.series} margin={{ left: -20, right: 8 }}>
                    <CartesianGrid vertical={false} strokeOpacity={0.4} />
                    <XAxis
                      dataKey="date" tickLine={false} axisLine={false}
                      tickMargin={8} minTickGap={48}
                      tickFormatter={(v: string) => v.slice(5)}
                    />
                    <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Line dataKey="jobsFound" type="monotone" stroke="var(--color-jobsFound)" strokeWidth={2} dot={false} />
                    <Line dataKey="applications" type="monotone" stroke="var(--color-applications)" strokeWidth={2} dot={false} />
                    <Line dataKey="replies" type="monotone" stroke="var(--color-replies)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Resume performance */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">
                    Resume performance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.performance.resumePerformance.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      No sends yet
                    </p>
                  ) : (
                    <ChartContainer config={resumeConfig} className="h-56 w-full">
                      <BarChart
                        data={data.performance.resumePerformance}
                        margin={{ left: -20, right: 8 }}
                      >
                        <CartesianGrid vertical={false} strokeOpacity={0.4} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} />
                        <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <ChartLegend content={<ChartLegendContent />} />
                        <Bar dataKey="sent" fill="var(--color-sent)" radius={[4, 4, 0, 0]} barSize={20} />
                        <Bar dataKey="replies" fill="var(--color-replies)" radius={[4, 4, 0, 0]} barSize={20} />
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>

              {/* Missing skills */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">
                    Skills most often missing (across analyzed jobs)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.performance.topMissingSkills.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      Analyze some jobs to see skill gaps
                    </p>
                  ) : (
                    <ChartContainer config={skillsConfig} className="h-56 w-full">
                      <BarChart
                        data={data.performance.topMissingSkills.slice(0, 8)}
                        layout="vertical"
                        margin={{ left: 10, right: 28 }}
                      >
                        <XAxis type="number" hide />
                        <YAxis
                          dataKey="skill" type="category" tickLine={false}
                          axisLine={false} width={110}
                          tickFormatter={(v: string) => v.length > 16 ? v.slice(0, 15) + "…" : v}
                        />
                        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                        <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} barSize={14}>
                          <LabelList dataKey="count" position="right" className="fill-foreground text-xs" />
                        </Bar>
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Company table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">
                    Most responsive companies
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Company</TableHead>
                        <TableHead className="text-right">Sent</TableHead>
                        <TableHead className="text-right">Replied</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.companies.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                            No applications sent yet
                          </TableCell>
                        </TableRow>
                      ) : (
                        data.companies.slice(0, 10).map((c) => (
                          <TableRow key={c.company}>
                            <TableCell className="max-w-44 truncate font-medium">{c.company}</TableCell>
                            <TableCell className="text-right tabular-nums">{c.sent}</TableCell>
                            <TableCell className="text-right tabular-nums">{c.replied}</TableCell>
                            <TableCell className="text-right tabular-nums">{c.rate}%</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Template A/B table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">
                    Email template performance (A/B)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Template</TableHead>
                        <TableHead>Group</TableHead>
                        <TableHead className="text-right">Sent</TableHead>
                        <TableHead className="text-right">Replies</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.performance.templatePerformance.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                            No templates in use — the AI writes free-form
                          </TableCell>
                        </TableRow>
                      ) : (
                        data.performance.templatePerformance.map((t) => (
                          <TableRow key={t.name}>
                            <TableCell className="max-w-36 truncate font-medium">{t.name}</TableCell>
                            <TableCell>
                              {t.abGroup ? (
                                <Badge variant="secondary" className="text-[10px]">{t.abGroup}</Badge>
                              ) : "—"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{t.sent}</TableCell>
                            <TableCell className="text-right tabular-nums">{t.replies}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {t.sent ? Math.round((t.replies / t.sent) * 100) : 0}%
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </main>
    </>
  );
}
