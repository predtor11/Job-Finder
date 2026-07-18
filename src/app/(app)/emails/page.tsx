"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, ExternalLink, Inbox, Pencil, Trash2, X } from "lucide-react";
import { format } from "date-fns";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { useApiQuery, useApiMutation } from "@/hooks/use-api";

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
  createdAt: string;
  application: {
    id: string;
    job: { title: string } | null;
    company: { name: string } | null;
  } | null;
  recruiter: { name: string; sourceUrl: string; sourceType: string } | null;
}

const TABS = [
  { value: "PENDING_APPROVAL", label: "Needs approval" },
  { value: "QUEUED", label: "Queued" },
  { value: "SENT", label: "Sent" },
  { value: "DRAFT", label: "Drafts" },
  { value: "FAILED", label: "Failed" },
];

function EmailsContent() {
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("status") ?? "PENDING_APPROVAL");
  const [editing, setEditing] = useState<EmailRow | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");

  const { data, isLoading } = useApiQuery<{ emails: EmailRow[] }>(
    ["emails", tab],
    `/api/emails?status=${tab}`
  );

  const invalidate = [["emails"], ["applications"], ["analytics"]];
  const approve = useApiMutation<string>("POST", (id) => `/api/emails/${id}/approve`, {
    invalidate,
    successMessage: "Approved — scheduled inside your working hours",
  });
  const cancel = useApiMutation<string>("POST", (id) => `/api/emails/${id}/cancel`, {
    invalidate,
    successMessage: "Cancelled back to draft",
  });
  const remove = useApiMutation<string>("DELETE", (id) => `/api/emails/${id}`, {
    invalidate,
    successMessage: "Draft deleted",
  });
  const save = useApiMutation<void>("PATCH", () => `/api/emails/${editing?.id}`, {
    body: () => ({ subject: editSubject, bodyText: editBody }),
    invalidate,
    successMessage: "Draft updated",
    onSuccess: () => setEditing(null),
  });

  const emails = data?.emails ?? [];

  return (
    <>
      <Topbar title="Approval Queue" />
      <main className="flex-1 space-y-4 p-4 md:p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : emails.length === 0 ? (
          <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
            <Inbox className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">Nothing here</p>
            <p className="max-w-md text-xs text-muted-foreground">
              {tab === "PENDING_APPROVAL"
                ? "Drafts land here when you apply to a job, request cold outreach, or a follow-up is generated. Nothing sends without your approval rules."
                : "No emails in this state."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {emails.map((email) => (
              <Card key={email.id} className="gap-2 py-4">
                <CardHeader className="px-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={email.status} />
                      <StatusBadge status={email.type} className="bg-secondary text-secondary-foreground" />
                      <span className="text-xs text-muted-foreground">
                        to {email.toName ? `${email.toName} <${email.toEmail}>` : email.toEmail}
                      </span>
                      {email.recruiter && email.type === "COLD_OUTREACH" && (
                        <a
                          href={email.recruiter.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          title="Where this contact was found"
                        >
                          <ExternalLink className="size-3" /> contact source
                        </a>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      {["DRAFT", "PENDING_APPROVAL"].includes(email.status) && (
                        <>
                          <Button
                            size="sm" variant="outline" className="h-7"
                            onClick={() => {
                              setEditing(email);
                              setEditSubject(email.subject);
                              setEditBody(email.bodyText);
                            }}
                          >
                            <Pencil className="size-3" /> Edit
                          </Button>
                          <Button
                            size="sm" variant="outline" className="h-7 text-destructive"
                            onClick={() => remove.mutate(email.id)}
                          >
                            <Trash2 className="size-3" />
                          </Button>
                          <Button
                            size="sm" className="h-7"
                            onClick={() => approve.mutate(email.id)}
                            disabled={approve.isPending}
                          >
                            <Check className="size-3" /> Approve & queue
                          </Button>
                        </>
                      )}
                      {email.status === "QUEUED" && (
                        <Button
                          size="sm" variant="outline" className="h-7"
                          onClick={() => cancel.mutate(email.id)}
                        >
                          <X className="size-3" /> Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                  <CardTitle className="text-sm">{email.subject}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {email.application?.job?.title && (
                      <>
                        {email.application.company?.name} · {email.application.job.title} ·{" "}
                        <Link
                          href={`/applications/${email.application.id}`}
                          className="text-primary hover:underline"
                        >
                          view application
                        </Link>
                        {" · "}
                      </>
                    )}
                    {email.status === "QUEUED" && email.scheduledAt
                      ? `sending ~${format(new Date(email.scheduledAt), "MMM d, HH:mm")}`
                      : email.sentAt
                        ? `sent ${format(new Date(email.sentAt), "MMM d, HH:mm")}`
                        : `created ${format(new Date(email.createdAt), "MMM d, HH:mm")}`}
                  </p>
                </CardHeader>
                <CardContent className="px-4">
                  <p className="line-clamp-6 whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm leading-relaxed">
                    {email.bodyText}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit draft</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
              />
              <Textarea
                rows={14}
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </>
  );
}

export default function EmailsPage() {
  return (
    <Suspense>
      <EmailsContent />
    </Suspense>
  );
}
