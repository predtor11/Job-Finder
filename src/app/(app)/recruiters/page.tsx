"use client";

import { useRef, useState } from "react";
import {
  BadgeCheck, ExternalLink, FileSpreadsheet, Mail, Search, Upload, UserPlus,
  Users,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { useApiQuery, useApiMutation, api } from "@/hooks/use-api";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com",
  "hotmail.com", "live.com", "icloud.com", "proton.me", "protonmail.com",
  "aol.com", "rediffmail.com", "zoho.com", "yandex.com", "mail.com",
]);

/** Trust signal: company-domain addresses are far less likely to be scams. */
function emailTrust(email: string): "corporate" | "free" {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return FREE_MAIL.has(domain) ? "free" : "corporate";
}

interface RecruiterRow {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  linkedinUrl: string | null;
  sourceUrl: string;
  sourceType: string;
  confidence: number;
  verified: boolean;
  createdAt: string;
  company: { name: string } | null;
  job: { id: string; title: string } | null;
  emails: Array<{ id: string; status: string; type: string; sentAt: string | null }>;
}

export default function RecruitersPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", companyName: "", role: "", email: "", sourceUrl: "", linkedinUrl: "",
  });
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useApiQuery<{ recruiters: RecruiterRow[] }>(
    ["recruiters", query],
    `/api/recruiters${query ? `?q=${encodeURIComponent(query)}` : ""}`
  );

  const outreach = useApiMutation<string, { emailId: string }>(
    "POST",
    () => "/api/emails",
    {
      body: (recruiterId) => ({ recruiterId }),
      invalidate: [["emails"]],
      successMessage:
        "Outreach draft created — review it in the Approval Queue before it can send",
    }
  );

  const addRecruiter = useApiMutation<void>("POST", () => "/api/recruiters", {
    body: () => ({
      name: form.name,
      ...(form.companyName ? { companyName: form.companyName } : {}),
      ...(form.role ? { role: form.role } : {}),
      ...(form.email ? { email: form.email } : {}),
      ...(form.linkedinUrl ? { linkedinUrl: form.linkedinUrl } : {}),
      sourceUrl: form.sourceUrl,
    }),
    invalidate: [["recruiters"]],
    onSuccess: () => {
      setAddOpen(false);
      setForm({ name: "", companyName: "", role: "", email: "", sourceUrl: "", linkedinUrl: "" });
      toast.success("Contact added");
    },
  });

  const verify = useApiMutation<string>("PATCH", (id) => `/api/recruiters/${id}`, {
    body: () => ({ verified: true }),
    invalidate: [["recruiters"]],
    successMessage: "Contact verified",
  });

  interface ImportResult { imported: number; duplicates: number; totalRows: number }

  async function importFile() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await api<ImportResult>("/api/recruiters/import", {
        method: "POST",
        body: formData,
      });
      onImportSuccess(result);
    } catch (error) {
      toast.error(String((error as Error).message));
    } finally {
      setImporting(false);
    }
  }

  async function importPasted() {
    if (!pastedText.trim()) return;
    setImporting(true);
    try {
      const result = await api<ImportResult>("/api/recruiters/import", {
        method: "POST",
        body: JSON.stringify({ text: pastedText }),
      });
      onImportSuccess(result);
      setPastedText("");
    } catch (error) {
      toast.error(String((error as Error).message));
    } finally {
      setImporting(false);
    }
  }

  function onImportSuccess(result: ImportResult) {
    toast.success(
      `Imported ${result.imported} new contact${result.imported === 1 ? "" : "s"}` +
        (result.duplicates > 0 ? ` — ${result.duplicates} already in your CRM` : "")
    );
    setImportOpen(false);
    if (fileRef.current) fileRef.current.value = "";
    queryClient.invalidateQueries({ queryKey: ["recruiters"] });
  }

  const recruiters = data?.recruiters ?? [];

  return (
    <>
      <Topbar title="Recruiters" />
      <main className="flex-1 space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name, company, email…"
              className="h-9 w-64 pl-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="ml-auto h-9">
                <FileSpreadsheet className="size-3.5" /> Import list
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Import your contact list</DialogTitle>
                <DialogDescription>
                  Bring in a spreadsheet or pasted table you already have (Name,
                  Email, and optionally Title/Company columns). This only adds
                  contacts to your CRM — cold outreach to any of them still
                  needs your approval one email at a time, same as every other
                  contact.
                </DialogDescription>
              </DialogHeader>
              <Tabs defaultValue="file">
                <TabsList className="w-full">
                  <TabsTrigger value="file" className="flex-1">Upload file</TabsTrigger>
                  <TabsTrigger value="paste" className="flex-1">Paste table</TabsTrigger>
                </TabsList>
                <TabsContent value="file" className="space-y-3 pt-2">
                  <Input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" />
                  <p className="text-xs text-muted-foreground">
                    .xlsx, .xls, or .csv — first row must be column headers.
                  </p>
                  <Button onClick={importFile} disabled={importing} className="w-full">
                    <Upload className="size-3.5" />
                    {importing ? "Importing…" : "Import file"}
                  </Button>
                </TabsContent>
                <TabsContent value="paste" className="space-y-3 pt-2">
                  <Textarea
                    rows={8}
                    placeholder={"name\temail\tcompany\nJane Doe\tjane@acme.com\tAcme"}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Paste directly from a spreadsheet (tab-separated) or a
                    comma-separated table — first line must be headers.
                  </p>
                  <Button
                    onClick={importPasted}
                    disabled={importing || !pastedText.trim()}
                    className="w-full"
                  >
                    <Upload className="size-3.5" />
                    {importing ? "Importing…" : "Import pasted contacts"}
                  </Button>
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-9">
                <UserPlus className="size-3.5" /> Add contact
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a public contact</DialogTitle>
                <DialogDescription>
                  Only add contacts whose details are publicly available. The
                  source URL (where you found them) is required and shown on
                  every outreach draft.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Name *</Label>
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Company</Label>
                    <Input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Role</Label>
                    <Input value={form.role} placeholder="Technical Recruiter" onChange={(e) => setForm({ ...form, role: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Public email</Label>
                    <Input value={form.email} type="email" onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Source URL * (where you found this contact)</Label>
                  <Input value={form.sourceUrl} placeholder="https://company.com/team" onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>LinkedIn profile</Label>
                  <Input value={form.linkedinUrl} placeholder="https://linkedin.com/in/…" onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => addRecruiter.mutate()}
                  disabled={!form.name || !form.sourceUrl || addRecruiter.isPending}
                >
                  Add contact
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Contact</TableHead>
                <TableHead>Company</TableHead>
                <TableHead className="hidden md:table-cell">Email</TableHead>
                <TableHead className="hidden lg:table-cell">Found via</TableHead>
                <TableHead className="hidden md:table-cell">Confidence</TableHead>
                <TableHead className="text-right">Outreach</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : recruiters.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-48">
                    <div className="flex flex-col items-center justify-center gap-2 text-center">
                      <Users className="size-8 text-muted-foreground/50" />
                      <p className="text-sm font-medium">No contacts yet</p>
                      <p className="max-w-sm text-xs text-muted-foreground">
                        Use “Find hiring contacts” on a job, or add a contact you
                        found on a public page.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                recruiters.map((rec) => (
                  <TableRow key={rec.id}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{rec.name}</span>
                        {rec.verified && (
                          <Tooltip>
                            <TooltipTrigger>
                              <BadgeCheck className="size-3.5 text-primary" />
                            </TooltipTrigger>
                            <TooltipContent>Verified by you</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {rec.role ?? "—"}
                        {rec.job && ` · ${rec.job.title}`}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">{rec.company?.name ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {rec.email ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs">{rec.email}</span>
                          {emailTrust(rec.email) === "corporate" ? (
                            <Tooltip>
                              <TooltipTrigger>
                                <Badge className="border-success/30 bg-success/10 px-1.5 py-0 text-[10px] font-normal text-emerald-700 dark:text-emerald-400" variant="outline">
                                  company domain
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                Address is on a company domain — stronger authenticity signal
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger>
                                <Badge className="border-warning/40 bg-warning/10 px-1.5 py-0 text-[10px] font-normal text-amber-700 dark:text-amber-400" variant="outline">
                                  free mailbox
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                Free email provider — legitimate for small startups, but
                                verify before sending; real companies rarely recruit from
                                personal mailboxes
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">not public</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {rec.sourceType === "IMPORTED_LIST" ? (
                        <Tooltip>
                          <TooltipTrigger>
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <FileSpreadsheet className="size-3" />
                              imported list
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            From a personal contact list you imported — no live
                            page to verify against, so double-check before
                            relying on it
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <a
                          href={rec.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <ExternalLink className="size-3" />
                          {rec.sourceType.replace(/_/g, " ").toLowerCase()}
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="secondary" className="text-[10px] tabular-nums">
                        {Math.round(rec.confidence * 100)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {!rec.verified && (
                          <Button
                            size="sm" variant="ghost" className="h-7 text-xs"
                            onClick={() => verify.mutate(rec.id)}
                          >
                            Verify
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={!rec.email || outreach.isPending}
                          onClick={() => outreach.mutate(rec.id)}
                        >
                          <Mail className="size-3" />
                          {rec.emails.some((e) => e.status === "SENT")
                            ? "Contacted"
                            : "Draft outreach"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Cold outreach always requires your approval before sending, regardless
          of send mode. Contacts are only ever collected from public sources and
          each one links to where it was found.
        </p>
      </main>
    </>
  );
}
