"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2, ChevronDown, ExternalLink, KeyRound, Loader2, Mail,
  ShieldCheck, Unplug,
} from "lucide-react";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useApiQuery, useApiMutation } from "@/hooks/use-api";
import { toast } from "sonner";

/**
 * Board tokens verified (by checking each board's actual job locations) to
 * carry a meaningful share of India-located or genuinely India-eligible
 * remote postings. Boards with zero India yield were deliberately excluded —
 * this list is curated for signal, not maximum coverage.
 */
const INDIA_SUGGESTED_BOARDS: Record<string, string[]> = {
  greenhouse: [
    "groww", "phonepe", "postman", "zenoti", "tekion", "druva", "databricks",
    "stripe", "mongodb", "gitlab", "twilio", "elastic", "turing", "datadog",
    "cockroachlabs", "figma", "cloudflare",
  ],
  ashby: [
    "atlan", "skyflow", "linear", "ramp", "replit", "supabase", "posthog",
    "cursor", "notion",
  ],
};

interface SettingsPayload {
  settings: {
    aiFastModel: string;
    aiSmartModel: string;
    aiDailyBudget: number;
    geminiApiKeyMasked: string | null;
    sendMode: "DRAFT" | "MANUAL" | "AUTO" | "SCHEDULED";
    autoDraftEnabled: boolean;
    autoDraftThreshold: number;
    dailyEmailLimit: number;
    minSendGapMinutes: number;
    sendJitterMinutes: number;
    autoApproveThreshold: number;
    emailSignature: string | null;
    followUpAfterDays: number;
    secondFollowUpDays: number;
    maxFollowUps: number;
    autoSendFollowUps: boolean;
    preferredRoles: string[];
    preferredLocations: string[];
    preferredTech: string[];
    timezone: string;
    workingHoursStart: number;
    workingHoursEnd: number;
    jobSources: Record<string, { enabled?: boolean; boards?: string[]; sites?: string[]; urls?: string[]; tags?: string[]; keywords?: string[] }> | null;
  };
  gmailAccounts: Array<{
    id: string; email: string; status: string; lastSyncAt: string | null;
  }>;
}

const API_KEY_STEPS = [
  {
    title: "Open Google AI Studio",
    body: "Sign in with any Google account — no billing or credit card needed for the free tier.",
    link: { href: "https://aistudio.google.com/apikey", label: "aistudio.google.com/apikey" },
  },
  {
    title: "Click “Create API key”",
    body: "If asked, let it create a new Google Cloud project for you — the default option is fine.",
  },
  {
    title: "Copy the generated key",
    body: "It looks like “AIza…” — copy it right away; you can always create another one later.",
  },
  {
    title: "Paste it below and save",
    body: "The key is encrypted before it's stored, is only ever used server-side for your account, and you can remove it anytime.",
  },
];

function SettingsContent() {
  const params = useSearchParams();
  const defaultTab = params.get("tab") ?? "email";
  const { data, isLoading, refetch } = useApiQuery<SettingsPayload>(
    ["settings"],
    "/api/settings"
  );

  // Local editable copy.
  const [s, setS] = useState<SettingsPayload["settings"] | null>(null);
  const [geminiKey, setGeminiKey] = useState("");
  useEffect(() => {
    if (data?.settings && !s) setS(data.settings);
  }, [data, s]);

  useEffect(() => {
    const gmail = params.get("gmail");
    if (gmail === "connected") toast.success(`Gmail connected: ${params.get("email")}`);
    if (gmail === "error") toast.error("Gmail connection failed — try again.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useApiMutation<Partial<Record<string, unknown>>>(
    "PATCH",
    () => "/api/settings",
    {
      body: (vars) => vars,
      invalidate: [["settings"]],
      successMessage: "Settings saved",
      onSuccess: () => setGeminiKey(""),
    }
  );
  const disconnect = useApiMutation<string>("POST", () => "/api/gmail/disconnect", {
    body: (accountId) => ({ accountId }),
    invalidate: [["settings"]],
    successMessage: "Gmail disconnected",
    onSuccess: () => refetch(),
  });

  if (isLoading || !s) {
    return (
      <>
        <Topbar title="Settings" />
        <main className="flex-1 p-6">
          <Loader2 className="mx-auto mt-24 size-6 animate-spin text-muted-foreground" />
        </main>
      </>
    );
  }

  const sources = s.jobSources ?? {};
  const patchSources = (key: string, patch: object) =>
    setS({
      ...s,
      jobSources: { ...sources, [key]: { ...(sources[key] ?? {}), ...patch } },
    });

  const csv = (arr: string[] | undefined) => (arr ?? []).join(", ");
  const parseCsv = (v: string) =>
    v.split(",").map((x) => x.trim()).filter(Boolean);

  return (
    <>
      <Topbar title="Settings" />
      <main className="flex-1 space-y-4 p-4 md:p-6">
        <Tabs defaultValue={defaultTab} className="max-w-3xl">
          <TabsList>
            <TabsTrigger value="email">Email & Gmail</TabsTrigger>
            <TabsTrigger value="ai">AI</TabsTrigger>
            <TabsTrigger value="followups">Follow-ups</TabsTrigger>
            <TabsTrigger value="sources">Job Sources</TabsTrigger>
            <TabsTrigger value="prefs">Preferences</TabsTrigger>
          </TabsList>

          {/* ─── Email & Gmail ─── */}
          <TabsContent value="email" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Gmail connection</CardTitle>
                <CardDescription>
                  OAuth only — no passwords are ever stored. Tokens are encrypted
                  at rest and you can revoke access at any time.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {data?.gmailAccounts.length ? (
                  data.gmailAccounts.map((account) => (
                    <div
                      key={account.id}
                      className="flex items-center justify-between rounded-md border p-3"
                    >
                      <div className="flex items-center gap-2.5">
                        <Mail className="size-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{account.email}</p>
                          <p className="text-xs text-muted-foreground">
                            {account.status === "CONNECTED" ? (
                              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="size-3" /> connected
                              </span>
                            ) : (
                              <Badge variant="destructive" className="text-[10px]">
                                {account.status.toLowerCase()} — reconnect
                              </Badge>
                            )}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline" size="sm"
                        onClick={() => disconnect.mutate(account.id)}
                      >
                        <Unplug className="size-3.5" /> Disconnect
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No Gmail account connected yet.
                  </p>
                )}
                <Button asChild variant={data?.gmailAccounts.length ? "outline" : "default"}>
                  {/* Full page nav — OAuth redirect flow */}
                  <a href="/api/gmail/connect">
                    <Mail className="size-3.5" />
                    {data?.gmailAccounts.length ? "Reconnect / add account" : "Connect Gmail"}
                  </a>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sending rules</CardTitle>
                <CardDescription>
                  Hard-capped at 50/day. Sends are spread across your working
                  hours with a randomized gap so outreach stays human-paced.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Send mode</Label>
                  <Select
                    value={s.sendMode}
                    onValueChange={(v) => setS({ ...s, sendMode: v as typeof s.sendMode })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DRAFT">Draft only — never send</SelectItem>
                      <SelectItem value="MANUAL">Manual — approve each email</SelectItem>
                      <SelectItem value="AUTO">Auto — approve high matches</SelectItem>
                      <SelectItem value="SCHEDULED">Scheduled — approve + pick time</SelectItem>
                    </SelectContent>
                  </Select>
                  {s.sendMode === "AUTO" && (
                    <p className="text-xs text-muted-foreground">
                      Cold outreach still always requires manual approval.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Daily email limit (max 50)</Label>
                  <Input
                    type="number" min={1} max={50}
                    value={s.dailyEmailLimit}
                    onChange={(e) => setS({ ...s, dailyEmailLimit: Math.min(50, Number(e.target.value)) })}
                  />
                </div>
                {s.sendMode === "AUTO" && (
                  <div className="space-y-1.5">
                    <Label>Auto-approve above match score</Label>
                    <Input
                      type="number" min={0} max={100}
                      value={s.autoApproveThreshold}
                      onChange={(e) => setS({ ...s, autoApproveThreshold: Number(e.target.value) })}
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Min gap between sends (minutes)</Label>
                  <Input
                    type="number" min={1} max={240}
                    value={s.minSendGapMinutes}
                    onChange={(e) => setS({ ...s, minSendGapMinutes: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Random jitter (minutes)</Label>
                  <Input
                    type="number" min={0} max={120}
                    value={s.sendJitterMinutes}
                    onChange={(e) => setS({ ...s, sendJitterMinutes: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Email signature</Label>
                  <Textarea
                    rows={3}
                    placeholder={"Best regards,\nYour Name\nyour-portfolio.com"}
                    value={s.emailSignature ?? ""}
                    onChange={(e) => setS({ ...s, emailSignature: e.target.value })}
                  />
                </div>

                {/* Autopilot */}
                <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
                  <div>
                    <p className="text-sm font-medium">
                      Auto-draft applications for strong matches
                    </p>
                    <p className="text-xs text-muted-foreground">
                      After each discovery run, cover letters and emails are
                      drafted for top-scoring jobs and wait in the Approval
                      Queue. Nothing sends without your send rules.
                    </p>
                  </div>
                  <Switch
                    checked={s.autoDraftEnabled}
                    onCheckedChange={(v) => setS({ ...s, autoDraftEnabled: v })}
                  />
                </div>
                {s.autoDraftEnabled && (
                  <div className="space-y-1.5">
                    <Label>Auto-draft above match score</Label>
                    <Input
                      type="number" min={0} max={100}
                      value={s.autoDraftThreshold}
                      onChange={(e) => setS({ ...s, autoDraftThreshold: Number(e.target.value) })}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── AI ─── */}
          <TabsContent value="ai" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Gemini API</CardTitle>
                <CardDescription>
                  All AI features (resume parsing, job scoring, email drafting)
                  run on Google&apos;s Gemini — the free tier is enough.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {/* Which key is in use right now */}
                <div className="flex items-center justify-between gap-3 rounded-md border p-3 sm:col-span-2">
                  <div className="flex items-center gap-2.5 text-sm">
                    <KeyRound
                      className={cn(
                        "size-4 shrink-0",
                        s.geminiApiKeyMasked ? "text-success" : "text-destructive"
                      )}
                    />
                    {s.geminiApiKeyMasked ? (
                      <span>
                        Using <span className="font-medium">your key</span>{" "}
                        <span className="font-mono text-xs text-muted-foreground">
                          {s.geminiApiKeyMasked}
                        </span>
                      </span>
                    ) : (
                      <span className="text-destructive">
                        No key configured — every account uses its own key, so
                        all AI features are off until you add one
                      </span>
                    )}
                  </div>
                  {s.geminiApiKeyMasked && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 text-xs text-destructive"
                      onClick={() => save.mutate({ geminiApiKey: null })}
                    >
                      Remove my key
                    </Button>
                  )}
                </div>

                {/* Step-by-step guide */}
                <Collapsible className="sm:col-span-2">
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="outline"
                      className="group w-full justify-between font-normal"
                    >
                      <span className="flex items-center gap-2">
                        <ShieldCheck className="size-4 text-primary" />
                        How to create your own free API key (2 minutes)
                      </span>
                      <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-3 rounded-md border bg-muted/30 p-4">
                      <div className="relative space-y-5 before:absolute before:left-[11px] before:top-2 before:h-[calc(100%-16px)] before:w-px before:bg-border">
                        {API_KEY_STEPS.map((step, i) => (
                          <div key={i} className="relative flex gap-3">
                            <div className="z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-semibold text-primary">
                              {i + 1}
                            </div>
                            <div className="min-w-0 pt-0.5">
                              <p className="text-sm font-medium leading-none">
                                {step.title}
                              </p>
                              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                {step.body}
                              </p>
                              {step.link && (
                                <Button
                                  asChild
                                  size="sm"
                                  variant="outline"
                                  className="mt-1.5 h-7 text-xs"
                                >
                                  <a
                                    href={step.link.href}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <ExternalLink className="size-3" />
                                    {step.link.label}
                                  </a>
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="mt-4 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
                        Why use your own key? The free tier&apos;s rate limits
                        apply per key — with your own, discovery scoring and
                        email drafting never compete with anyone else. Revoke it
                        anytime at aistudio.google.com/apikey; stored copies are
                        AES-256 encrypted and never sent to the browser.
                      </p>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label>API key {s.geminiApiKeyMasked ? "(leave blank to keep)" : ""}</Label>
                  <Input
                    type="password"
                    placeholder="AIza…"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Fast model (extraction/classification)</Label>
                  <Select value={s.aiFastModel} onValueChange={(v) => setS({ ...s, aiFastModel: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemini-flash-lite-latest">gemini-flash-lite-latest (auto-updates)</SelectItem>
                      <SelectItem value="gemini-flash-latest">gemini-flash-latest (auto-updates)</SelectItem>
                      <SelectItem value="gemini-3.1-flash-lite">gemini-3.1-flash-lite</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Smart model (generation)</Label>
                  <Select value={s.aiSmartModel} onValueChange={(v) => setS({ ...s, aiSmartModel: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemini-flash-latest">gemini-flash-latest (auto-updates)</SelectItem>
                      <SelectItem value="gemini-pro-latest">gemini-pro-latest (auto-updates)</SelectItem>
                      <SelectItem value="gemini-3.5-flash">gemini-3.5-flash</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Daily AI call budget</Label>
                  <Input
                    type="number" min={1} max={2000}
                    value={s.aiDailyBudget}
                    onChange={(e) => setS({ ...s, aiDailyBudget: Number(e.target.value) })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Keeps usage inside the free tier.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── Follow-ups ─── */}
          <TabsContent value="followups" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Follow-up rules</CardTitle>
                <CardDescription>
                  Drafts are generated automatically when there&apos;s no reply.
                  They only send automatically if you enable it below.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>First follow-up after (days)</Label>
                  <Input
                    type="number" min={1} max={60}
                    value={s.followUpAfterDays}
                    onChange={(e) => setS({ ...s, followUpAfterDays: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Second follow-up after (days)</Label>
                  <Input
                    type="number" min={1} max={60}
                    value={s.secondFollowUpDays}
                    onChange={(e) => setS({ ...s, secondFollowUpDays: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Max follow-ups per application</Label>
                  <Input
                    type="number" min={0} max={3}
                    value={s.maxFollowUps}
                    onChange={(e) => setS({ ...s, maxFollowUps: Number(e.target.value) })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
                  <div>
                    <p className="text-sm font-medium">Auto-send follow-ups</p>
                    <p className="text-xs text-muted-foreground">
                      Off = follow-ups wait in the approval queue (recommended).
                    </p>
                  </div>
                  <Switch
                    checked={s.autoSendFollowUps}
                    onCheckedChange={(v) => setS({ ...s, autoSendFollowUps: v })}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── Job Sources ─── */}
          <TabsContent value="sources" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Automated sources</CardTitle>
                <CardDescription>
                  Discovery runs every few hours over public APIs. LinkedIn &
                  Wellfound don&apos;t allow scraping — use Import on the Jobs
                  page for those.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { key: "remoteok", label: "RemoteOK", desc: "Remote jobs via public API", listKey: "tags", listLabel: "Filter tags (optional)", placeholder: "typescript, backend, ai" },
                  { key: "hnWhoIsHiring", label: "HN Who is Hiring (YC ecosystem)", desc: "Monthly thread via Algolia public API", listKey: "keywords", listLabel: "Filter keywords (optional)", placeholder: "react, remote, senior" },
                  { key: "greenhouse", label: "Greenhouse boards", desc: "Company board tokens you follow", listKey: "boards", listLabel: "Board tokens", placeholder: "stripe, vercel, openai" },
                  { key: "lever", label: "Lever postings", desc: "Company site names you follow", listKey: "sites", listLabel: "Site names", placeholder: "netflix, plaid" },
                  { key: "ashby", label: "Ashby job boards", desc: "Board names you follow", listKey: "boards", listLabel: "Board names", placeholder: "linear, ramp" },
                  { key: "careerPages", label: "Career pages", desc: "Any careers URL — AI extracts openings", listKey: "urls", listLabel: "Page URLs", placeholder: "https://company.com/careers" },
                ].map((src) => {
                  const cfg = (sources[src.key] ?? {}) as Record<string, unknown>;
                  const enabled = Boolean(cfg.enabled);
                  return (
                    <div key={src.key} className="rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{src.label}</p>
                          <p className="text-xs text-muted-foreground">{src.desc}</p>
                        </div>
                        <Switch
                          checked={enabled}
                          onCheckedChange={(v) => patchSources(src.key, { enabled: v })}
                        />
                      </div>
                      {enabled && (
                        <div className="mt-2 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs">{src.listLabel}</Label>
                            {INDIA_SUGGESTED_BOARDS[src.key] && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[11px]"
                                onClick={() => {
                                  const current = (cfg[src.listKey] as string[] | undefined) ?? [];
                                  const merged = [
                                    ...new Set([...current, ...INDIA_SUGGESTED_BOARDS[src.key]]),
                                  ];
                                  patchSources(src.key, { [src.listKey]: merged });
                                }}
                              >
                                + Add India-verified boards
                              </Button>
                            )}
                          </div>
                          <Input
                            className="h-8 text-sm"
                            placeholder={src.placeholder}
                            value={csv(cfg[src.listKey] as string[] | undefined)}
                            onChange={(e) =>
                              patchSources(src.key, { [src.listKey]: parseCsv(e.target.value) })
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── Preferences ─── */}
          <TabsContent value="prefs" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Job preferences & schedule</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Preferred roles (comma-separated)</Label>
                  <Input
                    placeholder="Software Engineer, Backend Engineer, AI Engineer"
                    value={csv(s.preferredRoles)}
                    onChange={(e) => setS({ ...s, preferredRoles: parseCsv(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Preferred locations</Label>
                  <Input
                    placeholder="Remote, Bangalore, Mumbai"
                    value={csv(s.preferredLocations)}
                    onChange={(e) => setS({ ...s, preferredLocations: parseCsv(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Preferred technologies</Label>
                  <Input
                    placeholder="TypeScript, React, Node.js, Python"
                    value={csv(s.preferredTech)}
                    onChange={(e) => setS({ ...s, preferredTech: parseCsv(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Time zone (IANA)</Label>
                  <Input
                    placeholder="Asia/Kolkata"
                    value={s.timezone}
                    onChange={(e) => setS({ ...s, timezone: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Send from (hour)</Label>
                    <Input
                      type="number" min={0} max={23}
                      value={s.workingHoursStart}
                      onChange={(e) => setS({ ...s, workingHoursStart: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>until (hour)</Label>
                    <Input
                      type="number" min={1} max={24}
                      value={s.workingHoursEnd}
                      onChange={(e) => setS({ ...s, workingHoursEnd: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="max-w-3xl">
          <Button
            onClick={() =>
              save.mutate({
                ...(geminiKey ? { geminiApiKey: geminiKey } : {}),
                aiFastModel: s.aiFastModel,
                aiSmartModel: s.aiSmartModel,
                aiDailyBudget: s.aiDailyBudget,
                sendMode: s.sendMode,
                dailyEmailLimit: s.dailyEmailLimit,
                minSendGapMinutes: s.minSendGapMinutes,
                sendJitterMinutes: s.sendJitterMinutes,
                autoApproveThreshold: s.autoApproveThreshold,
                autoDraftEnabled: s.autoDraftEnabled,
                autoDraftThreshold: s.autoDraftThreshold,
                emailSignature: s.emailSignature,
                followUpAfterDays: s.followUpAfterDays,
                secondFollowUpDays: s.secondFollowUpDays,
                maxFollowUps: s.maxFollowUps,
                autoSendFollowUps: s.autoSendFollowUps,
                preferredRoles: s.preferredRoles,
                preferredLocations: s.preferredLocations,
                preferredTech: s.preferredTech,
                timezone: s.timezone,
                workingHoursStart: s.workingHoursStart,
                workingHoursEnd: s.workingHoursEnd,
                jobSources: s.jobSources ?? {},
              })
            }
            disabled={save.isPending}
          >
            {save.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Save all settings
          </Button>
        </div>
      </main>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}
