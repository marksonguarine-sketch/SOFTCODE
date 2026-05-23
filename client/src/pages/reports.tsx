import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, startOfMonth, endOfMonth, startOfYear, isWithinInterval } from "date-fns";
import {
  BarChart3, Download, FileSpreadsheet, FileText, TrendingUp, Package,
  ShoppingBag, Tag, CalendarCheck, ChevronDown, AlertCircle,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import type { IOrder, IItem } from "@shared/schema";

const PIE_COLORS = ["hsl(217,91%,60%)", "hsl(142,72%,45%)", "hsl(25,95%,53%)", "hsl(270,75%,60%)", "hsl(330,80%,55%)", "hsl(190,90%,45%)", "hsl(60,90%,50%)"];

function formatPHP(v: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v);
}

// ─── DATE RANGE HELPER ───────────────────────────────────────────────────────

type DatePreset = "7d" | "30d" | "3m" | "ytd" | "custom";

function getPresetRange(preset: DatePreset): [Date, Date] {
  const now = new Date();
  if (preset === "7d") return [subDays(now, 7), now];
  if (preset === "30d") return [subDays(now, 30), now];
  if (preset === "3m") return [subDays(now, 90), now];
  if (preset === "ytd") return [startOfYear(now), now];
  return [startOfMonth(now), endOfMonth(now)];
}

function DateRangePicker({
  preset, onPreset, startDate, endDate, onStartDate, onEndDate,
}: {
  preset: DatePreset; onPreset: (p: DatePreset) => void;
  startDate: string; endDate: string;
  onStartDate: (v: string) => void; onEndDate: (v: string) => void;
}) {
  const presets: { value: DatePreset; label: string }[] = [
    { value: "7d", label: "Last 7 Days" },
    { value: "30d", label: "Last 30 Days" },
    { value: "3m", label: "Last 3 Months" },
    { value: "ytd", label: "Year to Date" },
    { value: "custom", label: "Custom Range" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 flex-wrap">
        {presets.map((p) => (
          <Button key={p.value} size="sm" variant={preset === p.value ? "default" : "outline"} className="h-7 text-xs"
            onClick={() => onPreset(p.value)}>
            {p.label}
          </Button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex items-center gap-2">
          <Input type="date" value={startDate} onChange={(e) => onStartDate(e.target.value)} className="h-7 w-36 text-xs" />
          <span className="text-muted-foreground text-xs">to</span>
          <Input type="date" value={endDate} onChange={(e) => onEndDate(e.target.value)} className="h-7 w-36 text-xs" />
        </div>
      )}
    </div>
  );
}

// ─── PDF + EXCEL HELPERS ─────────────────────────────────────────────────────

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
  doc.rect(0, 0, pageW, 42, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text("JOAP HARDWARE TRADING", pageW / 2, 14, { align: "center" });
  doc.setFontSize(10); doc.setFont("helvetica", "normal");
  doc.text(title, pageW / 2, 24, { align: "center" });
  if (subtitle) { doc.setFontSize(9); doc.text(subtitle, pageW / 2, 33, { align: "center" }); }
  doc.setTextColor(0, 0, 0);
  return 50;
}

function pdfFooter(doc: jsPDF) {
  const pageCount = (doc as any).internal.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(150, 150, 150);
    doc.text(`Generated ${format(new Date(), "PPP")} — JOAP ERP | Page ${i} of ${pageCount}`, pageW / 2, pageH - 8, { align: "center" });
  }
}

function exportToExcel(sheets: { name: string; headers: string[]; rows: any[][] }[], filename: string) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, headers, rows }) => {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const colWidths = headers.map((h, i) => {
      const maxLen = Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length));
      return { wch: Math.min(50, maxLen + 2) };
    });
    ws["!cols"] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  });
  XLSX.writeFile(wb, filename);
}

// ─── REPORT 1: SALES ─────────────────────────────────────────────────────────

function SalesReport({ orders, startD, endD }: { orders: IOrder[]; startD: Date; endD: Date }) {
  const filtered = orders.filter((o) => {
    const d = new Date((o as any).createdAt || (o as any).orderDate);
    return d >= startD && d <= endD;
  });

  const totalRevenue = filtered.reduce((s, o) => s + o.totalAmount, 0);
  const totalOrders = filtered.length;
  const avgOrderValue = totalOrders ? totalRevenue / totalOrders : 0;
  const paidRevenue = filtered.filter((o) => (o as any).paymentStatus === "paid").reduce((s, o) => s + o.totalAmount, 0);

  const byDay = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((o) => {
      const d = format(new Date((o as any).createdAt || (o as any).orderDate), "MMM d");
      map[d] = (map[d] || 0) + o.totalAmount;
    });
    return Object.entries(map).map(([date, revenue]) => ({ date, revenue })).slice(-30);
  }, [filtered]);

  const byPaymentStatus = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((o) => { const s = (o as any).paymentStatus || "unknown"; map[s] = (map[s] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));
  }, [filtered]);

  const topItems = useMemo(() => {
    const map: Record<string, { name: string; qty: number; revenue: number }> = {};
    filtered.forEach((o) => o.items.forEach((it: any) => {
      const id = it.itemId;
      if (!map[id]) map[id] = { name: it.itemName, qty: 0, revenue: 0 };
      map[id].qty += it.qty ?? 1;
      map[id].revenue += it.lineTotal ?? 0;
    }));
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [filtered]);

  function exportPDF() {
    const doc = new jsPDF();
    let y = pdfHeader(doc, "Sales Report", `${format(startD, "MMM d yyyy")} – ${format(endD, "MMM d yyyy")}`);
    doc.setFontSize(10);
    const stats = [
      ["Total Orders", String(totalOrders)], ["Total Revenue", pdfCurrency(totalRevenue)],
      ["Avg Order Value", pdfCurrency(avgOrderValue)], ["Collected Revenue", pdfCurrency(paidRevenue)],
    ];
    stats.forEach(([l, v], i) => {
      doc.setFont("helvetica", "bold"); doc.text(`${l}:`, 14, y + i * 6);
      doc.setFont("helvetica", "normal"); doc.text(v, 80, y + i * 6);
    });
    y += stats.length * 6 + 8;
    autoTable(doc, {
      startY: y,
      head: [["Item Name", "Qty Sold", "Revenue"]],
      body: topItems.map((it) => [it.name, String(it.qty), pdfCurrency(it.revenue)]),
      headStyles: { fillColor: [30, 58, 95] },
      styles: { fontSize: 9 },
    });
    pdfFooter(doc);
    doc.save(`sales-report-${format(startD, "yyyyMMdd")}-${format(endD, "yyyyMMdd")}.pdf`);
  }

  function exportExcel() {
    exportToExcel([
      {
        name: "Sales Summary",
        headers: ["Metric", "Value"],
        rows: [
          ["Total Orders", totalOrders], ["Total Revenue", totalRevenue],
          ["Avg Order Value", avgOrderValue], ["Collected Revenue", paidRevenue],
        ],
      },
      {
        name: "Top Items",
        headers: ["Item Name", "Qty Sold", "Revenue (PHP)"],
        rows: topItems.map((it) => [it.name, it.qty, it.revenue]),
      },
      {
        name: "Orders List",
        headers: ["Tracking #", "Customer", "Date", "Total", "Payment", "Fulfillment"],
        rows: filtered.map((o: any) => [
          o.trackingNumber, o.customerName, format(new Date(o.createdAt || o.orderDate), "yyyy-MM-dd"),
          o.totalAmount, o.paymentStatus, o.fulfillmentStatus,
        ]),
      },
    ], `sales-report-${format(startD, "yyyyMMdd")}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={exportPDF}><FileText className="h-4 w-4 mr-2" />PDF</Button>
        <Button size="sm" variant="outline" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4 mr-2" />Excel</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Orders", value: totalOrders.toString(), color: "text-blue-600" },
          { label: "Total Revenue", value: formatPHP(totalRevenue), color: "text-green-600" },
          { label: "Avg Order Value", value: formatPHP(avgOrderValue), color: "text-purple-600" },
          { label: "Collected", value: formatPHP(paidRevenue), color: "text-teal-600" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
              <p className={`text-xl font-bold truncate ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {byDay.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Revenue Over Time</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={byDay}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatPHP(v)} />
                <Line type="monotone" dataKey="revenue" stroke="hsl(217,91%,60%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {byPaymentStatus.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Payment Status Breakdown</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={byPaymentStatus} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {byPaymentStatus.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
        {topItems.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Top 10 Items by Revenue</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topItems.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm">{it.name}</TableCell>
                      <TableCell className="text-right text-sm">{it.qty}</TableCell>
                      <TableCell className="text-right text-sm font-medium">{formatPHP(it.revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-20" />
          <p>No orders in the selected date range</p>
        </div>
      )}
    </div>
  );
}

// ─── REPORT 2: INVENTORY ─────────────────────────────────────────────────────

function InventoryReport({ items }: { items: IItem[] }) {
  const totalValue = items.reduce((s, i) => s + i.unitPrice * i.currentQuantity, 0);
  const criticalItems = items.filter((i) => i.currentQuantity <= 0);
  const lowItems = items.filter((i) => i.currentQuantity > 0 && i.currentQuantity <= i.reorderLevel);
  const normalItems = items.filter((i) => i.currentQuantity > i.reorderLevel);

  const byCategory = useMemo(() => {
    const map: Record<string, { count: number; value: number }> = {};
    items.forEach((it) => {
      const c = it.category || "Uncategorized";
      if (!map[c]) map[c] = { count: 0, value: 0 };
      map[c].count += 1;
      map[c].value += it.unitPrice * it.currentQuantity;
    });
    return Object.entries(map).map(([name, { count, value }]) => ({ name, count, value })).sort((a, b) => b.value - a.value);
  }, [items]);

  const stockStatusData = [
    { name: "Normal", value: normalItems.length },
    { name: "Low Stock", value: lowItems.length },
    { name: "Critical", value: criticalItems.length },
  ].filter((d) => d.value > 0);

  function exportPDF() {
    const doc = new jsPDF();
    let y = pdfHeader(doc, "Inventory Report", `Generated ${format(new Date(), "MMM d, yyyy")}`);
    doc.setFontSize(9);
    [
      ["Total Items", String(items.length)],
      ["Total Stock Value", pdfCurrency(totalValue)],
      ["Critical (0 qty)", String(criticalItems.length)],
      ["Low Stock", String(lowItems.length)],
    ].forEach(([l, v], i) => {
      doc.setFont("helvetica", "bold"); doc.text(`${l}:`, 14, y + i * 6);
      doc.setFont("helvetica", "normal"); doc.text(v, 80, y + i * 6);
    });
    y += 32;
    if (criticalItems.length > 0) {
      doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.text("Critical Stock Items", 14, y); y += 6;
      autoTable(doc, {
        startY: y,
        head: [["Item Name", "Category", "Supplier", "Unit Price", "Qty"]],
        body: criticalItems.map((it) => [it.itemName, it.category, it.supplierName || "-", pdfCurrency(it.unitPrice), String(it.currentQuantity)]),
        headStyles: { fillColor: [220, 53, 69] },
        styles: { fontSize: 8 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }
    autoTable(doc, {
      startY: y,
      head: [["Item Name", "Category", "Price", "Qty", "Stock Value", "Status"]],
      body: items.map((it) => [
        it.itemName, it.category, pdfCurrency(it.unitPrice), String(it.currentQuantity),
        pdfCurrency(it.unitPrice * it.currentQuantity),
        it.currentQuantity <= 0 ? "Critical" : it.currentQuantity <= it.reorderLevel ? "Low" : "Normal",
      ]),
      headStyles: { fillColor: [30, 58, 95] },
      styles: { fontSize: 7 },
    });
    pdfFooter(doc);
    doc.save(`inventory-report-${format(new Date(), "yyyyMMdd")}.pdf`);
  }

  function exportExcel() {
    exportToExcel([
      {
        name: "Inventory Overview",
        headers: ["Metric", "Value"],
        rows: [
          ["Total Items", items.length], ["Total Stock Value (PHP)", totalValue],
          ["Critical Items", criticalItems.length], ["Low Stock Items", lowItems.length],
          ["Normal Items", normalItems.length],
        ],
      },
      {
        name: "All Items",
        headers: ["Item Name", "Category", "Supplier", "Unit Price (PHP)", "Qty", "Stock Value (PHP)", "Status"],
        rows: items.map((it) => [
          it.itemName, it.category, it.supplierName || "", it.unitPrice,
          it.currentQuantity, it.unitPrice * it.currentQuantity,
          it.currentQuantity <= 0 ? "Critical" : it.currentQuantity <= it.reorderLevel ? "Low" : "Normal",
        ]),
      },
      {
        name: "Critical Stock",
        headers: ["Item Name", "Category", "Supplier", "Unit Price (PHP)", "Qty", "Reorder Level"],
        rows: criticalItems.map((it) => [it.itemName, it.category, it.supplierName || "", it.unitPrice, it.currentQuantity, it.reorderLevel]),
      },
      {
        name: "By Category",
        headers: ["Category", "Item Count", "Total Value (PHP)"],
        rows: byCategory.map((c) => [c.name, c.count, c.value]),
      },
    ], `inventory-report-${format(new Date(), "yyyyMMdd")}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={exportPDF}><FileText className="h-4 w-4 mr-2" />PDF</Button>
        <Button size="sm" variant="outline" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4 mr-2" />Excel</Button>
      </div>
      {criticalItems.length > 0 && (
        <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
          <p className="text-sm text-destructive"><span className="font-semibold">{criticalItems.length} items</span> are completely out of stock.</p>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Items", value: items.length, color: "text-blue-600" },
          { label: "Total Stock Value", value: formatPHP(totalValue), color: "text-green-600" },
          { label: "Critical (0 qty)", value: criticalItems.length, color: "text-red-600" },
          { label: "Low Stock", value: lowItems.length, color: "text-amber-600" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
              <p className={`text-xl font-bold truncate ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Stock Status Distribution</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={stockStatusData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {stockStatusData.map((entry, i) => (
                    <Cell key={i} fill={entry.name === "Critical" ? "hsl(0,72%,51%)" : entry.name === "Low Stock" ? "hsl(40,96%,40%)" : "hsl(142,72%,45%)"} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Value by Category</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byCategory.slice(0, 8)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={80} />
                <Tooltip formatter={(v: number) => formatPHP(v)} />
                <Bar dataKey="value" fill="hsl(217,91%,60%)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
      {criticalItems.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-destructive">Critical Stock Items</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {criticalItems.map((it) => (
                  <TableRow key={it._id} className="bg-red-50/50">
                    <TableCell className="font-medium">{it.itemName}</TableCell>
                    <TableCell>{it.category}</TableCell>
                    <TableCell className="text-muted-foreground">{it.supplierName || "—"}</TableCell>
                    <TableCell className="text-right">{formatPHP(it.unitPrice)}</TableCell>
                    <TableCell className="text-right font-bold text-red-600">{it.currentQuantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── REPORT 3: ORDERS ────────────────────────────────────────────────────────

function OrdersReport({ orders, startD, endD }: { orders: IOrder[]; startD: Date; endD: Date }) {
  const filtered = orders.filter((o) => {
    const d = new Date((o as any).createdAt || (o as any).orderDate);
    return d >= startD && d <= endD;
  });

  const byOrderType = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((o) => { const t = (o as any).orderType || "unknown"; map[t] = (map[t] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));
  }, [filtered]);

  const byFulfillment = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((o) => { const s = (o as any).fulfillmentStatus || "unknown"; map[s] = (map[s] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));
  }, [filtered]);

  const byChannel = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((o) => { const c = (o as any).orderChannel || "unknown"; map[c] = (map[c] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));
  }, [filtered]);

  const topCustomers = useMemo(() => {
    const map: Record<string, { name: string; orders: number; total: number }> = {};
    filtered.forEach((o) => {
      const key = (o as any).customerName || "Unknown";
      if (!map[key]) map[key] = { name: key, orders: 0, total: 0 };
      map[key].orders += 1;
      map[key].total += o.totalAmount;
    });
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [filtered]);

  function exportPDF() {
    const doc = new jsPDF();
    let y = pdfHeader(doc, "Orders Report", `${format(startD, "MMM d yyyy")} – ${format(endD, "MMM d yyyy")}`);
    autoTable(doc, {
      startY: y,
      head: [["Tracking #", "Customer", "Date", "Type", "Total", "Payment", "Status"]],
      body: filtered.map((o: any) => [
        o.trackingNumber, o.customerName,
        format(new Date(o.createdAt || o.orderDate), "MMM d yyyy"),
        (o.orderType || "").replace(/_/g, " "), pdfCurrency(o.totalAmount),
        (o.paymentStatus || "").replace(/_/g, " "), o.fulfillmentStatus,
      ]),
      headStyles: { fillColor: [30, 58, 95] },
      styles: { fontSize: 7 },
    });
    pdfFooter(doc);
    doc.save(`orders-report-${format(startD, "yyyyMMdd")}.pdf`);
  }

  function exportExcel() {
    exportToExcel([
      {
        name: "Orders",
        headers: ["Tracking #", "Customer", "Date", "Type", "Total (PHP)", "Payment Status", "Fulfillment"],
        rows: filtered.map((o: any) => [
          o.trackingNumber, o.customerName,
          format(new Date(o.createdAt || o.orderDate), "yyyy-MM-dd"),
          o.orderType, o.totalAmount, o.paymentStatus, o.fulfillmentStatus,
        ]),
      },
      {
        name: "Top Customers",
        headers: ["Customer Name", "Order Count", "Total Spent (PHP)"],
        rows: topCustomers.map((c) => [c.name, c.orders, c.total]),
      },
      {
        name: "By Order Type",
        headers: ["Order Type", "Count"],
        rows: byOrderType.map((t) => [t.name, t.value]),
      },
      {
        name: "By Fulfillment",
        headers: ["Fulfillment Status", "Count"],
        rows: byFulfillment.map((t) => [t.name, t.value]),
      },
    ], `orders-report-${format(startD, "yyyyMMdd")}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={exportPDF}><FileText className="h-4 w-4 mr-2" />PDF</Button>
        <Button size="sm" variant="outline" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4 mr-2" />Excel</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Orders", value: filtered.length },
          { label: "Total Revenue", value: formatPHP(filtered.reduce((s, o) => s + o.totalAmount, 0)) },
          { label: "Completed", value: filtered.filter((o: any) => o.fulfillmentStatus === "completed").length },
          { label: "Cancelled", value: filtered.filter((o: any) => o.fulfillmentStatus === "cancelled").length },
        ].map((s) => (
          <Card key={s.label}><CardContent className="p-4"><p className="text-xs text-muted-foreground mb-1">{s.label}</p><p className="text-xl font-bold">{s.value}</p></CardContent></Card>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { title: "By Order Type", data: byOrderType },
          { title: "By Fulfillment", data: byFulfillment },
          { title: "By Channel", data: byChannel },
        ].map(({ title, data }) => data.length > 0 && (
          <Card key={title}>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={data} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value">
                    {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: "10px" }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ))}
      </div>
      {topCustomers.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Top Customers by Spend</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Total Spent</TableHead></TableRow></TableHeader>
              <TableBody>
                {topCustomers.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-right">{c.orders}</TableCell>
                    <TableCell className="text-right font-medium">{formatPHP(c.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── REPORT 4: OFFERS ────────────────────────────────────────────────────────

function OffersReport({ offers }: { offers: any[] }) {
  const activeOffers = offers.filter((o) => o.isActive && new Date(o.endDate) >= new Date());
  const totalSavings = offers.reduce((s, o) => s + (o.totalSavingsGenerated || 0), 0);
  const totalUsage = offers.reduce((s, o) => s + (o.usageCount || 0), 0);

  const byType = useMemo(() => {
    const map: Record<string, number> = {};
    offers.forEach((o) => { map[o.offerType] = (map[o.offerType] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));
  }, [offers]);

  function exportPDF() {
    const doc = new jsPDF();
    let y = pdfHeader(doc, "Offers Report", `Generated ${format(new Date(), "MMM d, yyyy")}`);
    autoTable(doc, {
      startY: y,
      head: [["Offer Name", "Type", "Status", "Usage", "Savings", "Start Date", "End Date"]],
      body: offers.map((o) => [
        o.name, o.offerType.replace(/_/g, " "),
        o.isActive ? "Active" : "Inactive",
        String(o.usageCount), pdfCurrency(o.totalSavingsGenerated || 0),
        format(new Date(o.startDate), "MMM d yyyy"),
        format(new Date(o.endDate), "MMM d yyyy"),
      ]),
      headStyles: { fillColor: [30, 58, 95] },
      styles: { fontSize: 8 },
    });
    pdfFooter(doc);
    doc.save(`offers-report-${format(new Date(), "yyyyMMdd")}.pdf`);
  }

  function exportExcel() {
    exportToExcel([
      {
        name: "Offers Summary",
        headers: ["Metric", "Value"],
        rows: [
          ["Total Offers", offers.length], ["Active Offers", activeOffers.length],
          ["Total Savings Generated (PHP)", totalSavings], ["Total Usage Count", totalUsage],
        ],
      },
      {
        name: "All Offers",
        headers: ["Offer Name", "Type", "Status", "Usage Count", "Total Savings (PHP)", "Start Date", "End Date"],
        rows: offers.map((o) => [
          o.name, o.offerType, o.isActive ? "Active" : "Inactive",
          o.usageCount, o.totalSavingsGenerated || 0,
          format(new Date(o.startDate), "yyyy-MM-dd"),
          format(new Date(o.endDate), "yyyy-MM-dd"),
        ]),
      },
    ], `offers-report-${format(new Date(), "yyyyMMdd")}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={exportPDF}><FileText className="h-4 w-4 mr-2" />PDF</Button>
        <Button size="sm" variant="outline" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4 mr-2" />Excel</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Offers", value: offers.length, color: "text-blue-600" },
          { label: "Active Offers", value: activeOffers.length, color: "text-green-600" },
          { label: "Total Savings", value: formatPHP(totalSavings), color: "text-purple-600" },
          { label: "Total Usage", value: totalUsage, color: "text-teal-600" },
        ].map((s) => (
          <Card key={s.label}><CardContent className="p-4"><p className="text-xs text-muted-foreground mb-1">{s.label}</p><p className={`text-xl font-bold truncate ${s.color}`}>{s.value}</p></CardContent></Card>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {byType.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Offers by Type</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={byType} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {byType.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
        {offers.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Top Offers by Usage</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={[...offers].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0)).slice(0, 8)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} />
                  <Tooltip />
                  <Bar dataKey="usageCount" fill="hsl(270,75%,60%)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
      {offers.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">All Offers</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Usage</TableHead>
                  <TableHead className="text-right">Savings</TableHead>
                  <TableHead>Date Range</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offers.map((o, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{o.name}</TableCell>
                    <TableCell className="text-xs">{o.offerType.replace(/_/g, " ")}</TableCell>
                    <TableCell><Badge variant={o.isActive ? "default" : "secondary"} className="text-xs">{o.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="text-right">{o.usageCount || 0}</TableCell>
                    <TableCell className="text-right text-green-600 font-medium">{formatPHP(o.totalSavingsGenerated || 0)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{format(new Date(o.startDate), "MMM d")} → {format(new Date(o.endDate), "MMM d yy")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── REPORT 5: RESERVATIONS ──────────────────────────────────────────────────

function ReservationsReport({ reservations, startD, endD }: { reservations: any[]; startD: Date; endD: Date }) {
  const filtered = reservations.filter((r) => {
    if (!r.scheduledDate) return false;
    const d = new Date(r.scheduledDate);
    return d >= startD && d <= endD;
  });

  const now = new Date();
  const upcoming = reservations.filter((r) => r.scheduledDate && new Date(r.scheduledDate) > now && r.fulfillmentStatus !== "completed" && r.fulfillmentStatus !== "cancelled");
  const completed = reservations.filter((r) => r.fulfillmentStatus === "completed");
  const totalRevenue = completed.reduce((s, r) => s + (r.totalAmount || 0), 0);

  const byType = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((r) => { map[r.orderType] = (map[r.orderType] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));
  }, [filtered]);

  const byPayment = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((r) => { const s = r.paymentStatus || "unknown"; map[s] = (map[s] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));
  }, [filtered]);

  const byStatus = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((r) => { map[r.fulfillmentStatus] = (map[r.fulfillmentStatus] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  function exportPDF() {
    const doc = new jsPDF();
    let y = pdfHeader(doc, "Reservations Report", `${format(startD, "MMM d yyyy")} – ${format(endD, "MMM d yyyy")}`);
    autoTable(doc, {
      startY: y,
      head: [["Tracking #", "Customer", "Type", "Scheduled", "Total", "Payment", "Status"]],
      body: filtered.map((r) => [
        r.trackingNumber, r.customerName,
        r.orderType.replace(/_/g, " "),
        r.scheduledDate ? format(new Date(r.scheduledDate), "MMM d yyyy") : "—",
        pdfCurrency(r.totalAmount || 0), r.paymentStatus.replace(/_/g, " "), r.fulfillmentStatus,
      ]),
      headStyles: { fillColor: [30, 58, 95] },
      styles: { fontSize: 7 },
    });
    pdfFooter(doc);
    doc.save(`reservations-report-${format(startD, "yyyyMMdd")}.pdf`);
  }

  function exportExcel() {
    exportToExcel([
      {
        name: "Summary",
        headers: ["Metric", "Value"],
        rows: [
          ["Total (in range)", filtered.length], ["Upcoming", upcoming.length],
          ["Completed", completed.length], ["Completed Revenue (PHP)", totalRevenue],
        ],
      },
      {
        name: "Reservations",
        headers: ["Tracking #", "Customer", "Type", "Scheduled Date", "Total (PHP)", "Payment", "Status"],
        rows: filtered.map((r) => [
          r.trackingNumber, r.customerName, r.orderType,
          r.scheduledDate ? format(new Date(r.scheduledDate), "yyyy-MM-dd") : "",
          r.totalAmount || 0, r.paymentStatus, r.fulfillmentStatus,
        ]),
      },
    ], `reservations-report-${format(startD, "yyyyMMdd")}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={exportPDF}><FileText className="h-4 w-4 mr-2" />PDF</Button>
        <Button size="sm" variant="outline" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4 mr-2" />Excel</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "In Range", value: filtered.length, color: "text-blue-600" },
          { label: "Upcoming", value: upcoming.length, color: "text-purple-600" },
          { label: "Completed", value: completed.length, color: "text-green-600" },
          { label: "Completed Revenue", value: formatPHP(totalRevenue), color: "text-teal-600" },
        ].map((s) => (
          <Card key={s.label}><CardContent className="p-4"><p className="text-xs text-muted-foreground mb-1">{s.label}</p><p className={`text-xl font-bold truncate ${s.color}`}>{s.value}</p></CardContent></Card>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {byType.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">By Type</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={byType} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value">
                    {byType.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip /><Legend iconSize={8} wrapperStyle={{ fontSize: "10px" }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
        {byPayment.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">By Payment</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={byPayment} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value">
                    {byPayment.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip /><Legend iconSize={8} wrapperStyle={{ fontSize: "10px" }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
        {byStatus.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">By Status</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={byStatus}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(217,91%,60%)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <CalendarCheck className="h-12 w-12 mx-auto mb-3 opacity-20" />
          <p>No reservations in the selected date range</p>
        </div>
      )}
      {filtered.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Reservations List</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tracking #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(0, 50).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{r.trackingNumber}</TableCell>
                      <TableCell className="font-medium">{r.customerName}</TableCell>
                      <TableCell className="text-xs">{r.orderType.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-xs">{r.scheduledDate ? format(new Date(r.scheduledDate), "EEE MMM d, yyyy") : "—"}</TableCell>
                      <TableCell className="text-right font-medium">{formatPHP(r.totalAmount || 0)}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{r.paymentStatus?.replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{r.fulfillmentStatus}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {filtered.length > 50 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-3">Showing first 50 of {filtered.length} — export for full data</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

type ReportType = "sales" | "inventory" | "orders" | "offers" | "reservations";

const REPORT_TYPES: { id: ReportType; label: string; icon: any; description: string; color: string }[] = [
  { id: "sales", label: "Sales", icon: TrendingUp, description: "Revenue, top items, payment breakdown", color: "bg-blue-50 text-blue-700 border-blue-200" },
  { id: "inventory", label: "Inventory", icon: Package, description: "Stock levels, value by category, critical items", color: "bg-green-50 text-green-700 border-green-200" },
  { id: "orders", label: "Orders", icon: ShoppingBag, description: "Order types, fulfillment, top customers", color: "bg-purple-50 text-purple-700 border-purple-200" },
  { id: "offers", label: "Offers", icon: Tag, description: "Offer usage, savings generated, type breakdown", color: "bg-orange-50 text-orange-700 border-orange-200" },
  { id: "reservations", label: "Reservations", icon: CalendarCheck, description: "Scheduled, completed, payment status", color: "bg-teal-50 text-teal-700 border-teal-200" },
];

export default function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>("sales");
  const [preset, setPreset] = useState<DatePreset>("30d");
  const [customStart, setCustomStart] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(format(new Date(), "yyyy-MM-dd"));

  const [startD, endD] = useMemo(() => {
    if (preset === "custom") {
      return [customStart ? new Date(customStart) : subDays(new Date(), 30), customEnd ? new Date(customEnd + "T23:59:59") : new Date()];
    }
    return getPresetRange(preset);
  }, [preset, customStart, customEnd]);

  const { data: ordersData, isLoading: ordersLoading } = useQuery<{ success: boolean; data: { orders: IOrder[] } }>({
    queryKey: ["/api/orders", "reports"],
    queryFn: () => apiRequest("GET", "/api/orders?pageSize=500").then((r) => r.json()),
  });

  const { data: itemsData, isLoading: itemsLoading } = useQuery<{ success: boolean; data: { items: IItem[] } }>({
    queryKey: ["/api/items"],
  });

  const { data: offersData, isLoading: offersLoading } = useQuery<{ success: boolean; data: { offers: any[] } }>({
    queryKey: ["/api/offers", "reports"],
    queryFn: () => apiRequest("GET", "/api/offers?page=1&pageSize=500").then((r) => r.json()),
  });

  const { data: reservationsData, isLoading: reservationsLoading } = useQuery<{ success: boolean; data: any[] }>({
    queryKey: ["/api/reservations"],
    queryFn: () => apiRequest("GET", "/api/reservations").then((r) => r.json()),
  });

  const orders = ordersData?.data?.orders || [];
  const items = itemsData?.data?.items || [];
  const offers = offersData?.data?.offers || [];
  const reservations = reservationsData?.data || [];

  const isLoading = ordersLoading || itemsLoading || offersLoading || reservationsLoading;
  const activeReport = REPORT_TYPES.find((r) => r.id === reportType);
  const needsDateRange = reportType === "sales" || reportType === "orders" || reportType === "reservations";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />Reports & Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Export and analyze store data</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {REPORT_TYPES.map((rt) => {
            const Icon = rt.icon;
            return (
              <button
                key={rt.id}
                onClick={() => setReportType(rt.id)}
                className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                  reportType === rt.id
                    ? `${rt.color} ring-2 ring-offset-1 ring-current/30 shadow-sm`
                    : "bg-background border-border hover:bg-muted/50"
                }`}
                data-testid={`button-report-${rt.id}`}
              >
                <Icon className="h-5 w-5 mb-2 shrink-0" />
                <p className="text-sm font-semibold">{rt.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{rt.description}</p>
              </button>
            );
          })}
        </div>

        {needsDateRange && (
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-muted-foreground">Date Range:</span>
                <DateRangePicker
                  preset={preset} onPreset={setPreset}
                  startDate={customStart} endDate={customEnd}
                  onStartDate={setCustomStart} onEndDate={setCustomEnd}
                />
                <span className="text-xs text-muted-foreground ml-auto hidden sm:block">
                  {format(startD, "MMM d, yyyy")} — {format(endD, "MMM d, yyyy")}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        <div>
          {isLoading ? (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
              <Skeleton className="h-48 w-full" />
            </div>
          ) : (
            <>
              {reportType === "sales" && <SalesReport orders={orders} startD={startD} endD={endD} />}
              {reportType === "inventory" && <InventoryReport items={items} />}
              {reportType === "orders" && <OrdersReport orders={orders} startD={startD} endD={endD} />}
              {reportType === "offers" && <OffersReport offers={offers} />}
              {reportType === "reservations" && <ReservationsReport reservations={reservations} startD={startD} endD={endD} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
