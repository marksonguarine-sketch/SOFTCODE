import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ScrollText, Search, X, Calendar, ChevronLeft, ChevronRight,
  LogIn, LogOut, Clock, List, ChevronDown,
} from "lucide-react";
import type { ISystemLog } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatReadableDescription(log: ISystemLog): string {
  const { action, actor, target, metadata } = log;
  const meta = metadata || {};
  switch (action) {
    case "INVENTORY_LOG_CREATED": {
      const type = meta.type || "adjust";
      const qty = meta.quantity ?? 0;
      return `${actor} ${type}ed ${Math.abs(qty)} from ${target}`;
    }
    case "USER_LOGIN":  return `${actor} logged in`;
    case "USER_LOGOUT": return `${actor} logged out`;
    case "ORDER_CREATED": {
      const total = meta.totalAmount;
      const ts = total != null ? ` (total: ${fmtPHP(total)})` : "";
      return `${actor} created order ${target}${ts}`;
    }
    case "PAYMENT_LOGGED": {
      const amount = meta.amount ?? meta.amountPaid;
      const as_ = amount != null ? ` (amount: ${fmtPHP(amount)})` : "";
      return `${actor} logged payment for order ${target}${as_}`;
    }
    case "ITEM_CREATED":        return `${actor} added new item ${target}`;
    case "USER_CREATED": {
      const role = meta.role || "";
      return `${actor} created user ${target}${role ? ` (role: ${role})` : ""}`;
    }
    case "SETTINGS_CHANGED":    return `${actor} updated system settings`;
    case "ITEM_PRICE_ADJUSTED": {
      const price = meta.unitPrice;
      const ps = price != null ? ` to ${fmtPHP(price)}` : "";
      return `${actor} adjusted price of ${target}${ps}`;
    }
    default:
      return `${actor} performed ${action}${target ? ` on ${target}` : ""}`;
  }
}

function fmtPHP(v: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v);
}

function getActionColor(action: string): "default" | "secondary" | "destructive" | "outline" {
  if (action.includes("LOGIN") || action.includes("LOGOUT")) return "secondary";
  if (action.includes("CREATED")) return "default";
  if (action.includes("PAYMENT")) return "default";
  if (action.includes("ADJUSTED") || action.includes("CHANGED")) return "outline";
  if (action.includes("INVENTORY")) return "secondary";
  return "outline";
}

function formatMetadataKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/[_-]/g, " ").replace(/^\w/, (c) => c.toUpperCase()).trim();
}
function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDateTime(d: string) {
  return new Date(d).toLocaleString("en-PH", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}
function formatTime(d: string) {
  return new Date(d).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ─── Calendar View for User Logs ─────────────────────────────────────────────

interface DayLoginData {
  dateStr: string; // "YYYY-MM-DD"
  loginCount: number;
  logoutCount: number;
  events: ISystemLog[];
}

function buildCalendarData(userLogs: ISystemLog[]): Record<string, DayLoginData> {
  const map: Record<string, DayLoginData> = {};
  userLogs.forEach((log) => {
    const d = new Date(log.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!map[key]) map[key] = { dateStr: key, loginCount: 0, logoutCount: 0, events: [] };
    if (log.action === "USER_LOGIN") map[key].loginCount++;
    else if (log.action === "USER_LOGOUT") map[key].logoutCount++;
    map[key].events.push(log);
  });
  return map;
}

function CalendarUserLog({ userLogs, targetUsername }: { userLogs: ISystemLog[]; targetUsername?: string }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-based
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [orderPage, setOrderPage] = useState(1);
  const ORDER_PAGE_SIZE = 5;

  const calData = useMemo(() => buildCalendarData(userLogs), [userLogs]);

  // Build calendar grid
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay(); // 0=Sun
  const daysInMonth = lastDay.getDate();

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1);
    setSelectedDay(null);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1);
    setSelectedDay(null);
  };

  const monthLabel = new Date(year, month, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  const dayData = selectedDay ? calData[selectedDay] : null;

  // Order process events for selected day
  const orderEvents = useMemo(() => {
    if (!dayData) return [];
    // "Order process" = login/logout events sorted by time
    return [...dayData.events].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [dayData]);

  const totalOrderPages = Math.ceil(orderEvents.length / ORDER_PAGE_SIZE);
  const paginatedOrderEvents = orderEvents.slice((orderPage - 1) * ORDER_PAGE_SIZE, orderPage * ORDER_PAGE_SIZE);

  // Grid cells: empty slots + day numbers
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="text-base font-semibold">{monthLabel}</h3>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Day of week headers */}
      <div className="grid grid-cols-7 gap-1">
        {DOW.map((d) => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
        ))}
        {cells.map((day, idx) => {
          if (day === null) return <div key={`empty-${idx}`} />;
          const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const data = calData[key];
          const isToday_ = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
          const isSelected = selectedDay === key;
          const hasActivity = !!data;

          return (
            <button
              key={key}
              onClick={() => { setSelectedDay(isSelected ? null : key); setOrderPage(1); }}
              className={`
                relative rounded-lg p-1 min-h-[52px] flex flex-col items-center transition-colors border text-sm
                ${isSelected ? "border-primary bg-primary/10" : hasActivity ? "border-primary/30 bg-primary/5 hover:bg-primary/10" : "border-transparent hover:bg-muted/40"}
                ${isToday_ ? "ring-1 ring-primary ring-offset-1" : ""}
              `}
            >
              <span className={`font-medium text-xs ${isToday_ ? "text-primary" : ""}`}>{day}</span>
              {data && (
                <div className="mt-0.5 space-y-0.5 w-full">
                  {data.loginCount > 0 && (
                    <div className="flex items-center justify-center gap-0.5">
                      <LogIn className="h-2.5 w-2.5 text-green-500" />
                      <span className="text-[9px] text-green-600 font-bold">{data.loginCount}</span>
                    </div>
                  )}
                  {data.logoutCount > 0 && (
                    <div className="flex items-center justify-center gap-0.5">
                      <LogOut className="h-2.5 w-2.5 text-red-400" />
                      <span className="text-[9px] text-red-500 font-bold">{data.logoutCount}</span>
                    </div>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1"><LogIn className="h-3 w-3 text-green-500" />Login</div>
        <div className="flex items-center gap-1"><LogOut className="h-3 w-3 text-red-400" />Logout</div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded border border-primary bg-primary/5" />Has activity</div>
      </div>

      {/* Day detail */}
      {dayData && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
              <Calendar className="h-4 w-4 text-primary flex-shrink-0" />
              <span className="flex-1 min-w-0">
                {targetUsername ? (
                  <><strong>{targetUsername}</strong>'s activity · </>
                ) : null}
                {new Date(selectedDay!).toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
              </span>
              <Badge variant="outline" className="ml-auto">{dayData.events.length} event{dayData.events.length !== 1 ? "s" : ""}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-green-600">
                <LogIn className="h-3.5 w-3.5" /><span className="font-medium">{dayData.loginCount} login{dayData.loginCount !== 1 ? "s" : ""}</span>
              </div>
              <div className="flex items-center gap-1.5 text-red-500">
                <LogOut className="h-3.5 w-3.5" /><span className="font-medium">{dayData.logoutCount} logout{dayData.logoutCount !== 1 ? "s" : ""}</span>
              </div>
            </div>

            {/* Paginated events list */}
            <div className="space-y-1.5">
              {paginatedOrderEvents.map((ev) => (
                <div key={ev._id} className="flex items-start gap-2 text-xs p-2 rounded-md bg-muted/40">
                  {ev.action === "USER_LOGIN"
                    ? <LogIn className="h-3.5 w-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                    : <LogOut className="h-3.5 w-3.5 text-red-400 flex-shrink-0 mt-0.5" />}
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{ev.actor}</span>
                    <span className="text-muted-foreground ml-1">{ev.action === "USER_LOGIN" ? "logged in" : "logged out"}</span>
                  </div>
                  <span className="text-muted-foreground flex-shrink-0">{formatTime(ev.createdAt)}</span>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalOrderPages > 1 && (
              <div className="flex items-center justify-between">
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={orderPage === 1} onClick={() => setOrderPage(p => p - 1)}>
                  <ChevronLeft className="h-3 w-3 mr-1" />Prev
                </Button>
                <span className="text-xs text-muted-foreground">
                  {(orderPage - 1) * ORDER_PAGE_SIZE + 1}–{Math.min(orderPage * ORDER_PAGE_SIZE, orderEvents.length)} of {orderEvents.length}
                </span>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={orderPage === totalOrderPages} onClick={() => setOrderPage(p => p + 1)}>
                  Next<ChevronRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SystemLogsPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<"all" | "user-log">("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedLog, setSelectedLog] = useState<ISystemLog | null>(null);
  const [page, setPage] = useState(1);
  const [targetUser, setTargetUser] = useState<string>(""); // for User Log target selector
  const perPage = 20;
  const searchRef = useRef<HTMLDivElement>(null);

  // Users list for the target dropdown (admin can inspect any user)
  const { data: usersData } = useQuery<{ success: boolean; data: Array<{ username: string; role: string }> }>({
    queryKey: ["/api/users/simple"],
    enabled: isAdmin,
  });
  const allUsers = usersData?.data || [];

  const { data: logsData, isLoading } = useQuery<{
    success: boolean;
    data: { logs: ISystemLog[]; total: number };
  }>({ queryKey: ["/api/system-logs"] });

  const logs = logsData?.data?.logs || [];

  // Separate user logs and regular logs
  const userLogs = useMemo(() => logs.filter((l) => l.action === "USER_LOGIN" || l.action === "USER_LOGOUT"), [logs]);
  const nonUserLogs = useMemo(() => logs.filter((l) => l.action !== "USER_LOGIN" && l.action !== "USER_LOGOUT"), [logs]);

  const actions = useMemo(() => Array.from(new Set(nonUserLogs.map((l) => l.action))), [nonUserLogs]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowSuggestions(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    let result = actionFilter === "all" ? nonUserLogs : nonUserLogs.filter((l) => l.action === actionFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (l) => l.actor.toLowerCase().includes(q) || l.action.toLowerCase().includes(q) || (l.target && l.target.toLowerCase().includes(q))
      );
    }
    return result;
  }, [nonUserLogs, actionFilter, searchQuery]);

  const suggestions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();
    const actorMatches = Array.from(new Set(logs.map((l) => l.actor))).filter((a) => a.toLowerCase().includes(q)).map((a) => ({ type: "Actor", value: a }));
    const targetMatches = Array.from(new Set(logs.map((l) => l.target).filter(Boolean))).filter((t) => t.toLowerCase().includes(q)).map((t) => ({ type: "Target", value: t }));
    const actionMatches = actions.filter((a) => a.toLowerCase().includes(q)).map((a) => ({ type: "Action", value: a }));
    return [...actorMatches, ...targetMatches, ...actionMatches].slice(0, 8);
  }, [logs, actions, searchQuery]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  if (!isAdmin) {
    return (
      <div className="p-3 sm:p-6 flex items-center justify-center h-full">
        <p className="text-muted-foreground">Access denied. Admin only.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 overflow-auto h-full">
        <h1 className="text-2xl font-bold">System Logs</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 overflow-auto h-full">
      <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-logs-title">System Logs</h1>

      <Tabs value={tab} onValueChange={(v) => { setTab(v as "all" | "user-log"); setPage(1); }}>
        <TabsList>
          <TabsTrigger value="all" className="gap-1.5">
            <List className="h-3.5 w-3.5" />
            All Logs
            <Badge variant="secondary" className="text-[10px] h-4 px-1">{nonUserLogs.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="user-log" className="gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            User Log
            <Badge variant="secondary" className="text-[10px] h-4 px-1">{userLogs.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* ── All Logs Tab ── */}
        <TabsContent value="all" className="space-y-4 mt-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-md" ref={searchRef}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by actor, action, or target..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setShowSuggestions(true); setPage(1); }}
                onFocus={() => searchQuery && setShowSuggestions(true)}
                className="pl-9"
                data-testid="input-search-logs"
              />
              {searchQuery && (
                <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => { setSearchQuery(""); setShowSuggestions(false); setPage(1); }}
                  data-testid="button-clear-log-search">
                  <X className="h-3 w-3" />
                </Button>
              )}
              {showSuggestions && suggestions.length > 0 && (
                <Card className="absolute z-50 top-full left-0 right-0 mt-1">
                  <CardContent className="p-1">
                    {suggestions.map((s, i) => (
                      <button key={`${s.type}-${s.value}-${i}`}
                        className="w-full text-left px-3 py-2 text-sm rounded-md flex items-center gap-2 hover:bg-accent"
                        onClick={() => { setSearchQuery(s.value); setShowSuggestions(false); setPage(1); }}
                        data-testid={`suggestion-log-${i}`}>
                        <Badge variant="secondary" className="text-xs">{s.type}</Badge>
                        <span>{s.value}</span>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>

            <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[200px]" data-testid="select-action-filter">
                <SelectValue placeholder="All Actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {actions.map((action) => (
                  <SelectItem key={action} value={action}>{action}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-sm text-muted-foreground" data-testid="text-log-count">{filtered.length} entries</span>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No logs found</TableCell></TableRow>
                  ) : paginated.map((log) => (
                    <TableRow key={log._id} className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setSelectedLog(log)} data-testid={`row-log-${log._id}`}>
                      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">{formatDateTime(log.createdAt)}</TableCell>
                      <TableCell>
                        <Badge variant={getActionColor(log.action)} className="text-xs">{log.action}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{formatReadableDescription(log)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)} data-testid="button-prev-page">Previous</Button>
              <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(page + 1)} data-testid="button-next-page">Next</Button>
            </div>
          )}
        </TabsContent>

        {/* ── User Log Tab (Calendar) ── */}
        <TabsContent value="user-log" className="mt-4">
          {/* Target user selector — admin picks anyone, including themselves */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Inspect activity for:
            </label>
            <Select value={targetUser || "__none__"} onValueChange={(v) => setTargetUser(v === "__none__" ? "" : v)}>
              <SelectTrigger className="w-[240px] h-9" data-testid="select-target-user">
                <SelectValue placeholder="Choose user…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Select a user —</SelectItem>
                {allUsers.map((u) => (
                  <SelectItem key={u.username} value={u.username}>
                    {u.username} ({u.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {targetUser && (
              <span className="text-xs text-muted-foreground">
                Showing logins/logouts for <strong className="text-foreground">{targetUser}</strong>
              </span>
            )}
          </div>

          {!targetUser ? (
            <Card>
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
                Select a user above to see their login/logout calendar.
              </CardContent>
            </Card>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground mb-4">
                Click a day to see <strong>{targetUser}</strong>'s login / logout events.
                Green dots = logins, red dots = logouts.
              </p>
              <CalendarUserLog
                userLogs={userLogs.filter((l) => l.actor === targetUser)}
                targetUsername={targetUser}
              />
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Log detail dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent data-testid="dialog-log-detail">
          <DialogHeader><DialogTitle>Log Detail</DialogTitle></DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-muted-foreground">Timestamp</p><p className="font-medium">{formatDateTime(selectedLog.createdAt)}</p></div>
                <div><p className="text-muted-foreground">Action</p><Badge variant={getActionColor(selectedLog.action)}>{selectedLog.action}</Badge></div>
                <div><p className="text-muted-foreground">Actor</p><p className="font-medium">{selectedLog.actor}</p></div>
                <div><p className="text-muted-foreground">Target</p><p className="font-medium">{selectedLog.target || "-"}</p></div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Description</p>
                <p className="text-sm font-medium">{formatReadableDescription(selectedLog)}</p>
              </div>
              {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Metadata</p>
                  <div className="rounded-md border">
                    {Object.entries(selectedLog.metadata).map(([key, value], idx) => (
                      <div key={key} className={`flex items-start gap-4 px-3 py-2 text-sm ${idx > 0 ? "border-t" : ""}`} data-testid={`metadata-${key}`}>
                        <span className="text-muted-foreground min-w-[120px]">{formatMetadataKey(key)}</span>
                        <span className="font-medium break-all">{formatMetadataValue(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
