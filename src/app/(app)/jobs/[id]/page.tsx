"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ExternalLink, MapPin, Send, Sparkles, UserSearch, Building2,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { StatusBadge, MatchScore } from "@/components/shared/status-badge";
import { useApiQuery, useApiMutation } from "@/hooks/use-api";
import { formatSalary, timeAgo } from "@/lib/utils";

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

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [resumeOverride, setResumeOverride] = useState<string>("");

  const { data, isLoading } = useApiQuery<{ job: JobDetail }>(
    ["job", id],
    `/api/jobs/${id}`
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
  const application = job?.applications[0];
  const parsedResumes =
    resumesData?.resumes.filter((r) => r.parseStatus === "PARSED") ?? [];

  return (
    <>
      <Topbar title="Job Detail" />
      <main className="flex-1 space-y-4 p-4 md:p-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-8">
          <Link href="/jobs">
            <ArrowLeft className="size-3.5" /> All jobs
          </Link>
        </Button>

        {isLoading || !job ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Main column */}
            <div className="space-y-4 lg:col-span-2">
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-xl tracking-tight">
                        {job.title}
                      </CardTitle>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        {job.company && (
                          <span className="flex items-center gap-1">
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
                          <span className="tabular-nums">
                            {formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency)}
                          </span>
                        )}
                        <span>via {job.source.replace(/_/g, " ").toLowerCase()}</span>
                        <span>{timeAgo(job.discoveredAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={application?.status ?? job.status} />
                      {job.url && (
                        <Button asChild variant="outline" size="sm">
                          <a href={job.url} target="_blank" rel="noreferrer">
                            <ExternalLink className="size-3.5" /> Posting
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(job.skills.length > 0 || job.techStack.length > 0) && (
                    <div className="flex flex-wrap gap-1.5">
                      {[...new Set([...job.techStack, ...job.skills])]
                        .slice(0, 20)
                        .map((skill) => (
                          <Badge key={skill} variant="secondary" className="font-normal">
                            {skill}
                          </Badge>
                        ))}
                    </div>
                  )}
                  {job.requirements.length > 0 && (
                    <div>
                      <h3 className="mb-1.5 text-sm font-medium">Requirements</h3>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {job.requirements.map((req, i) => (
                          <li key={i}>{req}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {job.responsibilities.length > 0 && (
                    <div>
                      <h3 className="mb-1.5 text-sm font-medium">Responsibilities</h3>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {job.responsibilities.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {job.description && (
                    <div>
                      <h3 className="mb-1.5 text-sm font-medium">Description</h3>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                        {job.description}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Side column */}
            <div className="space-y-4">
              {/* Actions */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Actions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {!application ? (
                    <>
                      {parsedResumes.length > 1 && (
                        <Select value={resumeOverride} onValueChange={setResumeOverride}>
                          <SelectTrigger className="w-full" size="sm">
                            <SelectValue
                              placeholder={
                                job.analysis?.bestResumeId
                                  ? `Auto: ${parsedResumes.find((r) => r.id === job.analysis?.bestResumeId)?.label ?? "best match"}`
                                  : "Resume (auto-pick)"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {parsedResumes.map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.label}
                                {r.id === job.analysis?.bestResumeId ? "  ★ recommended" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Button
                        className="w-full"
                        onClick={() => apply.mutate()}
                        disabled={apply.isPending}
                      >
                        <Send className="size-3.5" />
                        {apply.isPending ? "Generating draft…" : "Apply (create draft)"}
                      </Button>
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
                      : job.analysis ? "Re-analyze fit" : "Analyze fit"}
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

              {/* Analysis */}
              {job.analysis && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between text-sm font-medium">
                      AI Match Analysis
                      <MatchScore score={job.analysis.matchScore} />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {job.analysis.strengths.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Strengths
                        </p>
                        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                          {job.analysis.strengths.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {job.analysis.missingSkills.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Missing skills
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {job.analysis.missingSkills.map((s) => (
                            <Badge key={s} variant="outline" className="font-normal text-muted-foreground">
                              {s}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {job.analysis.weaknesses.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Gaps a recruiter may notice
                        </p>
                        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                          {job.analysis.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    )}
                    {job.analysis.resumeSuggestions.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Resume suggestions
                        </p>
                        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                          {job.analysis.resumeSuggestions.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Discovered contacts */}
              {job.recruiters.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">
                      Public hiring contacts
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
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
