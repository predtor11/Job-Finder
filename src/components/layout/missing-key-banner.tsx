"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApiQuery } from "@/hooks/use-api";

/**
 * Shown on every app page until the user configures their own Gemini API key.
 * There is no shared fallback key — AI features are off until this is done.
 */
export function MissingKeyBanner() {
  const pathname = usePathname();
  const { data, isLoading } = useApiQuery<{
    settings: { geminiApiKeyMasked: string | null };
  }>(["settings"], "/api/settings", { staleTime: 60_000 });

  if (isLoading || data?.settings.geminiApiKeyMasked) return null;
  if (pathname.startsWith("/settings")) return null; // they're already there

  return (
    <div className="flex items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2">
      <p className="flex items-center gap-2 text-sm">
        <KeyRound className="size-4 shrink-0 text-warning" />
        <span>
          <span className="font-medium">AI features are off</span>
          <span className="text-muted-foreground">
            {" "}— add your own free Gemini API key to enable job scoring, cover
            letters and email drafting. Takes 2 minutes, no card needed.
          </span>
        </span>
      </p>
      <Button asChild size="sm" className="h-7 shrink-0">
        <Link href="/settings?tab=ai">Set up key</Link>
      </Button>
    </div>
  );
}
