import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import {
  BookOpen,
  Plus,
  Loader2,
  Calculator,
  FileText,
  TrendingUp,
  TrendingDown,
  BarChart3,
} from "lucide-react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ledgerEntrySchema, type LedgerEntryInput, type IAccountingAccount, type IGeneralLedgerEntry } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ─── PDF HELPERS ─────────────────────────────────────────────────────────────

function pdfCurrency(v: number): string {
  const abs = Math.abs(v);
  const parts = abs.toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (v < 0 ? "-PHP " : "PHP ") + parts[0] + "." + parts[1];
}

function pdfHeader(doc: jsPDF, title: string, subtitle?: string) {
  const pageW = doc.internal.pageSize.getWidth();
  const primaryColor: [number, number, number] = [30, 58, 95];
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, pageW, 44, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(17);
  doc.setFont("helvetica", "bold");
  doc.text("JOAP HARDWARE TRADING", pageW / 2, 15, { align: "center" });
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(title, pageW / 2, 26, { align: "center" });
  if (subtitle) {
    doc.setFontSize(9);
    doc.text(subtitle, pageW / 2, 36, { align: "center" });
  }
  doc.setTextColor(0, 0, 0);
  return 52;
}

function pdfFooter(doc: jsPDF) {
  const pageCount = (doc as any).internal.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Generated ${format(new Date(), "PPP")} — JOAP ERP | Page ${i} of ${pageCount}`,
      pageW / 2,
      pageH - 8,
      { align: "center" },
    );
    doc.setDrawColor(200, 200, 200);
    doc.line(14, pageH - 14, pageW - 14, pageH - 14);
  }
}

// Draw a simple bar chart using jsPDF primitives
function drawBarChart(
  doc: jsPDF,
  y: number,
  data: { label: string; debit: number; credit: number }[],
  chartWidth: number,
  chartHeight: number,
  startX: number,
) {
  if (data.length === 0) return y;

  const maxVal = Math.max(...data.flatMap((d) => [d.debit, d.credit]), 1);
  const barAreaH = chartHeight - 20;
  const groupW = chartWidth / data.length;
  const barW = Math.min(groupW * 0.35, 14);
  const gap = barW * 0.4;

  // Axes
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.5);
  doc.line(startX, y, startX, y + barAreaH);
  doc.line(startX, y + barAreaH, startX + chartWidth, y + barAreaH);

  // Bars
  data.forEach((d, i) => {
    const groupX = startX + i * groupW + groupW / 2 - barW - gap / 2;
    const debitH = (d.debit / maxVal) * barAreaH;
    const creditH = (d.credit / maxVal) * barAreaH;

    // Debit bar (blue)
    doc.setFillColor(37, 99, 235);
    if (debitH > 0) doc.rect(groupX, y + barAreaH - debitH, barW, debitH, "F");

    // Credit bar (green)
    doc.setFillColor(16, 185, 129);
    if (creditH > 0) doc.rect(groupX + barW + gap, y + barAreaH - creditH, barW, creditH, "F");

    // Label
    doc.setFontSize(6);
    doc.setTextColor(80, 80, 80);
    const labelX = groupX + barW + gap / 2;
    const labelText = d.label.length > 10 ? d.label.slice(0, 9) + "…" : d.label;
    doc.text(labelText, labelX, y + barAreaH + 7, { align: "center" });
  });

  // Legend
  const legendY = y + barAreaH + 16;
  doc.setFillColor(37, 99, 235);
  doc.rect(startX, legendY, 6, 4, "F");
  doc.setFontSize(7);
  doc.setTextColor(60, 60, 60);
  doc.text("Debit", startX + 8, legendY + 3.5);
  doc.setFillColor(16, 185, 129);
  doc.rect(startX + 28, legendY, 6, 4, "F");
  doc.text("Credit", startX + 36, legendY + 3.5);

  return y + chartHeight + 10;
}

// Draw a simple pie chart using jsPDF primitives
function drawPieChart(
  doc: jsPDF,
  cx: number,
  cy: number,
  radius: number,
  slices: { label: string; value: number; color: [number, number, number] }[],
) {
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  if (total === 0) return;

  let startAngle = -Math.PI / 2;
  slices.forEach((sl) => {
    if (sl.value === 0) return;
    const angle = (sl.value / total) * 2 * Math.PI;
    const endAngle = startAngle + angle;

    // Draw pie slice using multiple small line segments (approximation)
    doc.setFillColor(...sl.color);
    const steps = Math.max(12, Math.ceil((angle / (2 * Math.PI)) * 60));
    const points: number[][] = [[cx, cy]];
    for (let s = 0; s <= steps; s++) {
      const a = startAngle + (angle * s) / steps;
      points.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
    }
    // Draw as polygon
    doc.lines(
      points.slice(1).map((p, i) =>
        i === 0 ? [p[0] - points[0][0], p[1] - points[0][1]] : [p[0] - points[i][0], p[1] - points[i][1]],
      ),
      points[0][0],
      points[0][1],
      [1, 1],
      "FD",
      true,
    );

    startAngle = endAngle;
  });
}

// ─── CHART COLORS ─────────────────────────────────────────────────────────────

const CHART_COLORS = [
  "hsl(217,91%,60%)",
  "hsl(142,72%,45%)",
  "hsl(25,95%,53%)",
  "hsl(270,75%,60%)",
  "hsl(330,80%,55%)",
  "hsl(190,90%,45%)",
  "hsl(60,90%,50%)",
  "hsl(0,72%,51%)",
];

const PIE_PDF_COLORS: [number, number, number][] = [
  [37, 99, 235],
  [16, 185, 129],
  [245, 158, 11],
  [139, 92, 246],
  [236, 72, 153],
  [6, 182, 212],
  [234, 179, 8],
  [239, 68, 68],
];

// ─── FORMAT HELPERS ───────────────────────────────────────────────────────────

const formatCurrency = (v: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v);

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function AccountingPage() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [addEntryOpen, setAddEntryOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState("");
  const [exportingPdf, setExportingPdf] = useState(false);

  const { data: accountsData, isLoading: accountsLoading } = useQuery<{
    success: boolean;
    data: IAccountingAccount[];
  }>({
    queryKey: ["/api/accounting/accounts"],
  });

  const { data: ledgerData, isLoading: ledgerLoading } = useQuery<{
    success: boolean;
    data: { entries: IGeneralLedgerEntry[]; total: number };
  }>({
    queryKey: ["/api/accounting/ledger"],
    refetchInterval: 30_000,
  });

  const { data: summaryData } = useQuery<{
    success: boolean;
    data: Array<{ accountName: string; debit: number; credit: number; net: number }>;
  }>({
    queryKey: ["/api/accounting/summary"],
    refetchInterval: 30_000,
  });

  const accounts = accountsData?.data || [];
  const ledgerEntries = ledgerData?.data?.entries || [];
  const summaryEntries = summaryData?.data || [];

  const filteredEntries = useMemo(
    () => (dateFilter ? ledgerEntries.filter((e) => e.date.startsWith(dateFilter)) : ledgerEntries),
    [ledgerEntries, dateFilter],
  );

  const totalDebits = filteredEntries.reduce((sum, e) => sum + e.debit, 0);
  const totalCredits = filteredEntries.reduce((sum, e) => sum + e.credit, 0);
  const netBalance = totalDebits - totalCredits;

  // Account type lookup map
  const accountTypeMap = useMemo(() => {
    const map: Record<string, string> = {};
    accounts.forEach((a) => { map[a.accountName] = a.accountType; });
    // Hard-code well-known names in case not in accounts list
    map["Cash/GCash"] = "Asset";
    map["Accounts Receivable"] = "Asset";
    map["Inventory"] = "Asset";
    map["Accounts Payable"] = "Liability";
    map["Owner's Equity"] = "Equity";
    map["Sales Revenue"] = "Revenue";
    map["Cost of Goods Sold"] = "Expense";
    map["Operating Expenses"] = "Expense";
    return map;
  }, [accounts]);

  // Per-account aggregates for charts (computed from summary for accuracy)
  const accountChartData = useMemo(() => {
    return summaryEntries
      .map((s) => ({ label: s.accountName, debit: s.debit, credit: s.credit, type: accountTypeMap[s.accountName] || "Other" }))
      .sort((a, b) => b.debit + b.credit - (a.debit + a.credit));
  }, [summaryEntries, accountTypeMap]);

  // Account type totals for pie chart (from summary)
  const accountTypeData = useMemo(() => {
    const map: Record<string, number> = {};
    summaryEntries.forEach((s) => {
      const t = accountTypeMap[s.accountName] || "Other";
      map[t] = (map[t] || 0) + Math.abs(s.net);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).filter((d) => d.value > 0);
  }, [summaryEntries, accountTypeMap]);

  // Financial position totals — computed from ALL ledger entries via summary endpoint
  const revenueTotal = summaryEntries
    .filter((s) => accountTypeMap[s.accountName] === "Revenue")
    .reduce((sum, s) => sum + (s.credit - s.debit), 0);
  const expenseTotal = summaryEntries
    .filter((s) => accountTypeMap[s.accountName] === "Expense")
    .reduce((sum, s) => sum + (s.debit - s.credit), 0);
  const assetTotal = summaryEntries
    .filter((s) => accountTypeMap[s.accountName] === "Asset")
    .reduce((sum, s) => sum + (s.debit - s.credit), 0);
  const liabilityTotal = summaryEntries
    .filter((s) => accountTypeMap[s.accountName] === "Liability")
    .reduce((sum, s) => sum + (s.credit - s.debit), 0);
  const grossProfit = revenueTotal - expenseTotal;

  // ─── FORM ─────────────────────────────────────────────────────────────────

  const form = useForm<LedgerEntryInput>({
    resolver: zodResolver(ledgerEntrySchema),
    defaultValues: {
      date: new Date().toISOString().split("T")[0],
      accountName: "",
      debit: 0,
      credit: 0,
      description: "",
      referenceType: "",
      referenceId: "",
    },
  });

  const addMutation = useMutation({
    mutationFn: async (data: LedgerEntryInput) => {
      const res = await apiRequest("POST", "/api/accounting/ledger", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/accounts"] });
      setAddEntryOpen(false);
      form.reset();
      toast({ title: "Entry added successfully" });
    },
    onError: (err: Error) =>
      toast({ title: "Failed to add entry", description: err.message, variant: "destructive" }),
  });

  // ─── PDF EXPORT ───────────────────────────────────────────────────────────

  function exportPDF() {
    setExportingPdf(true);
    try {
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const dateLabel = dateFilter ? `Date: ${dateFilter}` : `All Entries — Generated ${format(new Date(), "PPP")}`;
      let y = pdfHeader(doc, "Accounting Report", dateLabel);

      // ── KPI Summary Row ────────────────────────────────────────────────
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(14, y, pageW - 28, 28, 3, 3, "F");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      const kpis = [
        { label: "Total Debits", value: pdfCurrency(totalDebits), color: [37, 99, 235] as [number, number, number] },
        { label: "Total Credits", value: pdfCurrency(totalCredits), color: [16, 185, 129] as [number, number, number] },
        { label: "Net Balance", value: pdfCurrency(netBalance), color: netBalance >= 0 ? [16, 185, 129] as [number, number, number] : [239, 68, 68] as [number, number, number] },
        { label: "Total Accounts", value: String(accounts.length), color: [139, 92, 246] as [number, number, number] },
      ];
      const kpiW = (pageW - 28) / kpis.length;
      kpis.forEach((kpi, i) => {
        const kx = 14 + i * kpiW + kpiW / 2;
        doc.setTextColor(...(kpi.color));
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text(kpi.value, kx, y + 13, { align: "center" });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text(kpi.label, kx, y + 21, { align: "center" });
      });
      y += 36;

      // ── Financial Position Summary ─────────────────────────────────────
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("Financial Position Summary", 14, y);
      y += 6;
      const positionData = [
        ["Account Category", "Total Balance"],
        ["Assets", pdfCurrency(assetTotal)],
        ["Liabilities", pdfCurrency(liabilityTotal)],
        ["Revenue", pdfCurrency(revenueTotal)],
        ["Expenses", pdfCurrency(expenseTotal)],
      ];
      autoTable(doc, {
        startY: y,
        head: [positionData[0]],
        body: positionData.slice(1),
        headStyles: { fillColor: [30, 58, 95], fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        columnStyles: { 1: { halign: "right" } },
        margin: { left: 14, right: 14 },
        tableWidth: (pageW - 28) / 2,
      });
      y = (doc as any).lastAutoTable.finalY + 10;

      // ── Debits vs Credits Bar Chart ────────────────────────────────────
      if (accountChartData.length > 0) {
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(15, 23, 42);
        doc.text("Debits vs Credits by Account", 14, y);
        y += 4;
        const topAccounts = accountChartData.slice(0, 8);
        const chartW = pageW - 28;
        const nextY = drawBarChart(doc, y, topAccounts, chartW, 55, 14);
        y = nextY + 4;
      }

      // ── Account Type Distribution (Pie chart via table + legend) ──────
      if (accountTypeData.length > 0) {
        // Check if we need a new page
        if (y > 210) {
          doc.addPage();
          y = 20;
        }
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(15, 23, 42);
        doc.text("Account Type Distribution", 14, y);
        y += 6;

        // Legend table for pie
        autoTable(doc, {
          startY: y,
          head: [["Account Type", "Balance", "% of Total"]],
          body: accountTypeData.map((d, i) => {
            const pct = accountTypeData.reduce((s, x) => s + x.value, 0);
            return [
              d.name,
              pdfCurrency(d.value),
              pct > 0 ? `${((d.value / pct) * 100).toFixed(1)}%` : "0%",
            ];
          }),
          headStyles: { fillColor: [30, 58, 95], fontSize: 9 },
          bodyStyles: { fontSize: 9 },
          columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
          margin: { left: 14, right: 14 },
          tableWidth: (pageW - 28) * 0.55,
          didDrawCell: (data) => {
            if (data.section === "body" && data.column.index === 0 && data.row.index < accountTypeData.length) {
              const color = PIE_PDF_COLORS[data.row.index % PIE_PDF_COLORS.length];
              doc.setFillColor(...color);
              doc.rect(data.cell.x + 1, data.cell.y + data.cell.height / 2 - 1.5, 4, 3, "F");
            }
          },
        });
        y = (doc as any).lastAutoTable.finalY + 10;
      }

      // ── Chart of Accounts Table ────────────────────────────────────────
      if (y > 200) {
        doc.addPage();
        y = 20;
      }
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("Chart of Accounts", 14, y);
      y += 4;
      autoTable(doc, {
        startY: y,
        head: [["Code", "Account Name", "Type", "Balance"]],
        body: accounts.map((a) => [
          a.accountCode,
          a.accountName,
          a.accountType,
          pdfCurrency(a.balance),
        ]),
        headStyles: { fillColor: [30, 58, 95], fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        columnStyles: { 3: { halign: "right" } },
        margin: { left: 14, right: 14 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
      y = (doc as any).lastAutoTable.finalY + 10;

      // ── Ledger Entries Table ───────────────────────────────────────────
      if (filteredEntries.length > 0) {
        doc.addPage();
        y = 20;
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(15, 23, 42);
        doc.text("General Ledger Entries", 14, y);
        if (dateFilter) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          doc.text(`Filtered by: ${dateFilter}`, 14, y + 6);
          y += 4;
        }
        y += 6;

        // Running balance calculation
        let runningBalance = 0;
        const ledgerRows = filteredEntries.map((e) => {
          runningBalance += e.debit - e.credit;
          return [
            formatDate(e.date),
            e.accountName,
            e.debit > 0 ? pdfCurrency(e.debit) : "—",
            e.credit > 0 ? pdfCurrency(e.credit) : "—",
            pdfCurrency(runningBalance),
            e.description || "—",
          ];
        });

        autoTable(doc, {
          startY: y,
          head: [["Date", "Account", "Debit", "Credit", "Running Balance", "Description"]],
          body: ledgerRows,
          headStyles: { fillColor: [30, 58, 95], fontSize: 8 },
          bodyStyles: { fontSize: 7 },
          columnStyles: {
            2: { halign: "right" },
            3: { halign: "right" },
            4: { halign: "right" },
          },
          margin: { left: 14, right: 14 },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          foot: [[
            "TOTALS", "",
            pdfCurrency(totalDebits),
            pdfCurrency(totalCredits),
            pdfCurrency(netBalance),
            "",
          ]],
          footStyles: {
            fillColor: [30, 58, 95],
            textColor: [255, 255, 255],
            fontSize: 8,
            fontStyle: "bold",
          },
        });
      }

      pdfFooter(doc);
      const filename = dateFilter
        ? `accounting-report-${dateFilter}.pdf`
        : `accounting-report-${format(new Date(), "yyyyMMdd")}.pdf`;
      doc.save(filename);
      toast({ title: "PDF exported successfully" });
    } catch (err: any) {
      toast({ title: "PDF export failed", description: err.message, variant: "destructive" });
    } finally {
      setExportingPdf(false);
    }
  }

  // ─── LOADING STATE ────────────────────────────────────────────────────────

  if (accountsLoading || ledgerLoading) {
    return (
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 pb-10">
        <h1 className="text-xl sm:text-2xl font-bold">Accounting</h1>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 sm:gap-4 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-accounting-title">
            Accounting
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">General ledger and chart of accounts</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportPDF}
            disabled={exportingPdf}
          >
            {exportingPdf ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <FileText className="mr-1 h-4 w-4" />
            )}
            Export PDF
          </Button>
          {isAdmin && (
            <Button onClick={() => setAddEntryOpen(true)} size="sm" data-testid="button-add-entry">
              <Plus className="mr-1 h-4 w-4" /> Add Entry
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        {[
          {
            label: "Total Debits",
            value: formatCurrency(totalDebits),
            icon: TrendingDown,
            color: "text-blue-600",
            bg: "bg-blue-50 dark:bg-blue-950/30",
          },
          {
            label: "Total Credits",
            value: formatCurrency(totalCredits),
            icon: TrendingUp,
            color: "text-emerald-600",
            bg: "bg-emerald-50 dark:bg-emerald-950/30",
          },
          {
            label: "Net Balance",
            value: formatCurrency(netBalance),
            icon: Calculator,
            color: netBalance >= 0 ? "text-emerald-600" : "text-red-600",
            bg: netBalance >= 0 ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-red-50 dark:bg-red-950/30",
          },
          {
            label: "Gross Profit",
            value: formatCurrency(grossProfit),
            icon: BookOpen,
            color: grossProfit >= 0 ? "text-violet-600" : "text-red-600",
            bg: grossProfit >= 0 ? "bg-violet-50 dark:bg-violet-950/30" : "bg-red-50 dark:bg-red-950/30",
          },
        ].map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className={kpi.bg}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">{kpi.label}</CardTitle>
                <Icon className={`h-4 w-4 ${kpi.color}`} />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className={`text-xl font-bold ${kpi.color}`} data-testid={`stat-${kpi.label.toLowerCase().replace(/\s/g, "-")}`}>
                  {kpi.value}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts Row */}
      {(accountChartData.length > 0 || accountTypeData.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Debits vs Credits Bar Chart */}
          {accountChartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Debits vs Credits by Account
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={accountChartData.slice(0, 8)} margin={{ bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9 }}
                      angle={-30}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: "10px" }} />
                    <Bar dataKey="debit" name="Debit" fill="hsl(217,91%,60%)" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="credit" name="Credit" fill="hsl(142,72%,45%)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Account Type Pie Chart */}
          {accountTypeData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Account Type Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={accountTypeData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {accountTypeData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: "10px" }} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Financial Position Mini Summary */}
      {accounts.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Assets", value: assetTotal, color: "text-blue-600" },
            { label: "Liabilities", value: liabilityTotal, color: "text-red-600" },
            { label: "Revenue", value: revenueTotal, color: "text-emerald-600" },
            { label: "Expenses", value: expenseTotal, color: "text-amber-600" },
          ].map((item) => (
            <Card key={item.label}>
              <CardContent className="p-3 sm:p-4">
                <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
                <p className={`text-base sm:text-lg font-bold truncate ${item.color}`}>
                  {formatCurrency(item.value)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* General Ledger (only tab) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">General Ledger</h2>
        </div>
        <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="w-[200px]"
                data-testid="input-date-filter"
              />
              {dateFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDateFilter("")}
                  data-testid="button-clear-filter"
                >
                  Clear
                </Button>
              )}
              <span className="text-sm text-muted-foreground ml-auto">
                {filteredEntries.length} entr{filteredEntries.length === 1 ? "y" : "ies"}
              </span>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Reference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No entries found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredEntries.map((entry) => (
                        <TableRow key={entry._id} data-testid={`row-ledger-${entry._id}`}>
                          <TableCell className="text-muted-foreground text-sm">
                            {formatDate(entry.date)}
                          </TableCell>
                          <TableCell className="font-medium">{entry.accountName}</TableCell>
                          <TableCell className="text-right text-blue-600 font-medium">
                            {entry.debit > 0 ? formatCurrency(entry.debit) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right text-emerald-600 font-medium">
                            {entry.credit > 0 ? formatCurrency(entry.credit) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {entry.description || <span className="text-muted-foreground/50">—</span>}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {entry.referenceType
                              ? `${entry.referenceType}:${entry.referenceId}`
                              : <span className="text-muted-foreground/50">—</span>}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Ledger Totals Footer */}
            {filteredEntries.length > 0 && (
              <div className="flex justify-end gap-6 px-4 py-2 bg-muted/50 rounded-lg text-sm">
                <div>
                  <span className="text-muted-foreground">Total Debits: </span>
                  <span className="font-bold text-blue-600">{formatCurrency(totalDebits)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Credits: </span>
                  <span className="font-bold text-emerald-600">{formatCurrency(totalCredits)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Balance: </span>
                  <span className={`font-bold ${netBalance >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {formatCurrency(netBalance)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

      {/* Add Entry Dialog */}
      <Dialog open={addEntryOpen} onOpenChange={setAddEntryOpen}>

        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Ledger Entry</DialogTitle>
            <DialogDescription>Create a manual double-entry journal entry.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((data) => addMutation.mutate(data))} className="space-y-4">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-entry-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="accountName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g. Cash/GCash, Sales Revenue"
                        list="account-names"
                        data-testid="input-entry-account"
                      />
                    </FormControl>
                    <datalist id="account-names">
                      {accounts.map((a) => (
                        <option key={a._id} value={a.accountName} />
                      ))}
                    </datalist>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="debit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Debit (PHP)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          {...field}
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                          data-testid="input-entry-debit"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="credit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Credit (PHP)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          {...field}
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                          data-testid="input-entry-credit"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Transaction description" data-testid="input-entry-description" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={addMutation.isPending}
                data-testid="button-submit-entry"
              >
                {addMutation.isPending && <Loader2 className="animate-spin mr-1" />}
                Add Entry
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
