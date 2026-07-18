"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Kanban, List, Send } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge, MatchScore } from "@/components/shared/status-badge";
import { useApiQuery } from "@/hooks/use-api";
import { timeAgo } from "@/lib/utils";

interface ApplicationRow {
  id: string;
  status: string;
  matchScore: number | null;
  appliedAt: string | null;
  updatedAt: string;
  followUpCount: number;
  nextFollowUpDue: string | null;
  job: { id: string; title: string; location: string | null; remote: boolean };
  company: { name: string } | null;
  recruiter: { name: string; email: string | null } | null;
  resume: { label: string } | null;
  emails: Array<{ id: string; status: string; type: string; scheduledAt: string | null }>;
}

const KANBAN_COLUMNS: Array<{ title: string; statuses: string[] }> = [
  { title: "Draft", statuses: ["DRAFT", "PENDING_APPROVAL"] },
  { title: "Queued", statuses: ["APPROVED", "SCHEDULED"] },
  { title: "Sent", statuses: ["SENT"] },
  { title: "In Conversation", statuses: ["REPLIED", "ASSESSMENT"] },
  { title: "Interview", statuses: ["INTERVIEW"] },
  { title: "Offer", statuses: ["OFFER"] },
  { title: "Closed", statuses: ["REJECTED", "GHOSTED", "WITHDRAWN"] },
];

function ApplicationsContent() {
  const params = useSearchParams();
  const statusFilter = params.get("status");
  const [view, setView] = useState<"kanban" | "table">("kanban");

  const { data, isLoading } = useApiQuery<{ applications: ApplicationRow[] }>(
    ["applications", statusFilter],
    `/api/applications${statusFilter ? `?status=${statusFilter}` : ""}`
  );

  const applications = data?.applications ?? [];

  return (
    <>
      <Topbar title="Applications" />
      <main className="flex-1 space-y-4 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {applications.length} application{applications.length === 1 ? "" : "s"}
            {statusFilter && (
              <>
                {" "}· filtered to <StatusBadge status={statusFilter} />{" "}
                <Link href="/applications" className="text-primary hover:underline">
                  clear
                </Link>
              </>
            )}
          </p>
          <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
            <TabsList className="h-8">
              <TabsTrigger value="kanban" className="h-6 px-2 text-xs">
                <Kanban className="size-3.5" /> Board
              </TabsTrigger>
              <TabsTrigger value="table" className="h-6 px-2 text-xs">
                <List className="size-3.5" /> Table
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-64" />
            ))}
          </div>
        ) : applications.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
            <Send className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No applications yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Find a job you like and click Apply — the AI drafts a personalized
              cover letter and email for your review.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-1">
              <Link href="/jobs">Browse jobs</Link>
            </Button>
          </div>
        ) : view === "kanban" ? (
          <ScrollArea className="w-full whitespace-nowrap pb-3">
            <div className="flex gap-3">
              {KANBAN_COLUMNS.map((column) => {
                const items = applications.filter((a) =>
                  column.statuses.includes(a.status)
                );
                return (
                  <div key={column.title} className="w-72 shrink-0">
                    <div className="mb-2 flex items-center justify-between px-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {column.title}
                      </p>
                      <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                        {items.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {items.map((app) => (
                        <Link key={app.id} href={`/applications/${app.id}`}>
                          <Card className="gap-1.5 whitespace-normal p-3 transition-colors hover:bg-accent/50">
                            <div className="flex items-start justify-between gap-2">
                              <p className="line-clamp-2 text-sm font-medium leading-snug">
                                {app.job.title}
                              </p>
                              <MatchScore score={app.matchScore} />
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {app.company?.name ?? "—"}
                              {app.resume && ` · ${app.resume.label}`}
                            </p>
                            <div className="flex items-center justify-between">
                              <StatusBadge status={app.status} />
                              <span className="text-[11px] text-muted-foreground">
                                {timeAgo(app.updatedAt)}
                              </span>
                            </div>
                          </Card>
                        </Link>
                      ))}
                      {items.length === 0 && (
                        <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                          Empty
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Role</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead className="hidden md:table-cell">Resume</TableHead>
                  <TableHead className="hidden md:table-cell">Applied</TableHead>
                  <TableHead className="hidden lg:table-cell">Follow-ups</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((app) => (
                  <TableRow key={app.id} className="cursor-pointer">
                    <TableCell className="max-w-72">
                      <Link
                        href={`/applications/${app.id}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {app.job.title}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-sm">
                      {app.company?.name ?? "—"}
                    </TableCell>
                    <TableCell><StatusBadge status={app.status} /></TableCell>
                    <TableCell><MatchScore score={app.matchScore} /></TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {app.resume?.label ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                      {app.appliedAt ? timeAgo(app.appliedAt) : "—"}
                    </TableCell>
                    <TableCell className="hidden text-xs tabular-nums text-muted-foreground lg:table-cell">
                      {app.followUpCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </main>
    </>
  );
}

export default function ApplicationsPage() {
  return (
    <Suspense>
      <ApplicationsContent />
    </Suspense>
  );
}
