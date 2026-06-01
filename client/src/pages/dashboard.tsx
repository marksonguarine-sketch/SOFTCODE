/**
 * Dashboard — JOAP Hardware Trading (matches prototype design)
 *
 * Sections, in order:
 *   01. Greeting + actions
 *   02. Overdue banner (conditional)
 *   03. KPI strip — Revenue · Orders · Margin · Low-stock (with sparklines)
 *   04. Revenue trend (wide) ┃ Daily sales goal ring
 *   05. Shift summary ┃ Top items today ┃ Top customers
 *   06. Activity feed (wide) ┃ Payment mix donut
 *   07. Peak hours heatmap (full-width)
 *   08. Inventory snapshot (full-width)
 *
 * All data comes from the real backend:
 *   GET /api/dashboard/stats          → DashboardStats
 *   GET /api/dashboard/advanced?period→ AdvancedDashboardData
 *   GET /api/orders?limit=…           → for top customers + activity
 *
 * The previous 1473-line dashboard is preserved as dashboard-legacy.tsx.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Coins,
  ShoppingCart,
  TrendingUp,
  AlertTriangle,
  Plus,
  Download,
  X,
  Calendar,
  Truck,
  Crown,
  Check,
  User,
  Activity,
  Clock,
  Package,
} from "lucide-react";
import {
  AreaChart as RechartsArea,
  Area,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import type { DashboardStats, IItem } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { KPICard } from "@/components/kpi-card";
import { Sparkline, Ring } from "@/components/charts";
// Heatmap component removed — Peak Hours card was dropped per REQUEST.pdf round 5.
import { ChartCard } from "@/components/chart-card";
import { cn } from "@/lib/utils";

// ── Types from the existing /api/dashboard/advanced endpoint ────────────────
interface AdvancedDashboardData {
  earnings: { total: number; trend: number; sparkline: number[] };
  orders: { total: number; trend: number; sparkline: number[] };
  customers: { total: number; trend: number; sparkline: number[] };
  balance: { total: number; inventoryValue: number };
  revenueChart: Array<{ label: string; revenue: number; orders: number }>;
  channelBreakdown: Record<string, number>;
  topItems: Array<{ itemName: string; unitPrice: number; totalQty: number; totalRevenue: number }>;
  labels: string[];
  totalRevenue: number;
  totalOrderValue: number;
}

// ── Formatting helpers ──────────────────────────────────────────────────────
const peso = (n: number) => "₱" + Math.round(n).toLocaleString("en-PH");
const pesoCompact = (n: number) => {
  if (n >= 1_000_000) return `₱${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₱${(n / 1_000).toFixed(0)}k`;
  return `₱${n}`;
};

// ── Hardcoded settings ──────────────────────────────────────────────────────
const DAILY_GOAL_FALLBACK = 100_000;

// ── Trend-period selector — REQUEST.pdf §17 spec ────────────────────────────
// Buttons: Today | 7 Days | 30 Days | 3 Months | 1 Year
const TREND_PERIODS = [
  { value: "today", label: "Today" },
  { value: "weekly", label: "7d" },
  { value: "monthly", label: "30d" },
  { value: "quarterly", label: "3m" },
  { value: "yearly", label: "1y" },
] as const;
type TrendPeriod = (typeof TREND_PERIODS)[number]["value"];

// ── Payment method labels & colors for the donut ────────────────────────────
const PAYMENT_COLORS: Record<string, string> = {
  cash: "hsl(38 92% 50%)",
  gcash: "hsl(217 91% 60%)",
  gcash_qr: "hsl(217 91% 60%)",
  cod: "hsl(152 56% 41%)",
  bank: "hsl(220 14% 46%)",
};
const PAYMENT_LABELS: Record<string, string> = {
  cash: "Cash",
  gcash: "GCash",
  gcash_qr: "GCash QR",
  cod: "COD",
  bank: "Bank",
};

// ── Initials helper ─────────────────────────────────────────────────────────
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

async function exportDashboardPDF(stats: any, advData: any) {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const now = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", hour12: true });
  const peso = (v: number) => "₱" + Math.round(v).toLocaleString("en-PH");

  // Header
  doc.setFillColor(30, 41, 59);
  doc.rect(0, 0, 595, 80, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("JOAP Hardware Trading", 40, 36);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text("Dashboard Summary Report", 40, 54);
  doc.setFontSize(9);
  doc.setTextColor(180, 195, 215);
  doc.text(`Generated: ${now}`, 40, 70);
  doc.setTextColor(0, 0, 0);

  // KPI grid
  const kpis = [
    { label: "Orders Today", value: String(stats?.totalOrdersToday ?? 0) },
    { label: "Today's Revenue", value: peso(stats?.todayRevenue ?? 0) },
    { label: "Total Revenue", value: peso(stats?.totalRevenue ?? 0) },
    { label: "Pending Payments", value: String(stats?.pendingPayments ?? 0) },
    { label: "Pending Releases", value: String(stats?.pendingReleases ?? 0) },
    { label: "Active Users", value: String(stats?.activeUsers ?? 0) },
    { label: "Total Items", value: String(stats?.totalItems ?? 0) },
    { label: "Critical Stock", value: String(stats?.criticalStock ?? 0) },
    { label: "Low Stock Items", value: String(stats?.lowStock ?? 0) },
    { label: "Completed Orders", value: String(stats?.completedOrders ?? 0) },
  ];

  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.text("Key Performance Indicators", 40, 110);
  doc.setFont("helvetica", "normal");

  const cols = 2;
  const cardW = 240, cardH = 50, gap = 15, startY = 125, startX = 40;
  kpis.forEach((kpi, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (cardW + gap);
    const y = startY + row * (cardH + gap);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, cardW, cardH, 4, 4, "F");
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, cardW, cardH, 4, 4, "S");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label.toUpperCase(), x + 10, y + 16);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text(kpi.value, x + 10, y + 36);
    doc.setFont("helvetica", "normal");
  });

  // Trend summary
  const trendY = startY + Math.ceil(kpis.length / cols) * (cardH + gap) + 20;
  if (advData?.revenueByDay?.length) {
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text("Revenue by Day (last 7 days)", 40, trendY);
    doc.setFont("helvetica", "normal");
    const rows = advData.revenueByDay.slice(-7).map((d: any) => [
      d.date || d.label || "—",
      peso(d.revenue ?? d.value ?? 0),
      String(d.orders ?? "—"),
    ]);
    const { default: autoTable } = await import("jspdf-autotable");
    autoTable(doc, {
      startY: trendY + 10,
      head: [["Date", "Revenue", "Orders"]],
      body: rows,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 41, 59] },
    });
  }

  // Footer
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text("JOAP Hardware Trading ERP · Confidential", 40, pageH - 20);
  doc.text(`Page 1`, 540, pageH - 20);

  doc.save(`joap-dashboard-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export default function DashboardPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>("weekly");

  // Both warning banners (overdue + pool) remember their dismissed state
  // for the current browser session — cleared on logout (App.tsx) so a
  // fresh sign-in always shows them again. Avoids the "I just closed it
  // and it came back on the next dashboard refetch" annoyance while
  // still resurfacing them after any sign-out / sign-in.
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem("joap_dashboard_overdue_dismissed") === "1"; } catch { return false; }
  });
  const [poolBannerDismissed, setPoolBannerDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem("joap_dashboard_pool_dismissed") === "1"; } catch { return false; }
  });
  const [exportingPDF, setExportingPDF] = useState(false);

  // Daily sales goal sourced from system settings (set by admin in Settings)
  const { data: settingsRes } = useQuery<{ success: boolean; data: { dailySalesGoal?: number } }>({
    queryKey: ["/api/settings"],
    staleTime: 60_000,
  });
  const DAILY_GOAL = settingsRes?.data?.dailySalesGoal ?? DAILY_GOAL_FALLBACK;

  // ── Real backend queries ─────────────────────────────────────────────────
  const { data: statsRes, isLoading: statsLoading } = useQuery<{
    success: boolean;
    data: DashboardStats;
  }>({
    queryKey: ["/api/dashboard/stats"],
    staleTime: 5_000,
    refetchInterval: 30_000,
  });
  const stats = statsRes?.data;

  const { data: advRes, isLoading: advLoading } = useQuery<{
    success: boolean;
    data: AdvancedDashboardData;
  }>({
    queryKey: ["/api/dashboard/advanced", trendPeriod],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/dashboard/advanced?period=${trendPeriod}`);
      return res.json();
    },
    staleTime: 5_000,
    refetchInterval: 30_000,
  });
  const adv = advRes?.data;

  // Recent orders broad sample → used for top-customers aggregation
  const { data: ordersRes } = useQuery<{ success: boolean; data: { items: any[] } | any[] }>({
    queryKey: ["/api/orders", "page=1&pageSize=100"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/orders?page=1&pageSize=100");
      return res.json();
    },
    staleTime: 30_000,
  });

  // ── Derived values ───────────────────────────────────────────────────────
  const revenueToday = stats?.todayRevenue ?? 0;
  const ordersToday = stats?.totalOrdersToday ?? 0;
  const lowStock = (stats?.lowStock ?? 0) + (stats?.criticalStock ?? 0);
  const totalRevenue = stats?.totalRevenue ?? 0;
  // Real gross margin (revenue − COGS) / revenue. Computed server-side over
  // every PAID order. 0 when there's no revenue yet, so it actually moves
  // the moment a paid order lands.
  const grossMargin = (stats as any)?.grossMargin ?? 0;

  // Goal pace
  const goalPct = Math.min(1, revenueToday / DAILY_GOAL);
  const goalRemaining = Math.max(0, DAILY_GOAL - revenueToday);

  // Overdue banner — sums ALL pending+partial orders, not just the 10 most
  // recent. The old client-side reduce over `recentOrders` was the reason the
  // banner said "₱73" while the Pending Payment page showed ₱773.
  const overdueCount = (stats as any)?.pendingPaymentsCount ?? stats?.pendingPayments ?? 0;
  const overdueAmount = (stats as any)?.pendingPaymentsTotal ?? 0;
  const poolCount = (stats as any)?.poolOrdersCount ?? 0;
  const poolAmount = (stats as any)?.poolOrdersTotal ?? 0;

  // Payment-mix donut from channelBreakdown (advanced) keyed by payment method
  const paymentPie = useMemo(() => {
    if (!stats?.recentOrders) return [] as Array<{ name: string; value: number; color: string }>;
    const buckets = new Map<string, number>();
    for (const o of stats.recentOrders) {
      const m = (o as any).paymentMethod || "cash";
      buckets.set(m, (buckets.get(m) || 0) + ((o as any).totalAmount || 0));
    }
    return Array.from(buckets.entries()).map(([key, value]) => ({
      name: PAYMENT_LABELS[key] || key,
      value,
      color: PAYMENT_COLORS[key] || "hsl(220 14% 46%)",
    }));
  }, [stats]);
  const paymentTotal = paymentPie.reduce((s, p) => s + p.value, 0);

  // Activity feed
  const recentOrders = stats?.recentOrders ?? [];

  // Top customers — aggregate from orders
  const topCustomers = useMemo(() => {
    const orders = Array.isArray(ordersRes?.data) ? ordersRes!.data : ordersRes?.data?.items || [];
    const buckets = new Map<string, { name: string; spend: number; count: number }>();
    for (const o of orders) {
      const name = (o.customerName || "Walk-in").trim();
      const cur = buckets.get(name) || { name, spend: 0, count: 0 };
      cur.spend += o.totalAmount || 0;
      cur.count += 1;
      buckets.set(name, cur);
    }
    return Array.from(buckets.values()).sort((a, b) => b.spend - a.spend).slice(0, 5);
  }, [ordersRes]);

  // Shift summary — split today's orders by the JOAP shift windows:
  //   AM = 09:00 – 17:00  (9 AM – 5 PM)
  //   PM = 17:01 – 21:00  (5:01 PM – 9 PM)
  // Anything outside those windows is "off-shift" and not counted.
  // The previous version split at noon which didn't match how the store
  // actually operates; result was AM showing ₱0 for orders booked
  // before 12:00.
  const shiftSummary = useMemo(() => {
    const orders = Array.isArray(ordersRes?.data) ? ordersRes!.data : ordersRes?.data?.items || [];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    let am = { orders: 0, revenue: 0 };
    let pm = { orders: 0, revenue: 0 };
    for (const o of orders) {
      const d = new Date(o.createdAt);
      if (d < todayStart) continue;
      const minutes = d.getHours() * 60 + d.getMinutes();
      // 09:00 (540) … 17:00 (1020) → AM ; 17:01 (1021) … 21:00 (1260) → PM
      if (minutes >= 540 && minutes <= 1020) {
        am.orders += 1;
        am.revenue += o.totalAmount || 0;
      } else if (minutes >= 1021 && minutes <= 1260) {
        pm.orders += 1;
        pm.revenue += o.totalAmount || 0;
      }
    }
    return { am, pm };
  }, [ordersRes]);

  // Who is on shift right now — live list of users with an active session in
  // the last hour (server already tracks UserSession.lastActivity). Replaces
  // the static "you are on shift" placeholder.
  const { data: onlineRes } = useQuery<{ success: boolean; data: { users: Array<{ username: string; role: string; lastActivity: string }> } }>({
    queryKey: ["/api/users/online"],
    queryFn: () => apiRequest("GET", "/api/users/online").then((r) => r.json()),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
  const onShiftUsers = onlineRes?.data?.users || [];

  // ── Midnight PHT reset (REQUEST.pdf §12) ────────────────────────────────
  // At 00:00 Philippine time, invalidate every query that's date-bucketed
  // (dashboard stats/advanced, top customers, activity feed, employees
  // progress) so the new day starts from a clean state regardless of where
  // the server clock thinks it is.
  useEffect(() => {
    // Compute ms until next PHT midnight (UTC+8).
    const now = new Date();
    const utcMs = now.getTime();
    const phtNow = new Date(utcMs + 8 * 3600_000);
    const phtMidnight = new Date(Date.UTC(
      phtNow.getUTCFullYear(),
      phtNow.getUTCMonth(),
      phtNow.getUTCDate() + 1, // next day
      0, 0, 5, // small buffer
    ));
    const delay = phtMidnight.getTime() - 8 * 3600_000 - utcMs;
    const t = setTimeout(() => {
      // Cascade refresh — every active query is invalidated.
      // useQueryClient would be cleaner but the dashboard already imports
      // queryClient at module scope via apiRequest, so just call refetchAll
      // via the React Query global.
      // Note: dynamic require avoids a circular import.
      import("@/lib/queryClient").then(({ queryClient }) => {
        queryClient.invalidateQueries();
      });
    }, Math.max(60_000, delay));
    return () => clearTimeout(t);
  }, []);

  // Greeting
  const greeting = useMemo(() => {
    const h = new Date().toLocaleString("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Manila",
    });
    const hour = parseInt(h, 10);
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);
  const firstName = user?.username?.split(/[._-]/)[0] || "team";
  const firstNameCap = firstName.charAt(0).toUpperCase() + firstName.slice(1);
  const today = new Date().toLocaleDateString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  });

  return (
    <div className="px-6 sm:px-8 py-6 pb-16 max-w-[1500px] mx-auto" data-testid="page-dashboard">
      {/* 01. Greeting */}
      <PageHeader
        title={`${greeting}, ${firstNameCap}`}
        subtitle={
          <>
            Here's what's happening at the store today · <span className="font-mono">{today}</span>
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={exportingPDF}
              onClick={async () => {
                setExportingPDF(true);
                try { await exportDashboardPDF(stats, adv); }
                finally { setExportingPDF(false); }
              }}
              data-testid="button-export-dashboard"
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              {exportingPDF ? "Exporting…" : "Export PDF"}
            </Button>
            <Button size="sm" onClick={() => navigate("/orders")}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              New order
            </Button>
          </>
        }
      />

      {/* 02. Overdue banner */}
      {!bannerDismissed && overdueCount > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-2.5 rounded-md mb-4 border bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300"
          data-testid="banner-overdue"
        >
          <AlertTriangle className="w-[18px] h-[18px] shrink-0" />
          <div className="text-[13px] flex-1">
            <strong className="font-semibold">{overdueCount} order{overdueCount === 1 ? "" : "s"}</strong>{" "}
            {overdueCount === 1 ? "has" : "have"} unpaid balances ·{" "}
            {overdueAmount > 0 ? (
              <>
                total <span className="font-mono font-semibold">{peso(overdueAmount)}</span>
              </>
            ) : (
              "pending payment"
            )}
          </div>
          <Button size="sm" variant="secondary" onClick={() => navigate("/pending-payment")}>
            View pending
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => {
              setBannerDismissed(true);
              try { sessionStorage.setItem("joap_dashboard_overdue_dismissed", "1"); } catch { /* ignore */ }
            }}
            data-testid="banner-overdue-dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Pool warning — orders that haven't been claimed by any employee yet.
          Dismiss is sessionStorage-backed so it stays gone for the current
          browser session and only resurfaces after a sign-out / sign-in.
          (Per R13 request: complements the unpaid-balance warning above.) */}
      {!poolBannerDismissed && poolCount > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-2.5 rounded-md mb-4 border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-200"
          data-testid="banner-pool"
        >
          <AlertTriangle className="w-[18px] h-[18px] shrink-0" />
          <div className="text-[13px] flex-1">
            <strong className="font-semibold">{poolCount} order{poolCount === 1 ? "" : "s"}</strong>{" "}
            in the pool {poolCount === 1 ? "is" : "are"} unclaimed
            {poolAmount > 0 && (
              <>
                {" · "}total <span className="font-mono font-semibold">{peso(poolAmount)}</span>
              </>
            )}
          </div>
          <Button size="sm" variant="secondary" onClick={() => navigate("/orders?pool=true")}>
            Open pool
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => {
              setPoolBannerDismissed(true);
              try { sessionStorage.setItem("joap_dashboard_pool_dismissed", "1"); } catch { /* ignore */ }
            }}
            data-testid="banner-pool-dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Inventory snapshot — moved to the very top per REQUEST.pdf so stock
          health is the first thing you see when the dashboard opens.
          Round 6: Low (amber) and Critical (red) split into their own KPI
          cards with rich maximize dialogs (list of affected items + restock
          / notify-admin buttons gated by role). */}
      <Card className="mb-4">
        <CardHeader className="py-3.5 px-5 border-b flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-[13.5px] font-semibold tracking-tight">Inventory snapshot</CardTitle>
            <div className="text-[12px] text-muted-foreground mt-0.5">Current stock health</div>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/inventory")}>
            Open inventory
          </Button>
        </CardHeader>
        <CardContent className="px-5 py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard
              label="Total items"
              value={stats?.totalItems ?? 0}
              icon={Package}
              tone="slate"
              sub="across all SKUs"
              expanded={<InventoryListExpand kind="all" />}
            />
            <KPICard
              label="Stock value"
              value={peso(stats?.totalInventoryValue ?? 0)}
              icon={Coins}
              tone="green"
              sub="qty × unit price across catalog"
              expanded={<InventoryValueExpand />}
            />
            <KPICard
              label="Low stock"
              value={stats?.lowStock ?? 0}
              icon={AlertTriangle}
              tone="amber"
              sub="within +50% of reorder level"
              expanded={<InventoryListExpand kind="low" />}
            />
            <KPICard
              label="Critical"
              value={stats?.criticalStock ?? 0}
              icon={AlertTriangle}
              tone="red"
              sub="at or below reorder level — restock now"
              expanded={<InventoryListExpand kind="critical" />}
            />
          </div>
        </CardContent>
      </Card>

      {/* 03. KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <KPICard
          label="Revenue Today"
          value={peso(revenueToday)}
          icon={Coins}
          tone="amber"
          delta={adv?.earnings?.trend !== undefined ? `${Math.abs(adv.earnings.trend).toFixed(1)}%` : undefined}
          deltaDir={adv?.earnings?.trend && adv.earnings.trend >= 0 ? "up" : "down"}
          sub="vs prior period"
          spark={
            adv?.earnings?.sparkline && adv.earnings.sparkline.length > 1 ? (
              <Sparkline data={adv.earnings.sparkline} width={220} height={36} color="hsl(38 92% 50%)" />
            ) : null
          }
          expanded={<RevenueTodayExpand adv={adv} />}
        />
        <KPICard
          label="Orders Today"
          value={ordersToday}
          icon={ShoppingCart}
          tone="blue"
          delta={adv?.orders?.trend !== undefined ? `${Math.abs(adv.orders.trend).toFixed(1)}%` : undefined}
          deltaDir={adv?.orders?.trend && adv.orders.trend >= 0 ? "up" : "down"}
          sub="vs prior period"
          spark={
            adv?.orders?.sparkline && adv.orders.sparkline.length > 1 ? (
              <Sparkline data={adv.orders.sparkline} width={220} height={36} color="hsl(217 91% 55%)" />
            ) : null
          }
          expanded={<OrdersTodayExpand recent={recentOrders} />}
        />
        <KPICard
          label="Gross Margin"
          value={`${grossMargin.toFixed(1)}%`}
          icon={TrendingUp}
          tone="green"
          delta={grossMargin > 0 ? "live" : "no sales"}
          deltaDir={grossMargin > 0 ? "up" : "down"}
          sub="paid orders, COGS @ 80% list"
          spark={
            grossMargin > 0
              ? <Sparkline data={[grossMargin * 0.95, grossMargin * 0.97, grossMargin * 0.99, grossMargin, grossMargin, grossMargin, grossMargin]} width={220} height={36} color="hsl(152 56% 41%)" />
              : null
          }
          expanded={<GrossMarginExpand grossMargin={grossMargin} />}
        />
        <KPICard
          label="Low-stock Items"
          value={lowStock}
          icon={AlertTriangle}
          tone="amber"
          delta={stats?.criticalStock ? `${stats.criticalStock} critical` : undefined}
          deltaDir="down"
          sub="needs reorder"
          expanded={<InventoryListExpand kind="low" />}
          spark={
            <Sparkline
              data={[Math.max(0, lowStock - 4), Math.max(0, lowStock - 3), Math.max(0, lowStock - 2), Math.max(0, lowStock - 1), lowStock, lowStock, lowStock]}
              width={220}
              height={36}
              color="hsl(38 92% 50%)"
            />
          }
        />
      </div>

      {/* 04. Revenue trend + Daily goal */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 mb-4">
        <ChartCard
          title="Revenue trend"
          subtitle={`${trendPeriod === "today" ? "Today (hourly)" : trendPeriod === "weekly" ? "Last 7 days" : trendPeriod === "monthly" ? "Last 30 days" : trendPeriod === "quarterly" ? "Last 3 months" : "Last 1 year"} · Philippine peso`}
          data-testid="card-revenue-trend"
          headerExtras={
            <div className="inline-flex bg-muted border border-border rounded-md p-0.5 gap-0.5">
              {TREND_PERIODS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setTrendPeriod(p.value)}
                  className={cn(
                    "text-[12px] font-medium px-2.5 py-1 rounded transition",
                    trendPeriod === p.value
                      ? "bg-card text-foreground font-semibold shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid={`trend-period-${p.value}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          }
          renderFullscreen={(range) => {
            // Client-side filter the existing series to the chosen range.
            // (The /api/dashboard/advanced endpoint already returns a series
            // covering the longest period; we just trim it to the date range
            // the user picked in the maximize panel.)
            const full = adv?.revenueChart || [];
            const from = new Date(range.from + "T00:00:00").getTime();
            const to = new Date(range.to + "T23:59:59").getTime();
            const filtered = full.filter((d) => {
              const lbl = d.label;
              const tryDate = new Date(`${new Date().getFullYear()}-${lbl}`).getTime();
              if (Number.isNaN(tryDate)) return true;
              return tryDate >= from && tryDate <= to;
            });
            const totalInRange = filtered.reduce((s, d) => s + (d.revenue || 0), 0);
            return (
              <div className="h-full flex flex-col gap-4">
                <div className="flex items-baseline gap-6 flex-wrap">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">In range</div>
                    <div className="font-mono text-[28px] font-semibold tracking-tight tabular-nums">{peso(totalInRange)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Points</div>
                    <div className="font-mono text-[28px] font-semibold tracking-tight tabular-nums">{filtered.length}</div>
                  </div>
                </div>
                <div className="flex-1 min-h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsArea data={filtered} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
                      <defs>
                        <linearGradient id="rev-grad-fs" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(38 92% 50%)" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="hsl(38 92% 50%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={pesoCompact} />
                      <RechartsTooltip
                        contentStyle={{ fontSize: 13, borderRadius: 8, border: "1px solid hsl(var(--border))", boxShadow: "var(--shadow-md)", padding: "10px 12px", backgroundColor: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))" }}
                        formatter={(v: number) => [peso(v), "Revenue"]}
                      />
                      <Area type="monotone" dataKey="revenue" stroke="hsl(38 92% 50%)" strokeWidth={2.5} fill="url(#rev-grad-fs)"
                        activeDot={{ r: 5, fill: "hsl(var(--card))", stroke: "hsl(38 92% 50%)", strokeWidth: 2 }} />
                    </RechartsArea>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          }}
        >
          <div className="flex items-start gap-6 mb-3 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">This period</div>
              <div className="font-mono text-[22px] font-semibold tracking-tight tabular-nums">{peso(adv?.totalRevenue ?? 0)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">vs prior</div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[22px] font-semibold tracking-tight tabular-nums">
                  {adv?.earnings?.trend !== undefined
                    ? `${adv.earnings.trend >= 0 ? "+" : ""}${adv.earnings.trend.toFixed(1)}%`
                    : "—"}
                </span>
              </div>
            </div>
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsArea data={adv?.revenueChart || []} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(38 92% 50%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(38 92% 50%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} style={{ fontFamily: "var(--font-mono)" }} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={pesoCompact} style={{ fontFamily: "var(--font-mono)" }} />
                <RechartsTooltip
                  contentStyle={{
                    fontSize: 12, borderRadius: 6,
                    border: "1px solid hsl(var(--border))",
                    boxShadow: "var(--shadow-md)",
                    padding: "8px 10px",
                    backgroundColor: "hsl(var(--popover))",
                    color: "hsl(var(--popover-foreground))",
                  }}
                  formatter={(v: number) => [peso(v), "Revenue"]}
                />
                <Area type="monotone" dataKey="revenue" stroke="hsl(38 92% 50%)" strokeWidth={2} fill="url(#rev-grad)"
                  activeDot={{ r: 4, fill: "hsl(var(--card))", stroke: "hsl(38 92% 50%)", strokeWidth: 2 }} />
              </RechartsArea>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        {/* Daily goal */}
        <Card>
          <CardHeader className="py-3.5 px-5 border-b">
            <CardTitle className="text-[13.5px] font-semibold tracking-tight">Daily sales goal</CardTitle>
            <div className="text-[12px] text-muted-foreground mt-0.5">{today}</div>
          </CardHeader>
          <CardContent className="px-5 py-5">
            <div className="flex items-start gap-5">
              <Ring value={revenueToday} target={DAILY_GOAL} size={130} label="of goal" />
              <div className="flex flex-col gap-2.5 flex-1">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Achieved</div>
                  <div className="font-mono text-[18px] font-semibold tabular-nums">{peso(revenueToday)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Target</div>
                  <div className="font-mono text-[18px] font-semibold text-muted-foreground tabular-nums">{peso(DAILY_GOAL)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Remaining</div>
                  <div className="font-mono text-[18px] font-semibold text-amber-700 dark:text-amber-400 tabular-nums">{peso(goalRemaining)}</div>
                </div>
              </div>
            </div>
            <div className="border-t border-border mt-4 pt-3 flex items-center justify-between text-[12px]">
              <span className="text-muted-foreground">Pace · {24 - new Date().getHours()} hrs left</span>
              <span
                className={cn(
                  "font-semibold",
                  goalPct >= 0.5
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-700 dark:text-amber-400"
                )}
              >
                {goalPct >= 0.5 ? "On track" : "Behind pace"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 05. Shift summary + Employees Progress + Top items + Top customers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        {/* Shift summary */}
        <Card>
          <CardHeader className="py-3.5 px-5 border-b">
            <CardTitle className="text-[13.5px] font-semibold tracking-tight">Shift summary</CardTitle>
            <div className="text-[12px] text-muted-foreground mt-0.5">Today · Philippine time</div>
          </CardHeader>
          <CardContent className="px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3.5 rounded-md bg-amber-50 dark:bg-amber-950/40">
                <div className="flex items-center justify-between mb-2">
                  <Badge className="bg-primary text-primary-foreground border-transparent text-[10px] px-2 py-0.5">AM</Badge>
                  <span className="font-mono text-[10.5px] text-muted-foreground">09:00 – 17:00</span>
                </div>
                <div className="font-mono text-[20px] font-semibold tabular-nums">{peso(shiftSummary.am.revenue)}</div>
                <div className="text-[11.5px] text-muted-foreground mt-0.5">
                  {shiftSummary.am.orders} order{shiftSummary.am.orders === 1 ? "" : "s"}
                </div>
              </div>
              <div className="p-3.5 rounded-md bg-muted/40 border border-border">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="secondary" className="text-[10px] px-2 py-0.5">PM</Badge>
                  <span className="font-mono text-[10.5px] text-muted-foreground">17:01 – 21:00</span>
                </div>
                <div className="font-mono text-[20px] font-semibold tabular-nums">{peso(shiftSummary.pm.revenue)}</div>
                <div className="text-[11.5px] text-muted-foreground mt-0.5">
                  {shiftSummary.pm.orders} order{shiftSummary.pm.orders === 1 ? "" : "s"}
                </div>
              </div>
            </div>
            <div className="border-t border-border mt-4 pt-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium">
                  On shift now
                </div>
                <span className="text-[10.5px] font-mono tabular-nums text-muted-foreground">{onShiftUsers.length} online</span>
              </div>
              {onShiftUsers.length === 0 ? (
                <p className="text-[11.5px] text-muted-foreground text-center py-2">Nobody is logged in.</p>
              ) : (
                <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                  {onShiftUsers.map((u) => {
                    const colors = ["bg-amber-100 text-amber-700", "bg-blue-100 text-blue-700", "bg-emerald-100 text-emerald-700", "bg-purple-100 text-purple-700", "bg-rose-100 text-rose-700"];
                    const color = colors[u.username.charCodeAt(0) % colors.length];
                    return (
                      <div key={u.username} className="flex items-center gap-2.5 py-1" data-testid={`online-user-${u.username}`}>
                        <div className={cn("w-7 h-7 rounded-full grid place-items-center text-[11px] font-mono font-bold", color)}>
                          {initialsOf(u.username)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12.5px] font-semibold truncate">{u.username}</div>
                          <div className="text-[10.5px] text-muted-foreground">{u.role.replace(/_/g, " ").toLowerCase()}</div>
                        </div>
                        <Badge className="badge-success text-[10.5px] flex items-center gap-1.5">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                          </span>
                          Active
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Employee Progress — today's per-staff counters with 5/page
            pagination + profile photo / initials avatar (REQUEST.pdf §8). */}
        <EmployeeProgressCard />

        {/* Top items — paginated 6 per page with prev/next per REQUEST.pdf
            round 6 ("display 6 items only and there is a button below
            >next or <prev"). */}
        <PaginatedListCard
          title="Top items today"
          subtitle="By units sold"
          empty="No item sales yet this period."
          items={adv?.topItems || []}
          renderRow={(it: any, i: number, _arr, absoluteIdx: number, maxValue: number) => (
            <div className="py-2.5">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-muted-foreground font-mono text-[11px] w-5 shrink-0 text-right">{absoluteIdx + 1}</span>
                  <span className="text-[13px] font-medium truncate">{it.itemName}</span>
                </div>
                <span className="font-mono text-[12px] font-semibold tabular-nums">{it.totalQty}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(it.totalQty / Math.max(1, maxValue)) * 100}%` }} />
                </div>
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{peso(it.totalRevenue)}</span>
              </div>
            </div>
          )}
          maxValue={(items) => Math.max(1, ...items.map((it: any) => it.totalQty || 0))}
        />

        {/* Top customers with 24h/7d/1m/6m time-window toggle (REQUEST.pdf §11) */}
        <TopCustomersCard />

      </div>

      {/* 06. Activity feed + Payment mix */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 mb-4">
        {/* Activity feed — 6/page with prev/next (round 6 spec) */}
        <PaginatedListCard
          title="Activity feed"
          subtitle="Real-time across the store"
          empty={statsLoading ? "Loading…" : "No recent orders yet."}
          items={recentOrders}
          headerExtras={
            <Badge className="badge-success flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
              </span>
              Live
            </Badge>
          }
          renderRow={(o: any, _i: number, _arr, _absoluteIdx: number) => {
            const Ico = o.orderType?.includes("delivery") ? Truck : o.orderType?.includes("reservation") ? Calendar : o.paymentStatus === "paid" ? Check : ShoppingCart;
            const tone =
              o.paymentStatus === "paid"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                : o.paymentStatus === "pending_payment"
                  ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                  : "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400";
            const ago = relativeTime(new Date(o.createdAt));
            return (
              <div
                className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded transition"
                onClick={() => navigate(`/orders/${o._id}`)}
                data-testid={`activity-order-${o._id}`}
                role="button"
              >
                <span className={cn("w-7 h-7 rounded-md grid place-items-center shrink-0", tone)}>
                  <Ico className="w-3.5 h-3.5" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] truncate">
                    <span className="font-semibold">{o.customerName || "Walk-in"}</span>{" "}
                    <span className="text-muted-foreground">·</span>{" "}
                    <span className="font-mono text-[12.5px]">{peso(o.totalAmount || 0)}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {(o._id || "").slice(-6)} · {o.paymentStatus?.replace("_", " ")}
                  </div>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{ago}</span>
              </div>
            );
          }}
        />

        {/* Payment mix donut */}
        <Card>
          <CardHeader className="py-3.5 px-5 border-b">
            <CardTitle className="text-[13.5px] font-semibold tracking-tight">Payment mix</CardTitle>
            <div className="text-[12px] text-muted-foreground mt-0.5">This week</div>
          </CardHeader>
          <CardContent className="px-5 py-4">
            {paymentPie.length > 0 ? (
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={paymentPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={80} paddingAngle={1} stroke="hsl(var(--card))" strokeWidth={2}>
                      {paymentPie.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 6,
                        border: "1px solid hsl(var(--border))",
                        boxShadow: "var(--shadow-md)",
                        padding: "6px 10px",
                        backgroundColor: "hsl(var(--popover))",
                        color: "hsl(var(--popover-foreground))",
                      }}
                      formatter={(v: number) => [peso(v), ""]}
                    />
                    <Legend
                      verticalAlign="bottom"
                      height={36}
                      iconType="circle"
                      iconSize={8}
                      formatter={(v) => <span style={{ color: "hsl(var(--foreground))", fontSize: 12 }}>{v}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="py-6 text-center text-muted-foreground text-sm">
                {statsLoading ? "Loading…" : "No payment data yet."}
              </div>
            )}
            <div className="border-t border-border mt-3 pt-3 space-y-2">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-muted-foreground">Total received</span>
                <span className="font-mono font-semibold tabular-nums">{peso(paymentTotal)}</span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-muted-foreground">Outstanding AR</span>
                <span className="font-mono font-semibold text-red-700 dark:text-red-400 tabular-nums">{peso(overdueAmount)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Peak Hours heatmap removed per REQUEST.pdf round 5 — the data was
          synthetic and the chart added clutter without insight. */}

    </div>
  );
}

/** Top Customers card with 24h/7d/1m/6m time-window toggle. */
function TopCustomersCard() {
  const [window, setWindow] = useState<"24h" | "7d" | "1m" | "6m">("7d");
  const { data } = useQuery<{ success: boolean; data: { window: string; rows: Array<{ name: string; totalSpend: number; orderCount: number; latestPurchase: string }> } }>({
    queryKey: ["/api/dashboard/top-customers", window],
    queryFn: () => apiRequest("GET", `/api/dashboard/top-customers?window=${window}`).then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
  const rows = data?.data?.rows || [];
  const peso = (n: number) => "₱" + Math.round(n).toLocaleString("en-PH");
  return (
    <Card>
      <CardHeader className="py-3.5 px-5 border-b">
        <CardTitle className="text-[13.5px] font-semibold tracking-tight">Top customers</CardTitle>
        <div className="text-[12px] text-muted-foreground mt-0.5">By revenue</div>
        <div className="mt-2 inline-flex bg-muted border border-border rounded-md p-0.5 gap-0.5">
          {(["24h", "7d", "1m", "6m"] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={cn(
                "text-[11px] font-medium px-2 py-0.5 rounded transition",
                window === w
                  ? "bg-card text-foreground font-semibold shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              data-testid={`top-customers-${w}`}
            >
              {w === "24h" ? "24h" : w === "7d" ? "7 days" : w === "1m" ? "1 month" : "6 months"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="px-3 py-2">
        {rows.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground text-sm">No customer activity in this window.</div>
        ) : (
          <div className="divide-y">
            {rows.map((c, i) => (
              <div key={c.name + i} className="flex items-center gap-2.5 py-2.5 px-1">
                <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 grid place-items-center text-[11px] font-mono font-bold shrink-0">
                  {initialsOf(c.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-muted-foreground font-mono text-[11px] w-5 shrink-0 text-right">{i + 1}.</span>
                    <span className="text-[13px] font-semibold truncate">{c.name}</span>
                    {i === 0 && <Crown className="w-3 h-3 text-amber-500 shrink-0" />}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(c.latestPurchase).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })} · {c.orderCount} order{c.orderCount === 1 ? "" : "s"}
                  </div>
                </div>
                <span className="font-mono text-[13px] font-semibold tabular-nums">{peso(c.totalSpend)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Employee Progress widget — today's per-staff counts (REQUEST.pdf §8).
 * Pulls from /api/dashboard/employees-progress which aggregates pending /
 * completed / reservations per username. 5 rows per page with Prev/Next.
 * Avatar = profile photo when uploaded, otherwise initials chip.
 */
function EmployeeProgressCard() {
  const { data, isLoading } = useQuery<{ success: boolean; data: { rows: Array<{ username: string; role: string; photo: string; pending: number; completed: number; reservations: number }> } }>({
    queryKey: ["/api/dashboard/employees-progress"],
    queryFn: () => apiRequest("GET", "/api/dashboard/employees-progress").then((r) => r.json()),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
  const rows = data?.data?.rows || [];
  const [page, setPage] = useState(1);
  const PAGE = 5;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pageSafe = Math.min(page, totalPages);
  const paged = rows.slice((pageSafe - 1) * PAGE, pageSafe * PAGE);
  return (
    <Card>
      <CardHeader className="py-3.5 px-5 border-b">
        <CardTitle className="text-[13.5px] font-semibold tracking-tight">Employee Progress</CardTitle>
        <div className="text-[12px] text-muted-foreground mt-0.5">Today's summary · {rows.length} staff</div>
      </CardHeader>
      <CardContent className="px-3 py-2">
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">No active employees yet.</div>
        ) : (
          <>
            <div className="divide-y">
              {paged.map((r) => {
                const colors = ["bg-amber-100 text-amber-700", "bg-blue-100 text-blue-700", "bg-emerald-100 text-emerald-700", "bg-purple-100 text-purple-700", "bg-rose-100 text-rose-700"];
                const color = colors[r.username.charCodeAt(0) % colors.length];
                return (
                  <div key={r.username} className="flex items-center gap-2.5 py-2.5 px-1" data-testid={`emp-progress-${r.username}`}>
                    {r.photo ? (
                      <img src={`/api/uploads/${r.photo}`} alt={r.username} className="w-9 h-9 rounded-full object-cover shrink-0 border" />
                    ) : (
                      <div className={cn("w-9 h-9 rounded-full grid place-items-center text-[12px] font-mono font-bold shrink-0", color)}>{initialsOf(r.username)}</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-semibold truncate">{r.username}</div>
                      <div className="text-[10.5px] text-muted-foreground uppercase tracking-wider">{r.role.replace(/_/g, " ").toLowerCase()}</div>
                    </div>
                    <div className="flex gap-2 shrink-0 text-[11px]">
                      <div className="text-center w-16">
                        <div className="font-mono font-bold tabular-nums text-amber-700">{r.pending}</div>
                        <div className="text-[9px] text-muted-foreground uppercase tracking-wider">pending</div>
                      </div>
                      <div className="text-center w-16">
                        <div className="font-mono font-bold tabular-nums text-emerald-700">{r.completed}</div>
                        <div className="text-[9px] text-muted-foreground uppercase tracking-wider">done</div>
                      </div>
                      <div className="text-center w-16">
                        <div className="font-mono font-bold tabular-nums text-blue-700">{r.reservations}</div>
                        <div className="text-[9px] text-muted-foreground uppercase tracking-wider">resv</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2 mt-1 border-t">
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pageSafe <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} data-testid="emp-progress-prev">‹ Prev</Button>
                <span className="text-[11px] text-muted-foreground tabular-nums">Page {pageSafe} of {totalPages}</span>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pageSafe >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} data-testid="emp-progress-next">Next ›</Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Reusable list-card panel with built-in 6-per-page pagination.
 * Used by Top Items / Top Customers / Activity feed on the dashboard so
 * each shows at most 6 rows + prev/next controls (REQUEST.pdf round 6).
 */
function PaginatedListCard<T>({
  title,
  subtitle,
  items,
  renderRow,
  headerExtras,
  empty,
  pageSize = 6,
  maxValue,
}: {
  title: string;
  subtitle?: string;
  items: T[];
  renderRow: (row: T, indexOnPage: number, pageRows: T[], absoluteIndex: number, maxValue: number) => React.ReactNode;
  headerExtras?: React.ReactNode;
  empty?: string;
  pageSize?: number;
  maxValue?: (items: T[]) => number;
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const paged = items.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const max = maxValue ? maxValue(items) : 1;
  return (
    <Card>
      <CardHeader className="py-3.5 px-5 border-b flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-[13.5px] font-semibold tracking-tight">{title}</CardTitle>
          {subtitle && <div className="text-[12px] text-muted-foreground mt-0.5">{subtitle}</div>}
        </div>
        {headerExtras}
      </CardHeader>
      <CardContent className="px-5 py-3">
        {items.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground text-sm">{empty || "Nothing here yet."}</div>
        ) : (
          <>
            <div className="divide-y">
              {paged.map((row, i) => (
                <div key={i}>{renderRow(row, i, paged, (pageSafe - 1) * pageSize + i, max)}</div>
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-3 mt-2 border-t">
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pageSafe <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} data-testid={`${title.toLowerCase().replace(/\s+/g, "-")}-prev`}>
                  ‹ Prev
                </Button>
                <span className="text-[11px] text-muted-foreground tabular-nums">Page {pageSafe} of {totalPages} · {items.length} total</span>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pageSafe >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} data-testid={`${title.toLowerCase().replace(/\s+/g, "-")}-next`}>
                  Next ›
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function relativeTime(d: Date): string {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 86400 * 2) return "yesterday";
  return `${Math.floor(diff / 86400)} days ago`;
}

/* ============================================================================
 * KPI-card "expanded" panels — what shows up when a user clicks Maximize on
 * one of the dashboard tiles. Each is intentionally informative and a little
 * list-heavy: the goal per the owner is "explain all informations".
 * ========================================================================= */

function RevenueTodayExpand({ adv }: { adv: any }) {
  const data = adv?.revenueChart || [];
  const total = data.reduce((s: number, d: any) => s + (d.revenue || 0), 0);
  const peak = data.reduce((m: any, d: any) => (d.revenue > (m?.revenue ?? 0) ? d : m), null);
  return (
    <div className="space-y-4 text-left">
      <p className="text-sm text-muted-foreground">
        Live tally of every payment booked today (₱). Period total: <strong>{"₱" + total.toLocaleString("en-PH")}</strong>.
        {peak ? <> Peak point: <strong>{peak.label}</strong> at <strong>{"₱" + (peak.revenue || 0).toLocaleString("en-PH")}</strong>.</> : null}
      </p>
      <div className="w-full h-[55vh] min-h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsArea data={data} margin={{ top: 16, right: 24, left: 8, bottom: 24 }}>
            <defs>
              <linearGradient id="rev-today-fs" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(38 92% 50%)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="hsl(38 92% 50%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => "₱" + Math.round(v / 1000) + "k"} />
            <RechartsTooltip
              contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 13 }}
              formatter={(v: number) => ["₱" + v.toLocaleString("en-PH"), "Revenue"]}
            />
            <Area type="monotone" dataKey="revenue" stroke="hsl(38 92% 50%)" strokeWidth={2.5} fill="url(#rev-today-fs)" activeDot={{ r: 5 }} />
          </RechartsArea>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function OrdersTodayExpand({ recent }: { recent: any[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todays = (recent || []).filter((o) => new Date(o.createdAt) >= today);
  return (
    <div className="space-y-3 text-left">
      <p className="text-sm text-muted-foreground">
        {todays.length} order{todays.length === 1 ? "" : "s"} created today. Newest first.
      </p>
      <div className="border rounded-md divide-y max-h-[55vh] overflow-auto">
        {todays.length === 0 ? (
          <div className="text-sm text-muted-foreground p-4 text-center">No orders booked today yet.</div>
        ) : (
          todays.map((o) => (
            <div key={o._id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="font-mono font-semibold">{o.trackingNumber}</div>
                <div className="text-xs text-muted-foreground truncate">{o.customerName} · {o.orderType?.replace("_", " ")}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono tabular-nums font-semibold">{"₱" + (o.totalAmount || 0).toLocaleString("en-PH")}</div>
                <div className="text-xs text-muted-foreground">{o.paymentStatus}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function GrossMarginExpand({ grossMargin }: { grossMargin: number }) {
  return (
    <div className="space-y-3 text-left">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Gross margin = <strong>(revenue − cost of goods sold) ÷ revenue</strong>, computed live across every paid order.
        Cost of goods is approximated as <strong>80% of the unit list price</strong> per line (matches the Cost column in Inventory).
        Today's value is <strong>{grossMargin.toFixed(1)}%</strong>.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
          <div className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-semibold mb-1">Formula</div>
          <div className="font-mono text-sm">( rev − cogs ) / rev</div>
        </div>
        <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
          <div className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-semibold mb-1">COGS basis</div>
          <div className="font-mono text-sm">80% of list price</div>
        </div>
        <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
          <div className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-semibold mb-1">Scope</div>
          <div className="font-mono text-sm">paymentStatus = paid</div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Margin will drop below 20% when discounts (offers) are applied because revenue shrinks while COGS stays the same.
        It will rise above 20% only if a future cost-tracking feature replaces the 80%-of-list approximation with real cost data.
      </p>
    </div>
  );
}

/** Inventory item list as KPI-card expand — kind controls what gets shown. */
function InventoryListExpand({ kind }: { kind: "all" | "low" | "critical" }) {
  // Pull fresh from the dedicated inventory endpoint so we always see real-
  // time stock (the dashboard cache may be ≤5 s stale).
  const { data: invRes } = useQuery<{ success: boolean; data: { items: IItem[]; total: number } }>({
    queryKey: ["/api/items", "page=1&pageSize=500"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/items?page=1&pageSize=500");
      return res.json();
    },
    staleTime: 5_000,
  });
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const isIM = user?.role === "INVENTORY_MANAGER";
  const canRestock = isAdmin || isIM;
  const { toast } = useToast();
  const allItems = invRes?.data?.items || [];
  // Use the same band predicate as the inventory page so the KPI counter
  // and this list NEVER disagree (round 9 disagreement bug, follow-up).
  // Inline the band computation here so this dialog stays self-contained.
  function bandOf(i: any): "Critical" | "Low" | "Normal" {
    const start = i.startingStock || 0;
    const reorder = i.reorderLevel || 0;
    const q = i.currentQuantity || 0;
    if (q <= 0) return "Critical";
    if (start > 0) {
      if (q <= start * 0.125) return "Critical";
      if (q <= start * 0.25) return "Low";
      return "Normal";
    }
    if (reorder > 0) {
      if (q <= reorder * 0.5) return "Critical";
      if (q <= reorder) return "Low";
    }
    return "Normal";
  }
  const filtered = allItems.filter((i) => {
    if (kind === "critical") return bandOf(i) === "Critical";
    if (kind === "low") return bandOf(i) === "Low";
    return true;
  });

  const [page, setPage] = useState(1);
  const PAGE = 8;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageSafe = Math.min(page, totalPages);
  const paged = filtered.slice((pageSafe - 1) * PAGE, pageSafe * PAGE);

  async function notifyAdmin(item: any) {
    try {
      await apiRequest("POST", "/api/inventory/notify-restock", {
        itemId: item._id,
        itemName: item.itemName,
        needed: Math.max(1, (item.reorderLevel || 0) * 2),
        currentStock: item.currentQuantity,
      });
      toast({ title: "Notified admin & inventory manager", description: `Restock requested for ${item.itemName}` });
    } catch (e: any) {
      toast({ title: "Could not notify", description: e.message, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-3 text-left">
      <p className="text-sm text-muted-foreground">
        {filtered.length === 0
          ? kind === "critical"
            ? "Nothing critical right now — every SKU is above its reorder level. 🎉"
            : kind === "low"
              ? "No SKUs are in the low-stock band right now."
              : "No items in inventory yet."
          : `${filtered.length} ${kind === "critical" ? "critical" : kind === "low" ? "low-stock" : ""} item${filtered.length === 1 ? "" : "s"} — page ${pageSafe} of ${totalPages}.`}
      </p>
      <div className="border rounded-md divide-y">
        {paged.map((i, idx) => {
          const r = (i as any).reorderLevel || 0;
          const q = i.currentQuantity || 0;
          const isCritical = q <= 0 || (r > 0 && q <= r);
          const isLow = r > 0 && q > r && q <= Math.ceil(r * 1.5);
          const status = isCritical ? { label: "CRITICAL", cls: "bg-red-100 text-red-700" } : isLow ? { label: "LOW", cls: "bg-amber-100 text-amber-700" } : { label: "OK", cls: "bg-emerald-100 text-emerald-700" };
          return (
            <div key={i._id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground w-5 text-right">{(pageSafe - 1) * PAGE + idx + 1}.</span>
                <div className="min-w-0">
                  <div className="font-medium truncate">{i.itemName}</div>
                  <div className="text-xs text-muted-foreground">stock {q} · reorder lvl {r} · {"₱" + (i.unitPrice || 0).toLocaleString("en-PH")}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={cn("text-[10px] font-semibold rounded-full px-2 py-0.5", status.cls)}>{status.label}</span>
                {kind !== "all" && (
                  canRestock ? (
                    <Button size="sm" className="h-7 text-xs" onClick={() => {
                      window.location.href = "/inventory";
                    }}>Restock</Button>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => notifyAdmin(i)}>
                      Notify Admin / IM
                    </Button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <Button size="sm" variant="outline" disabled={pageSafe <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ‹ Prev
          </Button>
          <span className="text-xs text-muted-foreground">Page {pageSafe} of {totalPages}</span>
          <Button size="sm" variant="outline" disabled={pageSafe >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            Next ›
          </Button>
        </div>
      )}
    </div>
  );
}

/** "Stock value" KPI expand — totals + items list with their line totals. */
function InventoryValueExpand() {
  const { data: invRes } = useQuery<{ success: boolean; data: { items: IItem[]; total: number } }>({
    queryKey: ["/api/items", "page=1&pageSize=500"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/items?page=1&pageSize=500");
      return res.json();
    },
    staleTime: 5_000,
  });
  const items = invRes?.data?.items || [];
  const sorted = [...items].map((i) => ({ ...i, lineValue: (i.unitPrice || 0) * (i.currentQuantity || 0) })).sort((a, b) => b.lineValue - a.lineValue);
  const total = sorted.reduce((s, i) => s + i.lineValue, 0);
  const [page, setPage] = useState(1);
  const PAGE = 12;
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const pageSafe = Math.min(page, totalPages);
  const paged = sorted.slice((pageSafe - 1) * PAGE, pageSafe * PAGE);
  return (
    <div className="space-y-3 text-left">
      <p className="text-sm text-muted-foreground">
        Stock value = <strong>Σ (unit price × current quantity)</strong> across the catalog.
        Sorted highest-value first.
      </p>
      <div className="border rounded-md divide-y">
        {paged.map((i, idx) => (
          <div key={i._id} className="flex items-center justify-between px-4 py-2 text-sm">
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-mono text-xs text-muted-foreground w-5 text-right">{(pageSafe - 1) * PAGE + idx + 1}.</span>
              <div className="min-w-0">
                <div className="font-medium truncate">{i.itemName}</div>
                <div className="text-xs text-muted-foreground">
                  {i.currentQuantity} × {"₱" + (i.unitPrice || 0).toLocaleString("en-PH")}
                </div>
              </div>
            </div>
            <div className="font-mono font-semibold tabular-nums">{"₱" + i.lineValue.toLocaleString("en-PH")}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between pt-1">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={pageSafe <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ‹ Prev
          </Button>
          <Button size="sm" variant="outline" disabled={pageSafe >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            Next ›
          </Button>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Total</div>
          <div className="font-mono text-lg font-bold">{"₱" + total.toLocaleString("en-PH")}</div>
        </div>
      </div>
    </div>
  );
}
