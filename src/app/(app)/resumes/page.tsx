"use client";

import { useRef, useState } from "react";
import {
  Download, FileText, Loader2, RefreshCw, Star, Trash2, Upload,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { useApiQuery, useApiMutation, api } from "@/hooks/use-api";
import { useQueryClient } from "@tanstack/react-query";
import { timeAgo } from "@/lib/utils";
import { toast } from "sonner";

interface ResumeRow {
  id: string;
  label: string;
  fileName: string;
  sizeBytes: number;
  isDefault: boolean;
  parseStatus: string;
  parseError: string | null;
  createdAt: string;
  profile: {
    name: string | null;
    summary: string | null;
    skills: string[];
    technologies: string[];
    keywords: string[];
    achievements: string[];
    preferredRoles: string[];
    yearsOfExperience: number | null;
  } | null;
  _count: { applications: number };
}

export default function ResumesPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [uploading, setUploading] = useState(false);

  const { data, isLoading } = useApiQuery<{ resumes: ResumeRow[] }>(
    ["resumes"],
    "/api/resumes"
  );

  const setDefault = useApiMutation<string>("PATCH", (id) => `/api/resumes/${id}`, {
    body: () => ({ isDefault: true }),
    invalidate: [["resumes"]],
    successMessage: "Default resume updated",
  });
  const reparse = useApiMutation<string>("PATCH", (id) => `/api/resumes/${id}`, {
    body: () => ({ reparse: true }),
    invalidate: [["resumes"]],
    successMessage: "Resume re-parsed",
  });
  const remove = useApiMutation<string>("DELETE", (id) => `/api/resumes/${id}`, {
    invalidate: [["resumes"]],
    successMessage: "Resume deleted",
  });

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file || !label.trim()) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("label", label.trim());
      const res = await fetch("/api/resumes", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      toast.success("Resume uploaded and analyzed");
      setUploadOpen(false);
      setLabel("");
      if (fileRef.current) fileRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["resumes"] });
    } catch (error) {
      toast.error(String((error as Error).message));
    } finally {
      setUploading(false);
    }
  }

  async function download(id: string) {
    try {
      const { downloadUrl } = await api<{ downloadUrl: string | null }>(
        `/api/resumes/${id}`
      );
      if (downloadUrl) window.open(downloadUrl, "_blank");
      else toast.error("No file available");
    } catch (error) {
      toast.error(String((error as Error).message));
    }
  }

  const resumes = data?.resumes ?? [];

  return (
    <>
      <Topbar title="Resumes" />
      <main className="flex-1 space-y-4 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Upload one resume per target role — the AI picks the best match for
            every job (you can always override).
          </p>
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Upload className="size-3.5" /> Upload resume
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload a resume</DialogTitle>
                <DialogDescription>
                  PDF, DOCX, or TXT up to 10 MB. It is parsed into a structured
                  profile used for matching and personalization.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Label *</Label>
                  <Input
                    placeholder="e.g. Backend Engineer, AI Engineer…"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>File *</Label>
                  <Input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.txt" />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={upload} disabled={uploading || !label.trim()}>
                  {uploading && <Loader2 className="size-3.5 animate-spin" />}
                  {uploading ? "Uploading & parsing…" : "Upload & parse"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-56" />
            <Skeleton className="h-56" />
          </div>
        ) : resumes.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
            <FileText className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No resumes yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Upload your first resume — everything else (matching, cover
              letters, emails) builds on it.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {resumes.map((resume) => (
              <Card key={resume.id} className="gap-3 py-4">
                <CardHeader className="px-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        {resume.label}
                        {resume.isDefault && (
                          <Badge variant="secondary" className="gap-1 text-[10px]">
                            <Star className="size-2.5 fill-current" /> default
                          </Badge>
                        )}
                      </CardTitle>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {resume.fileName} · {(resume.sizeBytes / 1024).toFixed(0)} KB ·{" "}
                        {timeAgo(resume.createdAt)} · used in{" "}
                        {resume._count.applications} application
                        {resume._count.applications === 1 ? "" : "s"}
                      </p>
                    </div>
                    <StatusBadge status={resume.parseStatus} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 px-4">
                  {resume.parseStatus === "FAILED" && resume.parseError && (
                    <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                      {resume.parseError}
                    </p>
                  )}
                  {resume.profile && (
                    <>
                      {resume.profile.preferredRoles.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Targets: {resume.profile.preferredRoles.join(", ")}
                          {resume.profile.yearsOfExperience != null &&
                            ` · ~${resume.profile.yearsOfExperience}y experience`}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1">
                        {resume.profile.technologies.slice(0, 12).map((tech) => (
                          <Badge key={tech} variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
                            {tech}
                          </Badge>
                        ))}
                        {resume.profile.technologies.length > 12 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{resume.profile.technologies.length - 12} more
                          </span>
                        )}
                      </div>
                    </>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {!resume.isDefault && (
                      <Button
                        size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => setDefault.mutate(resume.id)}
                      >
                        <Star className="size-3" /> Make default
                      </Button>
                    )}
                    <Button
                      size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => download(resume.id)}
                    >
                      <Download className="size-3" /> Download
                    </Button>
                    <Button
                      size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => reparse.mutate(resume.id)}
                      disabled={reparse.isPending}
                    >
                      <RefreshCw className="size-3" /> Re-parse
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive">
                          <Trash2 className="size-3" /> Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete “{resume.label}”?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The file and its parsed profile are removed.
                            Applications that used it keep their history.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => remove.mutate(resume.id)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
