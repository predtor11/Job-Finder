"use client";

import { useState } from "react";
import { FlaskConical, Mail, Plus, Trash2 } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useApiQuery, useApiMutation } from "@/hooks/use-api";
import { toast } from "sonner";

interface TemplateRow {
  id: string;
  name: string;
  type: string;
  subject: string;
  body: string;
  abGroup: string | null;
  active: boolean;
  _count: { emails: number };
}

const EMPTY_FORM = {
  name: "", type: "APPLICATION", subject: "", body: "", abGroup: "",
};

export default function TemplatesPage() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data, isLoading } = useApiQuery<{ templates: TemplateRow[] }>(
    ["templates"],
    "/api/templates"
  );

  const create = useApiMutation<void>("POST", () => "/api/templates", {
    body: () => ({
      name: form.name,
      type: form.type,
      subject: form.subject,
      body: form.body,
      ...(form.abGroup ? { abGroup: form.abGroup } : {}),
    }),
    invalidate: [["templates"]],
    onSuccess: () => {
      setOpen(false);
      setForm(EMPTY_FORM);
      toast.success("Template created");
    },
  });
  const toggle = useApiMutation<{ id: string; active: boolean }>(
    "PATCH",
    (v) => `/api/templates/${v.id}`,
    {
      body: (v) => ({ active: v.active }),
      invalidate: [["templates"]],
    }
  );
  const remove = useApiMutation<string>("DELETE", (id) => `/api/templates/${id}`, {
    invalidate: [["templates"]],
    successMessage: "Template deleted",
  });

  const templates = data?.templates ?? [];

  return (
    <>
      <Topbar title="Templates" />
      <main className="flex-1 space-y-4 p-4 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Templates guide the AI&apos;s tone and structure — wording is always
            written fresh per email. Give two templates the same{" "}
            <span className="font-medium">A/B group</span> to split-test them;
            results appear in Analytics.
          </p>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="size-3.5" /> New template
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>New template</DialogTitle>
                <DialogDescription>
                  Use {"{{company}}, {{role}}, {{recruiterName}}, {{myName}}"} as
                  placeholders — the AI substitutes real details.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Name *</Label>
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Type</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="APPLICATION">Application</SelectItem>
                        <SelectItem value="COLD_OUTREACH">Cold outreach</SelectItem>
                        <SelectItem value="FOLLOW_UP">Follow-up</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Subject *</Label>
                  <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Body *</Label>
                  <Textarea rows={8} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <FlaskConical className="size-3.5" /> A/B group (optional)
                  </Label>
                  <Input
                    placeholder="e.g. outreach-v1"
                    value={form.abGroup}
                    onChange={(e) => setForm({ ...form, abGroup: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => create.mutate()}
                  disabled={!form.name || !form.subject || !form.body || create.isPending}
                >
                  Create template
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : templates.length === 0 ? (
          <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
            <Mail className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No templates</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Optional — without templates the AI writes fully free-form emails.
              Add templates to steer structure and A/B test approaches.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {templates.map((t) => (
              <Card key={t.id} className="gap-2 py-4">
                <CardHeader className="px-4">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm">{t.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      {t.abGroup && (
                        <Badge variant="secondary" className="gap-1 text-[10px]">
                          <FlaskConical className="size-2.5" /> {t.abGroup}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">
                        {t.type.replace(/_/g, " ").toLowerCase()}
                      </Badge>
                      <Switch
                        checked={t.active}
                        onCheckedChange={(active) => toggle.mutate({ id: t.id, active })}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    “{t.subject}” · used {t._count.emails}×
                  </p>
                </CardHeader>
                <CardContent className="px-4">
                  <p className="line-clamp-4 whitespace-pre-wrap rounded-md bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
                    {t.body}
                  </p>
                  <Button
                    size="sm" variant="ghost" className="mt-2 h-7 text-xs text-destructive"
                    onClick={() => remove.mutate(t.id)}
                  >
                    <Trash2 className="size-3" /> Delete
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
