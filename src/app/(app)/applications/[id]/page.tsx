"use client";

import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Check, CircleDot, ExternalLink, FileText, Mail, MessageSquare,
  Pencil, Send, X,
} from "lucide-react";
import { format } from "date-fns";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge, MatchScore } from "@/components/shared/status-badge";
import { useApiQuery, useApiMutation } from "@/hooks/use-api";
import { cn } from "@/lib/utils";

interface EmailRow {
  id: string;
  type: string;
  status: string;
  toEmail: string;
  toName: string | null;
  subject: string;
  bodyText: string;
  scheduledAt: string | null;
  sentAt: string | null;
}

interface ApplicationDetail {
  id: string;
  status: string;
  matchScore: number | null;
  notes: string | null;
  appliedAt: string | null;
  followUpCount: number;
  job: {
    id: string; title: string; url: string | null;
    analysis: { strengths: string[]; missingSkills: string[] } | null;
  };
  company: { name: string } | null;
  recruiter: { name: string; email: string | null; sourceUrl: string } | null;
  resume: { id: string; label: string; fileName: string } | null;
  coverLetters: Array<{
    id: string; content: string; editedContent: string | null; createdAt: string;
  }>;
  emails: EmailRow[];
  events: Array<{
    id: string; type: string; title: string; createdAt: string;
  }>;
  threads: Array<{
    id: string;
    messages: Array<{
      id: string; direction: string; fromEmail: string; fromName: string | null;
      subject: string | null; bodyText: string | null; receivedAt: string;
      classification: string | null;
    }>;
  }>;
}

const EVENT_ICONS: Record<string, typeof CircleDot> = {
  EMAIL_SENT: Mail,
  REPLY_RECEIVED: MessageSquare,
  DRAFT_CREATED: FileText,
  APPROVED: Check,
};

export default function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [editingEmail, setEditingEmail] = useState<EmailRow | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [notes, setNotes] = useState<string | null>(null);
  const [manualEmail, setManualEmail] = useState("");
  const [manualName, setManualName] = useState("");

  const { data, isLoading, error } = useApiQuery<{ application: ApplicationDetail }>(
    ["application", id],
    `/api/applications/${id}`,
    { retry: false }
  );
  const app = data?.application;

  const approve = useApiMutation<string>(
    "POST",
    (emailId) => `/api/emails/${emailId}/approve`,
    {
      invalidate: [["application", id], ["applications"], ["emails"]],
      successMessage: "Approved — scheduled for a natural send window",
    }
  );
  const cancel = useApiMutation<string>(
    "POST",
    (emailId) => `/api/emails/${emailId}/cancel`,
    {
      invalidate: [["application", id], ["applications"], ["emails"]],
      successMessage: "Moved back to draft",
    }
  );
  const saveEmail = useApiMutation<void>(
    "PATCH",
    () => `/api/emails/${editingEmail?.id}`,
    {
      body: () => ({ subject: editSubject, bodyText: editBody }),
      invalidate: [["application", id]],
      successMessage: "Draft updated",
      onSuccess: () => setEditingEmail(null),
    }
  );
  const saveNotes = useApiMutation<void>("PATCH", () => `/api/applications/${id}`, {
    body: () => ({ notes }),
    invalidate: [["application", id]],
    successMessage: "Notes saved",
  });
  const generateToRecipient = useApiMutation<void>(
    "POST",
    () => `/api/applications/${id}/email`,
    {
      body: () => ({
        toEmail: manualEmail.trim(),
        ...(manualName.trim() ? { toName: manualName.trim() } : {}),
      }),
      invalidate: [["application", id], ["emails"]],
      successMessage: "Email drafted — review and approve it below",
      onSuccess: () => {
        setManualEmail("");
        setManualName("");
      },
    }
  );
  const markPortalApplied = useApiMutation<void>(
    "PATCH",
    () => `/api/applications/${id}`,
    {
      body: () => ({ status: "SENT" }),
      invalidate: [["application", id], ["applications"], ["analytics"]],
      successMessage: "Marked as applied — replies and follow-ups are tracked from today",
    }
  );

  return (
    <>
      <Topbar title="Application" />
      <main className="flex-1 space-y-4 p-4 md:p-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-8">
          <Link href="/applications">
            <ArrowLeft className="size-3.5" /> All applications
          </Link>
        </Button>

        {error ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
            <p className="text-sm font-medium">Application not found</p>
            <Button asChild size="sm" variant="outline" className="mt-1">
              <Link href="/applications">Back to applications</Link>
            </Button>
          </div>
        ) : isLoading || !app ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <>
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">
                  {app.job.title}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {app.company?.name}
                  {app.recruiter && ` · ${app.recruiter.name}`}
                  {app.resume && ` · resume: ${app.resume.label}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <MatchScore score={app.matchScore} />
                <StatusBadge status={app.status} />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              {/* Left: emails + cover letter + thread */}
              <div className="space-y-4 lg:col-span-2">
                <Tabs defaultValue="emails">
                  <TabsList>
                    <TabsTrigger value="emails">
                      Emails ({app.emails.length})
                    </TabsTrigger>
                    <TabsTrigger value="cover">
                      Cover letter
                    </TabsTrigger>
                    <TabsTrigger value="thread">
                      Conversation (
                      {app.threads.reduce((n, t) => n + t.messages.length, 0)})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="emails" className="mt-3 space-y-3">
                    {app.emails.length === 0 && (
                      <Card className="gap-3 py-4">
                        <CardHeader className="px-4">
                          <CardTitle className="text-sm">
                            No contact email found — two ways to proceed
                          </CardTitle>
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            Most companies don&apos;t publish recruiter emails.
                            Either send the email to an address you found in the
                            posting or on a public page, or apply on the company
                            site and track it here.
                          </p>
                        </CardHeader>
                        <CardContent className="space-y-4 px-4">
                          <div className="space-y-2">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <Input
                                type="email"
                                placeholder="recruiter@company.com"
                                value={manualEmail}
                                onChange={(e) => setManualEmail(e.target.value)}
                              />
                              <Input
                                placeholder="Their name (optional)"
                                value={manualName}
                                onChange={(e) => setManualName(e.target.value)}
                              />
                            </div>
                            <Button
                              size="sm"
                              disabled={
                                !/^\S+@\S+\.\S+$/.test(manualEmail.trim()) ||
                                generateToRecipient.isPending
                              }
                              onClick={() => generateToRecipient.mutate()}
                            >
                              <Mail className="size-3.5" />
                              {generateToRecipient.isPending
                                ? "Drafting…"
                                : "Generate email draft to this address"}
                            </Button>
                          </div>

                          <div className="border-t pt-3">
                            <div className="flex flex-wrap items-center gap-2">
                              {app.job.url && (
                                <Button asChild size="sm" variant="outline">
                                  <a href={app.job.url} target="_blank" rel="noreferrer">
                                    <ExternalLink className="size-3.5" />
                                    Apply on company site
                                  </a>
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={markPortalApplied.isPending || app.status === "SENT"}
                                onClick={() => markPortalApplied.mutate()}
                              >
                                <Send className="size-3.5" />
                                I applied via the portal — mark as applied
                              </Button>
                            </div>
                            <p className="mt-1.5 text-[11px] text-muted-foreground">
                              Use the generated cover letter from the tab above.
                              Marking as applied starts reply tracking and
                              follow-up reminders for this application.
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                    {app.emails.map((email) => (
                      <Card key={email.id} className="gap-2 py-4">
                        <CardHeader className="px-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <StatusBadge status={email.status} />
                              <span className="text-xs text-muted-foreground">
                                {email.type.replace(/_/g, " ").toLowerCase()} → {email.toEmail}
                              </span>
                            </div>
                            <div className="flex gap-1.5">
                              {["DRAFT", "PENDING_APPROVAL"].includes(email.status) && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7"
                                    onClick={() => {
                                      setEditingEmail(email);
                                      setEditSubject(email.subject);
                                      setEditBody(email.bodyText);
                                    }}
                                  >
                                    <Pencil className="size-3" /> Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="h-7"
                                    onClick={() => approve.mutate(email.id)}
                                    disabled={approve.isPending}
                                  >
                                    <Check className="size-3" /> Approve
                                  </Button>
                                </>
                              )}
                              {["APPROVED", "QUEUED"].includes(email.status) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7"
                                  onClick={() => cancel.mutate(email.id)}
                                >
                                  <X className="size-3" /> Cancel
                                </Button>
                              )}
                            </div>
                          </div>
                          <CardTitle className="text-sm">{email.subject}</CardTitle>
                          {email.scheduledAt && email.status === "QUEUED" && (
                            <p className="text-xs text-muted-foreground">
                              Sending ~{format(new Date(email.scheduledAt), "MMM d, HH:mm")}
                            </p>
                          )}
                          {email.sentAt && (
                            <p className="text-xs text-muted-foreground">
                              Sent {format(new Date(email.sentAt), "MMM d, HH:mm")}
                            </p>
                          )}
                        </CardHeader>
                        <CardContent className="px-4">
                          <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm leading-relaxed">
                            {email.bodyText}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </TabsContent>

                  <TabsContent value="cover" className="mt-3">
                    {app.coverLetters.length > 0 ? (
                      <Card className="py-4">
                        <CardContent className="px-4">
                          <p className="whitespace-pre-wrap text-sm leading-relaxed">
                            {app.coverLetters[0].editedContent ??
                              app.coverLetters[0].content}
                          </p>
                        </CardContent>
                      </Card>
                    ) : (
                      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                        No cover letter generated yet.
                      </p>
                    )}
                  </TabsContent>

                  <TabsContent value="thread" className="mt-3 space-y-3">
                    {app.threads.flatMap((t) => t.messages).length === 0 ? (
                      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                        No conversation yet — replies appear here automatically
                        once inbox monitoring sees them.
                      </p>
                    ) : (
                      app.threads
                        .flatMap((t) => t.messages)
                        .map((msg) => (
                          <div
                            key={msg.id}
                            className={cn(
                              "max-w-[85%] rounded-lg border p-3",
                              msg.direction === "OUTBOUND"
                                ? "ml-auto bg-primary/5"
                                : "bg-card"
                            )}
                          >
                            <div className="mb-1 flex items-center justify-between gap-3">
                              <p className="text-xs font-medium">
                                {msg.fromName ?? msg.fromEmail}
                              </p>
                              <div className="flex items-center gap-2">
                                {msg.classification &&
                                  msg.classification !== "REPLY" &&
                                  msg.direction === "INBOUND" && (
                                    <StatusBadge
                                      status={msg.classification}
                                      className="text-[10px]"
                                    />
                                  )}
                                <span className="text-[11px] text-muted-foreground">
                                  {format(new Date(msg.receivedAt), "MMM d, HH:mm")}
                                </span>
                              </div>
                            </div>
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                              {(msg.bodyText ?? "").slice(0, 2000)}
                            </p>
                          </div>
                        ))
                    )}
                  </TabsContent>
                </Tabs>

                {/* Notes */}
                <Card className="gap-2 py-4">
                  <CardHeader className="px-4">
                    <CardTitle className="text-sm font-medium">Notes</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 px-4">
                    <Textarea
                      rows={3}
                      placeholder="Private notes about this application…"
                      value={notes ?? app.notes ?? ""}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={notes === null || saveNotes.isPending}
                      onClick={() => saveNotes.mutate()}
                    >
                      Save notes
                    </Button>
                  </CardContent>
                </Card>
              </div>

              {/* Right: timeline */}
              <Card className="h-fit gap-2 py-4">
                <CardHeader className="px-4">
                  <CardTitle className="text-sm font-medium">Timeline</CardTitle>
                </CardHeader>
                <CardContent className="px-4">
                  <div className="relative space-y-4 before:absolute before:left-[7px] before:top-1 before:h-[calc(100%-8px)] before:w-px before:bg-border">
                    {app.events.map((event) => {
                      const Icon = EVENT_ICONS[event.type] ?? CircleDot;
                      return (
                        <div key={event.id} className="relative flex gap-3 pl-0">
                          <div className="z-10 mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border bg-background">
                            <Icon className="size-2.5 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm leading-snug">{event.title}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {format(new Date(event.createdAt), "MMM d, yyyy · HH:mm")}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* Edit email dialog */}
        <Dialog
          open={!!editingEmail}
          onOpenChange={(open) => !open && setEditingEmail(null)}
        >
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit email draft</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
                placeholder="Subject"
              />
              <Textarea
                rows={14}
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingEmail(null)}>
                Cancel
              </Button>
              <Button onClick={() => saveEmail.mutate()} disabled={saveEmail.isPending}>
                Save changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </>
  );
}
