import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Status → styled badge. Status colors are reserved for state (never series):
 * informational states stay neutral; good/warning/critical use semantic tints
 * and always ship with the readable label.
 */

const STYLES: Record<string, string> = {
  // application + email lifecycle
  DRAFT: "bg-muted text-muted-foreground",
  PENDING_APPROVAL:
    "bg-warning/15 text-amber-700 dark:text-amber-400 border-warning/20",
  APPROVED: "bg-primary/10 text-primary border-primary/20",
  SCHEDULED: "bg-primary/10 text-primary border-primary/20",
  QUEUED: "bg-primary/10 text-primary border-primary/20",
  SENDING: "bg-primary/10 text-primary border-primary/20",
  SENT: "bg-secondary text-secondary-foreground",
  REPLIED: "bg-success/15 text-emerald-700 dark:text-emerald-400 border-success/20",
  INTERVIEW: "bg-success/15 text-emerald-700 dark:text-emerald-400 border-success/20",
  ASSESSMENT: "bg-primary/10 text-primary border-primary/20",
  OFFER: "bg-success/20 text-emerald-700 dark:text-emerald-300 border-success/30 font-semibold",
  REJECTED: "bg-destructive/10 text-destructive border-destructive/20",
  FAILED: "bg-destructive/10 text-destructive border-destructive/20",
  CANCELLED: "bg-muted text-muted-foreground",
  GHOSTED: "bg-muted text-muted-foreground",
  WITHDRAWN: "bg-muted text-muted-foreground",
  // job statuses
  NEW: "bg-primary/10 text-primary border-primary/20",
  ANALYZED: "bg-secondary text-secondary-foreground",
  SHORTLISTED:
    "bg-warning/15 text-amber-700 dark:text-amber-400 border-warning/20",
  APPLIED: "bg-success/15 text-emerald-700 dark:text-emerald-400 border-success/20",
  ARCHIVED: "bg-muted text-muted-foreground",
  DISMISSED: "bg-muted text-muted-foreground",
  // resumes
  PENDING: "bg-muted text-muted-foreground",
  PARSING: "bg-primary/10 text-primary border-primary/20",
  PARSED: "bg-success/15 text-emerald-700 dark:text-emerald-400 border-success/20",
};

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent text-[11px] font-medium",
        STYLES[status] ?? "bg-muted text-muted-foreground",
        className
      )}
    >
      {status.replace(/_/g, " ").toLowerCase()}
    </Badge>
  );
}

/** Match score chip with calibrated color bands. */
export function MatchScore({ score }: { score: number | null | undefined }) {
  if (score == null)
    return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums",
        score >= 80
          ? "bg-success/15 text-emerald-700 dark:text-emerald-400"
          : score >= 60
            ? "bg-warning/15 text-amber-700 dark:text-amber-400"
            : "bg-muted text-muted-foreground"
      )}
    >
      {score}
    </span>
  );
}
