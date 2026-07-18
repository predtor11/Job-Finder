"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, Briefcase, Building2, Check, CheckCircle2,
  ChevronDown, ExternalLink, Lightbulb, MapPin, Send, Sparkles, UserSearch,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status-badge";
import { useApiQuery, useApiMutation } from "@/hooks/use-api";
import { cn, formatSalary, timeAgo } from "@/lib/utils";

interface JobDetail {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  remote: boolean;
  url: string | null;
  source: string;
  status: string;
  employmentType: string | null;
  experienceLevel: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  skills: string[];
  techStack: string[];
  requirements: string[];
  responsibilities: string[];
  discoveredAt: string;
  postedAt: string | null;
  company: { id: string; name: string; website: string | null } | null;
  analysis: {
    matchScore: number;
    bestResumeId: string | null;
    missingSkills: string[];
    strengths: string[];
    weaknesses: string[];
    resumeSuggestions: string[];
    resumeScores: Array<{ resumeId: string; score: number; reasons: string }>;
  } | null;
  recruiters: Array<{
    id: string; name: string; role: string | null; email: string | null;
    sourceUrl: string; confidence: number;
  }>;
  applications: Array<{ id: string; status: string }>;
}

// ─── Score presentation ──────────────────────────────────────────────────────

function scoreBand(score: number): { color: string; label: string } {
  if (score >= 80) return { color: "var(--success)", label: "Strong match" };
  if (score >= 65) return { color: "var(--success)", label: "Good match" };
  if (score >= 45) return { color: "var(--warning)", label: "Partial match" };
  return { color: "var(--destructive)", label: "Weak match" };
}

function ScoreRing({ score, size = 72 }: { score: number; size?: number }) {
  const { color } = scoreBand(score);
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke="currentColor" strokeWidth={stroke}
          className="text-muted/60"
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(score, 100) / 100)}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold tabular-nums leading-none">
          {score}
        </span>
        <span className="text-[9px] text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

// ─── Description with clickable links + show more ────────────────────────────

const URL_REGEX = /(https?:\/\/[^\s<>")\]]+)/g;
const CLAMP_AT = 1200;

function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_REGEX);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="break-all text-primary underline-offset-2 hover:underline"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function Description({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsClamp = text.length > CLAMP_AT;
  const shown =
    expanded || !needsClamp ? text : text.slice(0, CLAMP_AT).trimEnd() + "…";
  return (
    <div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
        <LinkifiedText text={shown} />
      </p>
      {needsClamp && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-7 px-2 text-xs text-primary"
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown
            className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
          />
          {expanded ? "Show less" : "Show full description"}
        </Button>
      )}
    </div>
  );
}

// ─── Analysis list section ───────────────────────────────────────────────────

function AnalysisSection({
  title,
  items,
  icon: Icon,
  iconClass,
}: {
  title: string;
  items: string[];
  icon: typeof CheckCircle2;
  iconClass: string;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm leading-snug">
            <Icon className={cn("mt-0.5 size-3.5 shrink-0", iconClass)} />
            <span className="text-foreground/85">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [resumeOverride, setResumeOverride] = useState<string>("");

  const { data, isLoading, error } = useApiQuery<{ job: JobDetail }>(
    ["job", id],
    `/api/jobs/${id}`,
    { retry: false }
  );
  const { data: resumesData } = useApiQuery<{
    resumes: Array<{ id: string; label: string; parseStatus: string }>;
  }>(["resumes"], "/api/resumes");

  const analyze = useApiMutation("POST", () => `/api/jobs/${id}/analyze`, {
    invalidate: [["job", id]],
    successMessage: "Analysis complete",
  });
  const findRecruiters = useApiMutation<void, { contacts: unknown[] }>(
    "POST",
    () => `/api/jobs/${id}/recruiters`,
    {
      invalidate: [["job", id]],
      successMessage: (r) =>
        r.contacts.length
          ? `Found ${r.contacts.length} public contact(s)`
          : "No public hiring contacts found on the company's pages",
    }
  );
  const apply = useApiMutation<void, { applicationId: string }>(
    "POST",
    () => "/api/applications",
    {
      body: () => ({
        jobId: id,
        ...(resumeOverride ? { resumeId: resumeOverride } : {}),
      }),
      invalidate: [["job", id], ["applications"]],
      onSuccess: (r) => router.push(`/applications/${r.applicationId}`),
      successMessage: "Draft application created — review it before approving",
    }
  );

  const job = data?.job;
  const analysis = job?.analysis ?? null;
  const application = job?.applications[0];
  const parsedResumes =
    resumesData?.resumes.filter((r) => r.parseStatus === "PARSED") ?? [];
  const resumeLabel = new Map(parsedResumes.map((r) => [r.id, r.label]));

  // Matched vs missing — connect the job's skill chips to the analysis.
  const missingSet = new Set(
    (analysis?.missingSkills ?? []).map((s) => s.toLowerCase())
  );
  const allSkills = job
    ? [...new Set([...job.techStack, ...job.skills])].slice(0, 24)
    : [];
  const lowMatch = analysis !== null && analysis.matchScore < 45;

  return (
    <>
      <Topbar title="Job Detail" />
      <main className="flex-1 space-y-4 p-4 md:p-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-8">
          <Link href="/jobs">
            <ArrowLeft className="size-3.5" /> All jobs
          </Link>
        </Button>

        {error ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
            <Briefcase className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">This job no longer exists</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              It may have been removed during a cleanup or re-import. The job
              list has the current set.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-1">
              <Link href="/jobs">Back to jobs</Link>
            </Button>
          </div>
        ) : isLoading || !job ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {/* ── Main column ── */}
            <div className="space-y-4 lg:col-span-2">
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-xl tracking-tight">
                          {job.title}
                        </CardTitle>
                        <StatusBadge status={application?.status ?? job.status} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        {job.company && (
                          <span className="flex items-center gap-1 font-medium text-foreground/80">
                            <Building2 className="size-3.5" /> {job.company.name}
                          </span>
                        )}
                        {(job.location || job.remote) && (
                          <span className="flex items-center gap-1">
                            <MapPin className="size-3.5" />
                            {job.remote ? "Remote" : job.location}
                          </span>
                        )}
                        {formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency) && (
                          <span className="font-medium tabular-nums text-foreground/80">
                            {formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency)}
                          </span>
                        )}
                        {job.experienceLevel && <span>{job.experienceLevel}</span>}
                        <span>
                          via {job.source.replace(/_/g, " ").toLowerCase()} ·{" "}
                          {timeAgo(job.discoveredAt)}
                        </span>
                      </div>
                      {job.url && (
                        <Button asChild variant="outline" size="sm" className="mt-3 h-7">
                          <a href={job.url} target="_blank" rel="noreferrer">
                            <ExternalLink className="size-3" /> Original posting
                          </a>
                        </Button>
                      )}
                    </div>
                    {analysis && (
                      <div className="flex flex-col items-center gap-1">
                        <ScoreRing score={analysis.matchScore} />
                        <span
                          className="text-[11px] font-medium"
                          style={{ color: scoreBand(analysis.matchScore).color }}
                        >
                          {scoreBand(analysis.matchScore).label}
                        </span>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Skills, connected to the analysis: green = evidenced on
                      your resume, amber = the analyzer flagged it missing. */}
                  {allSkills.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap gap-1.5">
                        {allSkills.map((skill) => {
                          const missing =
                            analysis !== null && missingSet.has(skill.toLowerCase());
                          const matched = analysis !== null && !missing;
                          return (
                            <Badge
                              key={skill}
                              variant="outline"
                              className={cn(
                                "gap-1 font-normal",
                                matched &&
                                  "border-success/30 bg-success/10 text-emerald-700 dark:text-emerald-400",
                                missing &&
                                  "border-warning/40 bg-warning/10 text-amber-700 dark:text-amber-400"
                              )}
                            >
                              {matched && <Check className="size-2.5" />}
                              {missing && <AlertTriangle className="size-2.5" />}
                              {skill}
                            </Badge>
                          );
                        })}
                      </div>
                      {analysis && (
                        <p className="text-[11px] text-muted-foreground">
                          <Check className="mr-0.5 inline size-3 text-success" />
                          on your resume ·{" "}
                          <AlertTriangle className="mx-0.5 inline size-3 text-warning" />
                          not evidenced
                        </p>
                      )}
                    </div>
                  )}

                  {job.requirements.length > 0 && (
                    <div>
                      <h3 className="mb-1.5 text-sm font-semibold">Requirements</h3>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {job.requirements.map((req, i) => (
                          <li key={i}>{req}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {job.responsibilities.length > 0 && (
                    <div>
                      <h3 className="mb-1.5 text-sm font-semibold">Responsibilities</h3>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {job.responsibilities.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {job.description && (
                    <div>
                      <h3 className="mb-1.5 text-sm font-semibold">Full posting</h3>
                      <Description text={job.description} />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ── Side column ── */}
            <div className="space-y-4">
              {/* Actions */}
              <Card className="gap-3 py-4">
                <CardContent className="space-y-2.5 px-4">
                  {!application ? (
                    <>
                      {parsedResumes.length > 1 && (
                        <Select value={resumeOverride} onValueChange={setResumeOverride}>
                          <SelectTrigger className="w-full" size="sm">
                            <SelectValue
                              placeholder={
                                analysis?.bestResumeId
                                  ? `Auto: ${resumeLabel.get(analysis.bestResumeId) ?? "best match"}`
                                  : "Resume (auto-pick)"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {parsedResumes.map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.label}
                                {r.id === analysis?.bestResumeId ? "  ★ recommended" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Button
                        className="w-full"
                        variant={lowMatch ? "outline" : "default"}
                        onClick={() => apply.mutate()}
                        disabled={apply.isPending}
                      >
                        <Send className="size-3.5" />
                        {apply.isPending ? "Generating draft…" : "Apply (create draft)"}
                      </Button>
                      {lowMatch && (
                        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                          <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" />
                          Weak match — the analyzer found major gaps. Applying is
                          still your call.
                        </p>
                      )}
                    </>
                  ) : (
                    <Button asChild className="w-full" variant="outline">
                      <Link href={`/applications/${application.id}`}>
                        View application
                      </Link>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => analyze.mutate()}
                    disabled={analyze.isPending}
                  >
                    <Sparkles className="size-3.5" />
                    {analyze.isPending
                      ? "Analyzing…"
                      : analysis ? "Re-analyze fit" : "Analyze fit"}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => findRecruiters.mutate()}
                    disabled={findRecruiters.isPending}
                  >
                    <UserSearch className="size-3.5" />
                    {findRecruiters.isPending ? "Searching…" : "Find hiring contacts"}
                  </Button>
                </CardContent>
              </Card>

              {/* Match analysis */}
              {analysis && (
                <Card className="gap-3 py-4">
                  <CardHeader className="px-4">
                    <CardTitle className="text-sm font-medium">
                      Match Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 px-4">
                    <AnalysisSection
                      title="Why you fit"
                      items={analysis.strengths}
                      icon={CheckCircle2}
                      iconClass="text-success"
                    />
                    <AnalysisSection
                      title="Gaps a recruiter may notice"
                      items={analysis.weaknesses}
                      icon={AlertTriangle}
                      iconClass="text-warning"
                    />
                    <AnalysisSection
                      title="Resume suggestions"
                      items={analysis.resumeSuggestions}
                      icon={Lightbulb}
                      iconClass="text-primary"
                    />

                    {analysis.resumeScores.length > 1 && (
                      <div>
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Per-resume fit
                        </p>
                        <div className="space-y-1.5">
                          {[...analysis.resumeScores]
                            .sort((a, b) => b.score - a.score)
                            .map((rs) => (
                              <div key={rs.resumeId} className="flex items-center gap-2">
                                <span className="w-28 truncate text-xs">
                                  {resumeLabel.get(rs.resumeId) ?? "Resume"}
                                </span>
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${rs.score}%`,
                                      background: scoreBand(rs.score).color,
                                    }}
                                  />
                                </div>
                                <span className="w-7 text-right text-xs tabular-nums">
                                  {rs.score}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Discovered contacts */}
              {job.recruiters.length > 0 && (
                <Card className="gap-3 py-4">
                  <CardHeader className="px-4">
                    <CardTitle className="text-sm font-medium">
                      Public hiring contacts
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 px-4">
                    {job.recruiters.map((rec) => (
                      <div key={rec.id} className="rounded-md border p-2.5 text-sm">
                        <div className="flex items-center justify-between">
                          <p className="font-medium">{rec.name}</p>
                          <Badge variant="secondary" className="text-[10px]">
                            {Math.round(rec.confidence * 100)}% conf.
                          </Badge>
                        </div>
                        {rec.role && (
                          <p className="text-xs text-muted-foreground">{rec.role}</p>
                        )}
                        {rec.email && (
                          <p className="mt-1 font-mono text-xs">{rec.email}</p>
                        )}
                        <a
                          href={rec.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <ExternalLink className="size-3" /> Source
                        </a>
                      </div>
                    ))}
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Contacts come only from public pages; the source link shows
                      exactly where each was found. Outreach always requires your
                      approval.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
