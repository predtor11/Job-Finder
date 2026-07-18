"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Briefcase, CheckCircle2, CircleDashed, ExternalLink, Import, Loader2,
  MapPin, RefreshCw, Search, Sparkles, XCircle,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { StatusBadge, MatchScore } from "@/components/shared/status-badge";
import { Card } from "@/components/ui/card";
import { useApiQuery, useApiMutation } from "@/hooks/use-api";
import { formatSalary, timeAgo } from "@/lib/utils";
import { toast } from "sonner";
import type { DiscoveryProgress } from "@/lib/engine/discovery";

interface DiscoveryRun {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  payload: DiscoveryProgress | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
  remoteok: "RemoteOK",
  "hn-whoishiring": "HN Who is Hiring",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  "career-page": "Career pages",
};

const STAGE_LABELS: Record<string, string> = {
  fetching: "Fetching from job sources…",
  saving: "Saving new jobs…",
  matching: "Checking your saved searches…",
  analyzing: "Scoring newest jobs against your resumes…",
  done: "Finished",
  error: "Failed",
};

interface JobRow {
  id: string;
  title: string;
  location: string | null;
  remote: boolean;
  source: string;
  status: string;
  url: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  techStack: string[];
  discoveredAt: string;
  company: { name: string; logoUrl: string | null } | null;
  analysis: { matchScore: number } | null;
  applications: Array<{ id: string; status: string }>;
}

function JobsContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(params.get("import") === "1");
  const [importUrl, setImportUrl] = useState("");
  const [importText, setImportText] = useState("");

  const queryString = new URLSearchParams({
    ...(query ? { q: query } : {}),
    ...(status !== "all" ? { status } : {}),
    ...(source !== "all" ? { source } : {}),
    ...(remoteOnly ? { remote: "true" } : {}),
    page: String(page),
    pageSize: "25",
  }).toString();

  const queryClient = useQueryClient();
  const { data, isLoading } = useApiQuery<{
    jobs: JobRow[];
    total: number;
    pageSize: number;
  }>(["jobs", queryString], `/api/jobs?${queryString}`);

  const discover = useApiMutation<void, { inserted: number; fetched: number }>(
    "POST",
    () => "/api/jobs/discover",
    {
      invalidate: [["jobs"], ["discovery-status"]],
      successMessage: (r) => `Discovery finished — ${r.inserted} new jobs`,
    }
  );

  // Live progress: poll the latest run while one is active (covers runs
  // started here, in another tab, or by cron).
  const { data: runData } = useApiQuery<{ run: DiscoveryRun | null }>(
    ["discovery-status"],
    "/api/jobs/discover",
    {
      refetchInterval: (query) =>
        discover.isPending || query.state.data?.run?.status === "RUNNING"
          ? 1500
          : false,
    }
  );
  const run = runData?.run ?? null;
  const running = discover.isPending || run?.status === "RUNNING";
  const progress = run?.payload ?? null;

  // Stream freshly saved jobs into the table while the run progresses.
  useEffect(() => {
    if (run?.status === "RUNNING" || run?.status === "COMPLETED") {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    }
  }, [run?.status, progress?.inserted, progress?.stage, queryClient]);

  const importJob = useApiMutation<void, { jobId: string }>(
    "POST",
    () => "/api/jobs",
    {
      body: () => ({
        ...(importUrl ? { url: importUrl } : {}),
        ...(importText ? { pastedText: importText } : {}),
      }),
      invalidate: [["jobs"]],
      onSuccess: (r) => {
        setImportOpen(false);
        setImportUrl("");
        setImportText("");
        toast.success("Job imported");
        router.push(`/jobs/${r.jobId}`);
      },
    }
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <Topbar title="Jobs" />
      <main className="flex-1 space-y-4 p-4 md:p-6">
        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search title, company, description…"
              className="h-9 w-64 pl-8"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="h-9 w-36" size="sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {["NEW", "ANALYZED", "SHORTLISTED", "APPLIED", "ARCHIVED"].map((s) => (
                <SelectItem key={s} value={s}>{s.toLowerCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}>
            <SelectTrigger className="h-9 w-40" size="sm">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {[
                "REMOTEOK", "HN_WHO_IS_HIRING", "GREENHOUSE", "LEVER", "ASHBY",
                "CAREER_PAGE", "LINKEDIN_IMPORT", "WELLFOUND_IMPORT", "MANUAL",
              ].map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, " ").toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={remoteOnly ? "default" : "outline"}
            size="sm"
            className="h-9"
            onClick={() => { setRemoteOnly(!remoteOnly); setPage(1); }}
          >
            Remote
          </Button>

          <div className="ml-auto flex gap-2">
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <Import className="size-3.5" /> Import
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Import a job</DialogTitle>
                  <DialogDescription>
                    Paste a job URL (Greenhouse, Lever, career pages…) or the
                    posting text itself — the compliant way to track LinkedIn
                    and Wellfound jobs. AI extracts the details.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="import-url">Job URL</Label>
                    <Input
                      id="import-url"
                      placeholder="https://…"
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="import-text">
                      …or paste the job description
                    </Label>
                    <Textarea
                      id="import-text"
                      rows={7}
                      placeholder="Paste the full posting text (needed for login-walled pages like LinkedIn)…"
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => importJob.mutate()}
                    disabled={importJob.isPending || (!importUrl && importText.length < 100)}
                  >
                    {importJob.isPending ? "Importing…" : "Import job"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button
              size="sm"
              className="h-9"
              onClick={() => discover.mutate()}
              disabled={running}
            >
              <RefreshCw className={running ? "size-3.5 animate-spin" : "size-3.5"} />
              {running ? "Searching…" : "Discover now"}
            </Button>
          </div>
        </div>

        {/* Live discovery progress */}
        {running && (
          <Card className="gap-3 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin text-primary" />
                <p className="text-sm font-medium">
                  {STAGE_LABELS[progress?.stage ?? "fetching"]}
                </p>
              </div>
              <p className="text-sm tabular-nums text-muted-foreground">
                {progress ? (
                  <>
                    <span className="font-medium text-foreground">
                      {progress.inserted}
                    </span>{" "}
                    new · {progress.duplicates} known
                    {progress.skippedIrrelevant > 0 &&
                      ` · ${progress.skippedIrrelevant} off-profile`}
                    {progress.analyzed > 0 && ` · ${progress.analyzed} scored`}
                  </>
                ) : (
                  "starting…"
                )}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
              {Object.entries(progress?.sources ?? {}).map(([name, src]) => (
                <div
                  key={name}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    {src.status === "running" ? (
                      <Loader2 className="size-3.5 animate-spin text-primary" />
                    ) : src.status === "ok" ? (
                      <CheckCircle2 className="size-3.5 text-success" />
                    ) : src.status === "error" ? (
                      <XCircle className="size-3.5 text-destructive" />
                    ) : (
                      <CircleDashed className="size-3.5" />
                    )}
                    {SOURCE_LABELS[name] ?? name}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {src.status === "error" ? "failed" : src.fetched}
                  </span>
                </div>
              ))}
            </div>
            {progress?.stage === "saving" && progress.fetched > 200 && (
              <p className="text-xs text-muted-foreground">
                Saving {progress.fetched} fetched postings — new ones appear in
                the list below as they land.
              </p>
            )}
          </Card>
        )}
        {run?.status === "FAILED" && !running && (
          <Card className="border-destructive/30 p-3">
            <p className="text-sm text-destructive">
              Last discovery run failed: {run.error ?? "unknown error"}
            </p>
          </Card>
        )}

        {/* Jobs table */}
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Role</TableHead>
                <TableHead>Company</TableHead>
                <TableHead className="hidden md:table-cell">Location</TableHead>
                <TableHead className="hidden lg:table-cell">Salary</TableHead>
                <TableHead>Match</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Found</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : data?.jobs.length ? (
                data.jobs.map((job) => (
                  <TableRow
                    key={job.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/jobs/${job.id}`)}
                  >
                    <TableCell className="max-w-72">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{job.title}</span>
                        {job.url && (
                          <a
                            href={job.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="size-3" />
                          </a>
                        )}
                      </div>
                      {job.techStack.length > 0 && (
                        <div className="mt-1 flex gap-1">
                          {job.techStack.slice(0, 4).map((tech) => (
                            <Badge
                              key={tech}
                              variant="secondary"
                              className="px-1.5 py-0 text-[10px] font-normal"
                            >
                              {tech}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-sm">
                      {job.company?.name ?? "—"}
                    </TableCell>
                    <TableCell className="hidden max-w-40 md:table-cell">
                      <span className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                        {job.remote ? (
                          <Badge variant="outline" className="text-[10px]">remote</Badge>
                        ) : (
                          <MapPin className="size-3 shrink-0" />
                        )}
                        <span className="truncate">{job.location ?? ""}</span>
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-sm tabular-nums lg:table-cell">
                      {formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency) ?? "—"}
                    </TableCell>
                    <TableCell>
                      <MatchScore score={job.analysis?.matchScore} />
                    </TableCell>
                    <TableCell>
                      {job.applications.length > 0 ? (
                        <StatusBadge status={job.applications[0].status} />
                      ) : (
                        <StatusBadge status={job.status} />
                      )}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                      {timeAgo(job.discoveredAt)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="h-48">
                    <div className="flex flex-col items-center justify-center gap-2 text-center">
                      <Briefcase className="size-8 text-muted-foreground/50" />
                      <p className="text-sm font-medium">No jobs yet</p>
                      <p className="max-w-sm text-xs text-muted-foreground">
                        Run discovery to pull from RemoteOK, Hacker News, and any
                        Greenhouse/Lever/Ashby boards you follow in Settings — or
                        import a job by URL.
                      </p>
                      <Button
                        size="sm"
                        className="mt-2"
                        onClick={() => discover.mutate()}
                        disabled={running}
                      >
                        <Sparkles className="size-3.5" /> Run discovery
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {data.total} jobs · page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

export default function JobsPage() {
  return (
    <Suspense>
      <JobsContent />
    </Suspense>
  );
}
