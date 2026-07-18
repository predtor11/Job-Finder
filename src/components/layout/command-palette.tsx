"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Briefcase,
  FileText,
  Inbox,
  LayoutDashboard,
  Mail,
  Search,
  Send,
  Settings,
  Users,
  PlusCircle,
  RefreshCw,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { api } from "@/hooks/use-api";
import { toast } from "sonner";

/** Global ⌘K / Ctrl+K command palette — navigation + quick actions + search. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    Array<{ id: string; title: string; company: string | null }>
  >([]);
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Debounced global job search.
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const data = await api<{
          jobs: Array<{ id: string; title: string; company: { name: string } | null }>;
        }>(`/api/jobs?q=${encodeURIComponent(query)}&pageSize=6`);
        setResults(
          data.jobs.map((j) => ({
            id: j.id,
            title: j.title,
            company: j.company?.name ?? null,
          }))
        );
      } catch {
        /* ignore */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  async function runDiscovery() {
    setOpen(false);
    toast.promise(api("/api/jobs/discover", { method: "POST" }), {
      loading: "Searching job sources…",
      success: (r) =>
        `Found ${(r as { inserted: number }).inserted} new jobs`,
      error: (e) => String((e as Error).message),
    });
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search jobs, navigate, or run an action…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        {results.length > 0 && (
          <>
            <CommandGroup heading="Jobs">
              {results.map((job) => (
                <CommandItem
                  key={job.id}
                  value={`job-${job.id}-${job.title}`}
                  onSelect={() => go(`/jobs/${job.id}`)}
                >
                  <Search />
                  <span className="truncate">
                    {job.title}
                    {job.company && (
                      <span className="text-muted-foreground"> · {job.company}</span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Actions">
          <CommandItem onSelect={runDiscovery}>
            <RefreshCw /> Run job discovery now
          </CommandItem>
          <CommandItem onSelect={() => go("/jobs?import=1")}>
            <PlusCircle /> Import a job (URL / paste)
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />

        <CommandGroup heading="Go to">
          <CommandItem onSelect={() => go("/dashboard")}>
            <LayoutDashboard /> Dashboard
          </CommandItem>
          <CommandItem onSelect={() => go("/jobs")}>
            <Briefcase /> Jobs
          </CommandItem>
          <CommandItem onSelect={() => go("/applications")}>
            <Send /> Applications
          </CommandItem>
          <CommandItem onSelect={() => go("/emails")}>
            <Inbox /> Approval Queue
          </CommandItem>
          <CommandItem onSelect={() => go("/recruiters")}>
            <Users /> Recruiters
          </CommandItem>
          <CommandItem onSelect={() => go("/resumes")}>
            <FileText /> Resumes
          </CommandItem>
          <CommandItem onSelect={() => go("/templates")}>
            <Mail /> Templates
          </CommandItem>
          <CommandItem onSelect={() => go("/analytics")}>
            <BarChart3 /> Analytics
          </CommandItem>
          <CommandItem onSelect={() => go("/settings")}>
            <Settings /> Settings
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
