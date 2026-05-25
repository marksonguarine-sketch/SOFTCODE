/**
 * Forecasting — ARIMA(1, 1, 1) demand forecast.
 *
 * Two views:
 *   1. Aggregate forecast — orders/day + revenue/day with 95% confidence bands
 *      plotted against the last 30-60 days of actuals
 *   2. Per-item forecast — table sorted by reorder urgency, with a mini-chart
 *      per item and reorder advice
 *
 * Data source:
 *   GET /api/forecast/aggregate?horizon=14&lookback=60
 *   GET /api/forecast/items?horizon=14&lookback=60
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  Activity,
  AlertTriangle,
  Package,
  Calendar,
  Sparkles,
  Info,
  ChevronDown,
  ChevronUp,
  Search,
} from "lucide-react";
import {
  ComposedChart,
  Area,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from "recharts";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const HORIZON_OPTIONS = [
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
];

const URGENCY_STYLES: Record<string, { bg: string; ring: string; text: string; label: string }> = {
  critical: { bg: "bg-red-500/10", ring: "ring-red-500/30", text: "text-red-700 dark:text-red-400", label: "Critical · reorder now" },
  high:     { bg: "bg-amber-500/10", ring: "ring-amber-500/30", text: "text-amber-700 dark:text-amber-400", label: "High · reorder soon" },
  medium:   { bg: "bg-blue-500/10", ring: "ring-blue-500/30", text: "text-blue-700 dark:text-blue-400", label: "Medium · monitor" },
  low:      { bg: "bg-emerald-500/10", ring: "ring-emerald-500/30", text: "text-emerald-700 dark:text-emerald-400", label: "Low · sufficient stock" },
};

const peso = (v: number) => "₱" + Math.round(v).toLocaleString("en-PH");

interface AggregateData {
  horizon: number;
  lookbackDays: number;
  model: string;
  historyLabels: string[];
  forecastLabels: string[];
  orders: { history: number[]; forecast: number[]; lower95: number[]; upper95: number[]; totalForecastDemand: number; sigma: number; params: any };
  revenue: { history: number[]; forecast: number[]; lower95: number[]; upper95: number[]; totalForecastRevenue: number; sigma: number; params: any };
}

interface ItemForecast {
  itemId: string;
  itemName: string;
  category: string;
  currentStock: number;
  unitPrice: number;
  series: number[];
  forecast: number[];
  lower95: number[];
  upper95: number[];
  avgDailyDemand: number;
  totalForecastDemand: number;
  daysOfStock: number | null;
  reorderUrgency: "critical" | "high" | "medium" | "low";
  model: { p: number; d: number; q: number; phi: number; theta: number; intercept: number };
  sigma: number;
  observations: number;
}

export default function ForecastingPage() {
  const [horizon, setHorizon] = useState(14);
  const [search, setSearch] = useState("");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const { data: aggData, isLoading: aggLoading } = useQuery<{ success: boolean; data: AggregateData }>({
    queryKey: ["/api/forecast/aggregate", horizon],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/forecast/aggregate?horizon=${horizon}&lookback=60`);
      return res.json();
    },
    staleTime: 30000,
    refetchInterval: false,
  });

  const { data: itemsData, isLoading: itemsLoading } = useQuery<{ success: boolean; data: { forecasts: ItemForecast[]; itemsAnalyzed: number; model: string } }>({
    queryKey: ["/api/forecast/items", horizon],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/forecast/items?horizon=${horizon}&lookback=60`);
      return res.json();
    },
    staleTime: 30000,
    refetchInterval: false,
  });

  const agg = aggData?.data;
  const items = itemsData?.data?.forecasts || [];

  const filteredItems = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((i) => i.itemName.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
  }, [items, search]);

  // Compose the chart series — concat history + forecast
  const chartData = useMemo(() => {
    if (!agg) return [];
    const data: any[] = [];
    for (let i = 0; i < agg.historyLabels.length; i++) {
      data.push({
        label: agg.historyLabels[i],
        actual: agg.orders.history[i],
        forecast: null,
        lower: null,
        upper: null,
        actualRev: agg.revenue.history[i],
        forecastRev: null,
        lowerRev: null,
        upperRev: null,
        isForecast: false,
      });
    }
    // Bridge point: last actual = first forecast point for continuous line
    if (data.length > 0) {
      const last = data[data.length - 1];
      last.forecast = last.actual;
      last.forecastRev = last.actualRev;
    }
    for (let i = 0; i < agg.forecastLabels.length; i++) {
      data.push({
        label: agg.forecastLabels[i],
        actual: null,
        forecast: agg.orders.forecast[i],
        lower: agg.orders.lower95[i],
        upper: agg.orders.upper95[i],
        actualRev: null,
        forecastRev: agg.revenue.forecast[i],
        lowerRev: agg.revenue.lower95[i],
        upperRev: agg.revenue.upper95[i],
        isForecast: true,
      });
    }
    return data;
  }, [agg]);

  const todayIndex = agg ? agg.historyLabels.length - 1 : -1;
  const todayLabel = todayIndex >= 0 && chartData[todayIndex] ? chartData[todayIndex].label : null;

  const urgencyCounts = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    items.forEach((i) => { counts[i.reorderUrgency] = (counts[i.reorderUrgency] || 0) + 1; });
    return counts;
  }, [items]);

  return (
    <div className="p-3 sm:p-6 space-y-5 overflow-auto h-full" data-testid="page-forecasting">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div
            className="w-11 h-11 rounded-xl grid place-items-center shrink-0 shadow-md ring-1 ring-primary/20"
            style={{ background: "linear-gradient(135deg, hsl(38 92% 55%), hsl(38 92% 42%))" }}
          >
            <TrendingUp className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold leading-tight" data-testid="text-forecast-title">
              Demand Forecasting
            </h1>
            <p className="text-[12.5px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-primary" />
              <span className="font-mono">ARIMA(1, 1, 1)</span> · {agg?.lookbackDays ?? 60}-day lookback · {horizon}-day horizon
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {HORIZON_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              size="sm"
              variant={horizon === opt.value ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => setHorizon(opt.value)}
              data-testid={`button-horizon-${opt.value}`}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* ── KPI strip ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ForecastKpiTile
          label="Forecast orders"
          value={agg ? agg.orders.totalForecastDemand : 0}
          suffix={`in next ${horizon}d`}
          color="amber"
          icon={Activity}
          loading={aggLoading}
        />
        <ForecastKpiTile
          label="Forecast revenue"
          value={agg ? agg.revenue.totalForecastRevenue : 0}
          format="currency"
          suffix={`in next ${horizon}d`}
          color="emerald"
          icon={TrendingUp}
          loading={aggLoading}
        />
        <ForecastKpiTile
          label="Items at risk"
          value={urgencyCounts.critical + urgencyCounts.high}
          suffix={`of ${items.length} analyzed`}
          color="red"
          icon={AlertTriangle}
          loading={itemsLoading}
        />
        <ForecastKpiTile
          label="Items healthy"
          value={urgencyCounts.low}
          suffix={`of ${items.length} analyzed`}
          color="blue"
          icon={Package}
          loading={itemsLoading}
        />
      </div>

      {/* ── Tabs ───────────────────────────────────────────────── */}
      <Tabs defaultValue="aggregate">
        <TabsList>
          <TabsTrigger value="aggregate" className="gap-1.5" data-testid="tab-aggregate">
            <Activity className="h-3.5 w-3.5" /> Aggregate
          </TabsTrigger>
          <TabsTrigger value="items" className="gap-1.5" data-testid="tab-items">
            <Package className="h-3.5 w-3.5" /> Per item
            <Badge variant="secondary" className="text-[10px] h-4 px-1">{items.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* ── Aggregate tab ──────────────────────────────────── */}
        <TabsContent value="aggregate" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="border-b py-3.5 px-5">
              <CardTitle className="text-[14px] font-semibold tracking-tight flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Orders forecast · history + {horizon}-day projection
              </CardTitle>
              <CardDescription className="text-[12px]">
                Solid amber = actual orders per day. Dashed amber = ARIMA forecast. Shaded band = 95% prediction interval.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5 pb-2 px-3 sm:px-5">
              {aggLoading ? (
                <Skeleton className="h-72 w-full" />
              ) : chartData.length === 0 ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="confidence-orders" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(38 92% 55%)" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="hsl(38 92% 55%)" stopOpacity={0.04} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                      tickFormatter={(v) => v?.slice(5) /* MM-DD */}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <RTooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v: any, name: string) => {
                        if (v == null) return ["—", name];
                        return [v, name];
                      }}
                    />
                    {todayLabel && <ReferenceLine x={todayLabel} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" label={{ value: "Today", fontSize: 10, fill: "hsl(var(--muted-foreground))", position: "insideTopRight" }} />}
                    {/* Confidence band */}
                    <Area type="monotone" dataKey="upper" stroke="none" fill="url(#confidence-orders)" name="95% upper" />
                    <Area type="monotone" dataKey="lower" stroke="none" fill="hsl(var(--card))" name="95% lower" />
                    {/* Actual line */}
                    <Line type="monotone" dataKey="actual" stroke="hsl(38 92% 50%)" strokeWidth={2.5} dot={{ r: 2, fill: "hsl(38 92% 50%)" }} name="Actual orders" connectNulls={false} />
                    {/* Forecast line (dashed) */}
                    <Line type="monotone" dataKey="forecast" stroke="hsl(38 92% 50%)" strokeWidth={2} strokeDasharray="6 4" dot={{ r: 2, fill: "hsl(var(--card))", stroke: "hsl(38 92% 50%)", strokeWidth: 2 }} name="Forecast orders" connectNulls={false} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
              {agg && (
                <ModelParamsRow label="Orders model" params={agg.orders.params} sigma={agg.orders.sigma} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b py-3.5 px-5">
              <CardTitle className="text-[14px] font-semibold tracking-tight flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                Revenue forecast · ₱ per day
              </CardTitle>
              <CardDescription className="text-[12px]">
                Same model fit on daily peso revenue. Use this for cash-flow planning.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5 pb-2 px-3 sm:px-5">
              {aggLoading ? (
                <Skeleton className="h-72 w-full" />
              ) : chartData.length === 0 ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="confidence-rev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(152 56% 41%)" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="hsl(152 56% 41%)" stopOpacity={0.04} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                      tickFormatter={(v) => v?.slice(5)}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => "₱" + (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
                    />
                    <RTooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: any, name: string) => {
                        if (v == null) return ["—", name];
                        return [peso(v), name];
                      }}
                    />
                    {todayLabel && <ReferenceLine x={todayLabel} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />}
                    <Area type="monotone" dataKey="upperRev" stroke="none" fill="url(#confidence-rev)" name="95% upper" />
                    <Area type="monotone" dataKey="lowerRev" stroke="none" fill="hsl(var(--card))" name="95% lower" />
                    <Line type="monotone" dataKey="actualRev" stroke="hsl(152 56% 41%)" strokeWidth={2.5} dot={{ r: 2 }} name="Actual revenue" connectNulls={false} />
                    <Line type="monotone" dataKey="forecastRev" stroke="hsl(152 56% 41%)" strokeWidth={2} strokeDasharray="6 4" dot={{ r: 2, fill: "hsl(var(--card))", stroke: "hsl(152 56% 41%)", strokeWidth: 2 }} name="Forecast revenue" connectNulls={false} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
              {agg && (
                <ModelParamsRow label="Revenue model" params={agg.revenue.params} sigma={agg.revenue.sigma} />
              )}
            </CardContent>
          </Card>

          {/* Explanation card */}
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="pt-4 pb-4 px-5">
              <div className="flex items-start gap-3 text-[12.5px]">
                <Info className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p>
                    <span className="font-semibold">How to read this:</span> ARIMA(1, 1, 1) means the model uses the previous day's value (AR=1),
                    works on first differences to remove trend (I=1), and corrects on the previous forecast error (MA=1).
                  </p>
                  <p className="text-muted-foreground">
                    The shaded band is the 95% prediction interval — the true value will fall in this band 19 out of 20 days if the model assumptions hold.
                    Wider band = more uncertainty (typically further into the future or higher demand variability).
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Per-item tab ───────────────────────────────────── */}
        <TabsContent value="items" className="space-y-4 mt-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search item name or category…"
                className="pl-9 h-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-forecast-search"
              />
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>Urgency:</span>
              <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30">{urgencyCounts.critical} critical</Badge>
              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">{urgencyCounts.high} high</Badge>
              <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30">{urgencyCounts.medium} medium</Badge>
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">{urgencyCounts.low} low</Badge>
            </div>
          </div>

          {itemsLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : filteredItems.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                {items.length === 0
                  ? <div className="flex flex-col items-center gap-2">
                      <TrendingUp className="h-10 w-10 opacity-30" />
                      Not enough historical data yet — the model needs at least 5 days of inventory deductions to fit.
                    </div>
                  : "No items match your search."}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredItems.map((item) => (
                <ItemForecastRow
                  key={item.itemId}
                  item={item}
                  expanded={expandedItem === item.itemId}
                  onToggle={() => setExpandedItem(expandedItem === item.itemId ? null : item.itemId)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ForecastKpiTile({ label, value, format, suffix, color, icon: Icon, loading }: {
  label: string;
  value: number;
  format?: "currency";
  suffix?: string;
  color: "amber" | "emerald" | "red" | "blue";
  icon: any;
  loading?: boolean;
}) {
  const colorMap = {
    amber:   { bg: "bg-amber-50 dark:bg-amber-950/40", text: "text-amber-600 dark:text-amber-400", ring: "ring-amber-500/20" },
    emerald: { bg: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-500/20" },
    red:     { bg: "bg-red-50 dark:bg-red-950/40", text: "text-red-600 dark:text-red-400", ring: "ring-red-500/20" },
    blue:    { bg: "bg-blue-50 dark:bg-blue-950/40", text: "text-blue-600 dark:text-blue-400", ring: "ring-blue-500/20" },
  }[color];
  const display = format === "currency" ? peso(value) : Math.round(value).toLocaleString("en-PH");
  return (
    <div className={`rounded-xl border ring-1 ${colorMap.ring} bg-card p-3.5 hover:shadow-md transition-shadow`}>
      <div className="flex items-start justify-between mb-1">
        <p className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</p>
        <div className={`w-7 h-7 rounded-lg ${colorMap.bg} flex items-center justify-center`}>
          <Icon className={`h-3.5 w-3.5 ${colorMap.text}`} />
        </div>
      </div>
      {loading ? (
        <Skeleton className="h-7 w-20 mt-2" />
      ) : (
        <div className="font-mono tabular-nums text-2xl font-bold leading-none mt-2">{display}</div>
      )}
      {suffix && <p className="text-[10.5px] text-muted-foreground mt-1">{suffix}</p>}
    </div>
  );
}

function ItemForecastRow({ item, expanded, onToggle }: { item: ItemForecast; expanded: boolean; onToggle: () => void }) {
  const u = URGENCY_STYLES[item.reorderUrgency];

  // Mini chart data (sparkline + forecast)
  const miniData = useMemo(() => {
    const arr: any[] = [];
    item.series.forEach((v, i) => arr.push({ i, actual: v, forecast: null }));
    if (arr.length > 0) arr[arr.length - 1].forecast = arr[arr.length - 1].actual;
    item.forecast.forEach((v, i) => arr.push({ i: item.series.length + i, actual: null, forecast: v }));
    return arr;
  }, [item]);

  return (
    <Card className={`overflow-hidden ${expanded ? "ring-1 ring-primary/20" : ""}`}>
      <button
        className="w-full text-left p-3 hover:bg-muted/40 transition-colors"
        onClick={onToggle}
        data-testid={`row-forecast-${item.itemId}`}
      >
        <div className="flex items-center gap-3">
          {/* Urgency pill */}
          <div className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ring-1 ${u.bg} ${u.ring} ${u.text} shrink-0 whitespace-nowrap`}>
            {item.reorderUrgency}
          </div>
          {/* Identity */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm truncate">{item.itemName}</span>
              {item.category && <Badge variant="outline" className="text-[10px]">{item.category}</Badge>}
            </div>
            <div className="text-[11.5px] text-muted-foreground mt-0.5">
              {item.daysOfStock !== null && Number.isFinite(item.daysOfStock)
                ? <>~<span className="font-mono font-semibold">{item.daysOfStock}</span> days of stock left</>
                : <>no recent demand</>
              }
            </div>
          </div>
          {/* Numbers */}
          <div className="hidden sm:flex items-center gap-5 shrink-0">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Stock</div>
              <div className="font-mono font-semibold text-sm tabular-nums">{item.currentStock}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg/day</div>
              <div className="font-mono font-semibold text-sm tabular-nums">{item.avgDailyDemand}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Forecast</div>
              <div className="font-mono font-semibold text-sm tabular-nums">{Math.round(item.totalForecastDemand)}</div>
            </div>
          </div>
          {/* Mini sparkline */}
          <div className="hidden md:block w-24 h-10 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={miniData}>
                <Line type="monotone" dataKey="actual" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="forecast" stroke="hsl(var(--primary))" strokeWidth={1.5} strokeDasharray="3 2" dot={false} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t bg-muted/20 px-4 py-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Daily demand · history + forecast</p>
              <ResponsiveContainer width="100%" height={160}>
                <ComposedChart data={miniData}>
                  <defs>
                    <linearGradient id={`band-${item.itemId}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(38 92% 55%)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="hsl(38 92% 55%)" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="i" hide />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <RTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                  <Line type="monotone" dataKey="actual" stroke="hsl(38 92% 50%)" strokeWidth={2} dot={{ r: 2 }} name="Actual" connectNulls={false} />
                  <Line type="monotone" dataKey="forecast" stroke="hsl(38 92% 50%)" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 2, fill: "hsl(var(--card))", stroke: "hsl(38 92% 50%)", strokeWidth: 2 }} name="Forecast" connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2.5 text-[12.5px]">
              <p className="font-semibold mb-1">{u.label}</p>
              <Stat label="Avg daily demand" value={`${item.avgDailyDemand} units/day`} />
              <Stat label="Total forecast demand" value={`${Math.round(item.totalForecastDemand)} units`} />
              <Stat label="Current stock" value={`${item.currentStock} units`} />
              <Stat label="Days of stock" value={item.daysOfStock !== null && Number.isFinite(item.daysOfStock) ? `${item.daysOfStock} days` : "—"} />
              <Stat label="Forecast revenue" value={peso(item.totalForecastDemand * item.unitPrice)} />
              <Stat label="Model fit" value={`φ=${item.model.phi.toFixed(2)} · θ=${item.model.theta.toFixed(2)} · σ=${item.sigma}`} mono />
              <Stat label="Observations" value={`${item.observations} daily points`} />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-border/60 pb-1">
      <span className="text-muted-foreground text-[11.5px] uppercase tracking-wider font-semibold">{label}</span>
      <span className={mono ? "font-mono tabular-nums font-medium text-[12px]" : "font-medium text-[13px]"}>{value}</span>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-72 grid place-items-center text-sm text-muted-foreground">
      <div className="flex flex-col items-center gap-2">
        <Calendar className="h-10 w-10 opacity-30" />
        Not enough historical data for the lookback window.
      </div>
    </div>
  );
}

function ModelParamsRow({ label, params, sigma }: { label: string; params: any; sigma: number }) {
  return (
    <div className="mt-3 text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap border-t pt-2.5">
      <span className="font-semibold uppercase tracking-wider">{label}:</span>
      <code className="font-mono">φ = {params.phi?.toFixed(3) ?? "—"}</code>
      <span className="opacity-50">·</span>
      <code className="font-mono">θ = {params.theta?.toFixed(3) ?? "—"}</code>
      <span className="opacity-50">·</span>
      <code className="font-mono">intercept = {params.intercept?.toFixed(2) ?? "—"}</code>
      <span className="opacity-50">·</span>
      <code className="font-mono">σ (residual) = {sigma?.toFixed(2) ?? "—"}</code>
    </div>
  );
}
