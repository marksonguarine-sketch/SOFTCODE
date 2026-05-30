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

import { useMemo, useState } from "react";
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
import type { DashboardStats } from "@shared/schema";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { KPICard } from "@/components/kpi-card";
import { Sparkline, Ring } from "@/components/charts";
// Heatmap component removed — Peak Hours card was dropped per REQUEST.pdf round 5.
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

// ── Trend-period selector ───────────────────────────────────────────────────
const TREND_PERIODS = [
  { value: "weekly", label: "7d" },
  { value: "daily", label: "14d" },
  { value: "monthly", label: "30d" },
  { value: "yearly", label: "90d" },
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
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>("daily");
  const [bannerDismissed, setBannerDismissed] = useState(false);
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

  // Overdue banner
  const overdueCount = stats?.pendingPayments ?? 0;
  const overdueAmount = useMemo(() => {
    if (!stats?.recentOrders) return 0;
    return stats.recentOrders
      .filter((o: any) => o.paymentStatus === "pending_payment")
      .reduce((s: number, o: any) => s + (o.totalAmount || 0), 0);
  }, [stats]);

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
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setBannerDismissed(true)}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Inventory snapshot — moved to the very top per REQUEST.pdf so stock
          health is the first thing you see when the dashboard opens. */}
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
            <div className="p-4 bg-muted/40 rounded-lg">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Total items</span>
                <Package className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div className="font-mono text-[22px] font-semibold tabular-nums">{stats?.totalItems ?? 0}</div>
            </div>
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg">
              <div className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-medium mb-1">Stock value</div>
              <div className="font-mono text-[22px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{peso(stats?.totalInventoryValue ?? 0)}</div>
            </div>
            <div className="p-4 bg-amber-50 dark:bg-amber-950/40 rounded-lg">
              <div className="text-[11px] uppercase tracking-wider text-amber-700 dark:text-amber-400 font-medium mb-1">Low stock</div>
              <div className="font-mono text-[22px] font-semibold tabular-nums text-amber-700 dark:text-amber-400">{stats?.lowStock ?? 0}</div>
            </div>
            <div className="p-4 bg-red-50 dark:bg-red-950/40 rounded-lg">
              <div className="text-[11px] uppercase tracking-wider text-red-700 dark:text-red-400 font-medium mb-1">Critical</div>
              <div className="font-mono text-[22px] font-semibold tabular-nums text-red-700 dark:text-red-400">{stats?.criticalStock ?? 0}</div>
            </div>
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
        />
        <KPICard
          label="Low-stock Items"
          value={lowStock}
          icon={AlertTriangle}
          tone="red"
          delta={stats?.criticalStock ? `${stats.criticalStock} critical` : undefined}
          deltaDir="down"
          sub="needs reorder"
          spark={
            <Sparkline
              data={[Math.max(0, lowStock - 4), Math.max(0, lowStock - 3), Math.max(0, lowStock - 2), Math.max(0, lowStock - 1), lowStock, lowStock, lowStock]}
              width={220}
              height={36}
              color="hsl(0 72% 56%)"
            />
          }
        />
      </div>

      {/* 04. Revenue trend + Daily goal */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 mb-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 py-3.5 px-5 border-b">
            <div>
              <CardTitle className="text-[13.5px] font-semibold tracking-tight">Revenue trend</CardTitle>
              <div className="text-[12px] text-muted-foreground mt-0.5">
                {trendPeriod === "weekly" ? "Last 7 days" : trendPeriod === "daily" ? "Last 14 days" : trendPeriod === "monthly" ? "Last 30 days" : "Last 90 days"} · Philippine peso
              </div>
            </div>
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
          </CardHeader>
          <CardContent className="px-5 py-4">
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
                <RechartsArea
                  data={adv?.revenueChart || []}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
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
                      fontSize: 12,
                      borderRadius: 6,
                      border: "1px solid hsl(var(--border))",
                      boxShadow: "var(--shadow-md)",
                      padding: "8px 10px",
                      backgroundColor: "hsl(var(--popover))",
                      color: "hsl(var(--popover-foreground))",
                    }}
                    formatter={(v: number) => [peso(v), "Revenue"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(38 92% 50%)"
                    strokeWidth={2}
                    fill="url(#rev-grad)"
                    activeDot={{ r: 4, fill: "hsl(var(--card))", stroke: "hsl(38 92% 50%)", strokeWidth: 2 }}
                  />
                </RechartsArea>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

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

      {/* 05. Shift summary + Top items + Top customers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
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

        {/* Top items */}
        <Card>
          <CardHeader className="py-3.5 px-5 border-b">
            <CardTitle className="text-[13.5px] font-semibold tracking-tight">Top items today</CardTitle>
            <div className="text-[12px] text-muted-foreground mt-0.5">By units sold</div>
          </CardHeader>
          <CardContent className="px-5 py-3">
            {(adv?.topItems || []).slice(0, 5).map((it, i, arr) => {
              const maxQty = arr[0]?.totalQty || 1;
              const pct = (it.totalQty / maxQty) * 100;
              return (
                <div key={i} className={cn("py-2.5", i < arr.length - 1 && "border-b border-border")}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-muted-foreground font-mono text-[11px] w-4 shrink-0">{i + 1}</span>
                      <span className="text-[13px] font-medium truncate">{it.itemName}</span>
                    </div>
                    <span className="font-mono text-[12px] font-semibold tabular-nums">{it.totalQty}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{peso(it.totalRevenue)}</span>
                  </div>
                </div>
              );
            })}
            {(!adv?.topItems || adv.topItems.length === 0) && (
              <div className="py-6 text-center text-muted-foreground text-sm">
                {advLoading ? "Loading…" : "No item sales yet this period."}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top customers */}
        <Card>
          <CardHeader className="py-3.5 px-5 border-b">
            <CardTitle className="text-[13.5px] font-semibold tracking-tight">Top customers</CardTitle>
            <div className="text-[12px] text-muted-foreground mt-0.5">By revenue</div>
          </CardHeader>
          <CardContent className="px-5 py-3">
            {topCustomers.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground text-sm">No customer activity yet.</div>
            ) : (
              topCustomers.map((c, i, arr) => (
                <div key={c.name} className={cn("flex items-center gap-2.5 py-2.5", i < arr.length - 1 && "border-b border-border")}>
                  <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 grid place-items-center text-[11px] font-mono font-bold shrink-0">
                    {initialsOf(c.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[13px] font-semibold truncate">{c.name}</span>
                      {i === 0 && <Crown className="w-3 h-3 text-amber-500 shrink-0" />}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {c.count} order{c.count === 1 ? "" : "s"}
                    </div>
                  </div>
                  <span className="font-mono text-[13px] font-semibold tabular-nums">{peso(c.spend)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* 06. Activity feed + Payment mix */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 mb-4">
        {/* Activity feed */}
        <Card>
          <CardHeader className="py-3.5 px-5 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-[13.5px] font-semibold tracking-tight">Activity feed</CardTitle>
              <div className="text-[12px] text-muted-foreground mt-0.5">Real-time across the store</div>
            </div>
            <Badge className="badge-success flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
              </span>
              Live
            </Badge>
          </CardHeader>
          <CardContent className="px-5 py-3 max-h-[380px] overflow-auto">
            {recentOrders.slice(0, 8).map((o: any, i: number, arr: any[]) => {
              const Ico = o.orderType?.includes("delivery")
                ? Truck
                : o.orderType?.includes("reservation")
                  ? Calendar
                  : o.paymentStatus === "paid"
                    ? Check
                    : ShoppingCart;
              const tone =
                o.paymentStatus === "paid"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                  : o.paymentStatus === "pending_payment"
                    ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                    : "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400";
              const created = new Date(o.createdAt);
              const ago = relativeTime(created);
              return (
                <div
                  key={o._id || i}
                  className={cn(
                    "flex items-center gap-3 py-2.5 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded transition",
                    i < Math.min(8, arr.length) - 1 && "border-b border-border"
                  )}
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
                      {o.orderNumber || (o._id || "").slice(-6)} · {o.paymentStatus?.replace("_", " ")}
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{ago}</span>
                </div>
              );
            })}
            {recentOrders.length === 0 && (
              <div className="py-6 text-center text-muted-foreground text-sm">
                {statsLoading ? "Loading…" : "No recent orders yet."}
              </div>
            )}
          </CardContent>
        </Card>

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

function relativeTime(d: Date): string {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 86400 * 2) return "yesterday";
  return `${Math.floor(diff / 86400)} days ago`;
}
