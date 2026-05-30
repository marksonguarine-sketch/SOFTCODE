/**
 * Notification bell — header dropdown.
 *
 * • Polls /api/notifications every 15 s as a safety net and listens for
 *   socket "NOTIFICATION_NEW" events so the badge updates within milliseconds.
 * • Unread count shown as a red badge. When the user opens the menu we
 *   mark everything that's currently in view as read.
 * • If a new notif arrives while the menu is closed, the bell pulses
 *   with an exclamation point — matches the "POP OUT LIKE EXCLAMATION
 *   POINT" requirement from REQUEST.pdf round 4.
 * • Categories ([REQUEST]/[ORDER]/[PAYMENT]/[INVENTORY]/[DELIVERY]/
 *   [RESERVATION]/[SYSTEM]) get colored chips so the list is easy to scan.
 * • Each item has an "Open" button that navigates to the deep-link.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Bell, AlertCircle, X, CheckCheck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { io, type Socket } from "socket.io-client";

interface Notif {
  _id: string;
  category: string;
  title: string;
  body: string;
  link: string;
  recipientUsername: string;
  recipientRole: string;
  readBy: string[];
  isRead: boolean;
  createdAt: string;
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  REQUEST: { bg: "bg-amber-100 dark:bg-amber-950/50", text: "text-amber-800 dark:text-amber-300", border: "border-amber-300 dark:border-amber-800" },
  ORDER: { bg: "bg-blue-100 dark:bg-blue-950/50", text: "text-blue-800 dark:text-blue-300", border: "border-blue-300 dark:border-blue-800" },
  PAYMENT: { bg: "bg-emerald-100 dark:bg-emerald-950/50", text: "text-emerald-800 dark:text-emerald-300", border: "border-emerald-300 dark:border-emerald-800" },
  INVENTORY: { bg: "bg-purple-100 dark:bg-purple-950/50", text: "text-purple-800 dark:text-purple-300", border: "border-purple-300 dark:border-purple-800" },
  DELIVERY: { bg: "bg-cyan-100 dark:bg-cyan-950/50", text: "text-cyan-800 dark:text-cyan-300", border: "border-cyan-300 dark:border-cyan-800" },
  RESERVATION: { bg: "bg-teal-100 dark:bg-teal-950/50", text: "text-teal-800 dark:text-teal-300", border: "border-teal-300 dark:border-teal-800" },
  SYSTEM: { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-700 dark:text-slate-300", border: "border-slate-300 dark:border-slate-700" },
};

function timeAgo(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Math.max(0, (Date.now() - d) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function NotificationBell() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const { data } = useQuery<{ success: boolean; data: { notifications: Notif[]; unreadCount: number } }>({
    queryKey: ["/api/notifications"],
    enabled: !!user,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const notifications = data?.data?.notifications || [];
  const unread = data?.data?.unreadCount || 0;

  // Listen for live notifications via socket — pulse the bell when one lands.
  useEffect(() => {
    if (!user) return;
    const socket = io({ transports: ["websocket", "polling"] });
    socketRef.current = socket;
    socket.on("NOTIFICATION_NEW", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      setPulse(true);
      setTimeout(() => setPulse(false), 2500);
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user]);

  // Mark every visible notif as read when the menu opens.
  const readAll = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notifications/read-all"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && unread > 0) {
      // Defer so the user sees the unread count for a beat first.
      setTimeout(() => readAll.mutate(), 400);
    }
    if (next) setPulse(false);
  }

  const grouped = useMemo(() => {
    const map = new Map<string, Notif[]>();
    for (const n of notifications) {
      if (!map.has(n.category)) map.set(n.category, []);
      map.get(n.category)!.push(n);
    }
    return Array.from(map.entries());
  }, [notifications]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "relative inline-flex items-center justify-center w-9 h-9 rounded-md hover:bg-accent transition-colors",
            pulse && "animate-bounce text-amber-500",
          )}
          data-testid="button-notification-bell"
          aria-label="Notifications"
        >
          <Bell className="w-4 h-4" />
          {pulse && (
            <AlertCircle className="w-3 h-3 absolute -top-0.5 -right-0.5 text-red-500 fill-red-500 animate-ping" />
          )}
          {unread > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 tabular-nums"
              data-testid="badge-notif-count"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div>
            <p className="text-sm font-semibold">Notifications</p>
            <p className="text-[11px] text-muted-foreground">{notifications.length} total · {unread} unread</p>
          </div>
          {unread > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              onClick={() => readAll.mutate()}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="w-3 h-3 mr-1" /> Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-[420px]">
          {notifications.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              <Bell className="w-7 h-7 mx-auto mb-2 text-muted-foreground/50" />
              You're all caught up.
            </div>
          ) : (
            <div className="divide-y">
              {grouped.map(([category, items]) => {
                const style = CATEGORY_STYLES[category] || CATEGORY_STYLES.SYSTEM;
                return (
                  <div key={category}>
                    <div className={cn("px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider", style.bg, style.text)}>
                      [{category}] · {items.length}
                    </div>
                    {items.map((n) => (
                      <div
                        key={n._id}
                        className={cn(
                          "px-3 py-2.5 hover:bg-muted/40 transition-colors border-l-2",
                          n.isRead ? "border-transparent opacity-75" : style.border,
                        )}
                        data-testid={`notif-${n._id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className={cn("text-sm leading-snug", !n.isRead && "font-semibold")}>{n.title}</p>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap mt-0.5">{timeAgo(n.createdAt)}</span>
                        </div>
                        {n.body && <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{n.body}</p>}
                        {n.link && (
                          <div className="mt-1.5 flex justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[11px]"
                              onClick={() => {
                                apiRequest("POST", `/api/notifications/${n._id}/read`);
                                setOpen(false);
                                navigate(n.link);
                              }}
                              data-testid={`button-open-notif-${n._id}`}
                            >
                              Open <X className="w-2.5 h-2.5 ml-1 rotate-45" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
