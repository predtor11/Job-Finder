"use client";

import { Bell, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useApiQuery, useApiMutation } from "@/hooks/use-api";
import { cn } from "@/lib/utils";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export function Topbar({ title }: { title?: string }) {
  const { data } = useApiQuery<{
    notifications: NotificationRow[];
    unreadCount: number;
  }>(["notifications"], "/api/notifications", { refetchInterval: 60_000 });

  const markRead = useApiMutation<void>("PATCH", () => "/api/notifications", {
    body: () => ({ markAllRead: true }),
    invalidate: [["notifications"]],
  });

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      {title && (
        <h1 className="text-sm font-medium tracking-tight">{title}</h1>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="hidden h-8 w-56 justify-start gap-2 text-muted-foreground md:flex"
          onClick={() =>
            document.dispatchEvent(
              new KeyboardEvent("keydown", { key: "k", ctrlKey: true })
            )
          }
        >
          <Search className="size-3.5" />
          <span className="text-xs">Search…</span>
          <kbd className="pointer-events-none ml-auto rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </Button>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative h-8 w-8">
              <Bell className="size-4" />
              {(data?.unreadCount ?? 0) > 0 && (
                <span className="absolute right-1 top-1 flex size-2 rounded-full bg-primary" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96 p-0">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <p className="text-sm font-medium">Notifications</p>
              {(data?.unreadCount ?? 0) > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => markRead.mutate()}
                >
                  Mark all read
                </Button>
              )}
            </div>
            <ScrollArea className="h-80">
              {data?.notifications.length ? (
                <div className="divide-y">
                  {data.notifications.map((n) => (
                    <Link
                      key={n.id}
                      href={n.link ?? "#"}
                      className={cn(
                        "block px-4 py-3 transition-colors hover:bg-accent",
                        !n.read && "bg-primary/[0.03]"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {!n.read && (
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {n.title}
                          </p>
                          {n.body && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {n.body}
                            </p>
                          )}
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {formatDistanceToNow(new Date(n.createdAt), {
                              addSuffix: true,
                            })}
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className="ml-auto shrink-0 text-[10px]"
                        >
                          {n.type.replace(/_/g, " ").toLowerCase()}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  No notifications yet
                </p>
              )}
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
}
