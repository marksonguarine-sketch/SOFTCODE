import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Clock, Search, ChevronRight, CreditCard, CheckCircle2, Download } from "lucide-react";
import type { IOrder } from "@shared/schema";
import { ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v);
}
function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}
function formatDateTime(d: string) {
  return new Date(d).toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
}
// When did this order become paid? Prefer the "Paid" status-history entry; fall
// back to the last update timestamp.
function paidAt(order: IOrder): string {
  const entry = [...(order.statusHistory || [])].reverse().find((s) => s.status === "Paid");
  return entry?.timestamp || order.updatedAt || order.createdAt;
}
function exportPaymentHistoryCsv(orders: IOrder[]) {
  const header = ["Tracking #", "Customer", "Order Type", "Payment Method", "Amount", "Paid At"];
  const rows = orders.map((o) => [
    o.trackingNumber,
    o.customerName,
    ORDER_TYPE_LABELS[o.orderType] || o.orderType,
    PAYMENT_METHOD_LABELS[o.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] || o.paymentMethod,
    String(o.totalAmount),
    formatDateTime(paidAt(o)),
  ]);
  const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payment-history-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PendingPaymentPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<{ success: boolean; data: { orders: IOrder[] } }>({
    queryKey: ["/api/orders?paymentStatus=pending_payment"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/orders?paymentStatus=pending_payment&pageSize=200");
      return res.json();
    },
  });

  // Paid orders feed the "History of Payment" section below.
  const { data: paidData } = useQuery<{ success: boolean; data: { orders: IOrder[] } }>({
    queryKey: ["/api/orders?paymentStatus=paid"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/orders?paymentStatus=paid&pageSize=200");
      return res.json();
    },
  });

  const allOrders = data?.data?.orders || [];
  const match = (o: IOrder) =>
    !search ||
    o.trackingNumber.toLowerCase().includes(search.toLowerCase()) ||
    o.customerName.toLowerCase().includes(search.toLowerCase());
  const filtered = allOrders.filter(match);

  const paidOrders = paidData?.data?.orders || [];
  const paidSorted = useMemo(
    () => [...paidOrders].filter(match).sort((a, b) => new Date(paidAt(b)).getTime() - new Date(paidAt(a)).getTime()),
    [paidOrders, search],
  );

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 space-y-4 pb-10">
        <h1 className="text-xl sm:text-2xl font-bold">Pending Payment</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
          <Clock className="h-5 w-5 text-yellow-600" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-pending-payment-title">Pending Payment</h1>
          <p className="text-sm text-muted-foreground">{allOrders.length} order{allOrders.length !== 1 ? "s" : ""} awaiting payment</p>
        </div>
      </div>

      {/* Notification bar */}
      {allOrders.length > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800">
          <CreditCard className="h-4 w-4 text-yellow-600 flex-shrink-0" />
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            <strong>{allOrders.length} order{allOrders.length !== 1 ? "s" : ""}</strong> awaiting payment. Reach out to customers to complete payment.
          </p>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by tracking # or customer..."
          className="pl-9 h-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-search-pending"
        />
      </div>

      {/* Table — REQUEST.pdf §18a: STATUS column + Action [Release Item] */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tracking #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Payment Method</TableHead>
                <TableHead className="text-right">Amount Due</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="p-0">
                    {allOrders.length === 0 ? (
                      <EmptyState
                        icon={CreditCard}
                        title="All caught up!"
                        description="No orders are waiting for payment. New unpaid orders will land here automatically."
                        tone="success"
                      />
                    ) : (
                      <div className="py-10 text-center text-sm text-muted-foreground">
                        No orders match your search
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((order) => {
                  // STATUS column logic (§18a):
                  //   "Pending Release" — paid (full or ≥50%) but items not handed over yet
                  //   "Item Released / Completed" — already handed over
                  //   "Awaiting Payment" — still under 50% paid
                  const released = order.fulfillmentStatus === "completed";
                  const eligible = order.paymentStatus === "paid" || order.paymentStatus === "partial";
                  const status = released
                    ? { label: "Item Released / Completed", cls: "bg-emerald-500 text-white border-transparent" }
                    : eligible
                      ? { label: "Pending Release", cls: "bg-amber-500 text-white border-transparent" }
                      : { label: "Awaiting Payment", cls: "bg-slate-400 text-white border-transparent" };
                  return (
                    <TableRow
                      key={order._id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => navigate(`/orders/${order._id}`)}
                      data-testid={`row-pending-${order._id}`}
                    >
                      <TableCell className="font-mono text-sm font-semibold">{order.trackingNumber}</TableCell>
                      <TableCell className="font-medium">{order.customerName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{ORDER_TYPE_LABELS[order.orderType] || order.orderType}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {PAYMENT_METHOD_LABELS[order.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] || order.paymentMethod}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(order.totalAmount)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{formatDate(order.createdAt)}</TableCell>
                      <TableCell>
                        <Badge className={cn("text-[10.5px]", status.cls)}>{status.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {eligible && !released ? (
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 text-[11px]"
                            onClick={(e) => { e.stopPropagation(); navigate(`/orders/${order._id}?release=1`); }}
                            data-testid={`button-release-${order._id}`}
                          >
                            Release Item
                          </Button>
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground inline-block" />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── HISTORY OF PAYMENT ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 pt-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold" data-testid="text-payment-history-title">History of Payment</h2>
            <p className="text-sm text-muted-foreground">{paidSorted.length} completed payment{paidSorted.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        {paidSorted.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => exportPaymentHistoryCsv(paidSorted)} data-testid="button-export-payment-history">
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export CSV
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tracking #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Payment Method</TableHead>
                <TableHead className="text-right">Amount Paid</TableHead>
                <TableHead>Paid At</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paidSorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-0">
                    <EmptyState
                      icon={CheckCircle2}
                      title="No payments yet"
                      description="Orders that get fully paid will appear here with a timestamp."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                paidSorted.map((order) => (
                  <TableRow
                    key={order._id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => navigate(`/orders/${order._id}`)}
                    data-testid={`row-paid-${order._id}`}
                  >
                    <TableCell className="font-mono text-sm font-semibold">{order.trackingNumber}</TableCell>
                    <TableCell className="font-medium">{order.customerName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{ORDER_TYPE_LABELS[order.orderType] || order.orderType}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {PAYMENT_METHOD_LABELS[order.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] || order.paymentMethod}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-green-600 dark:text-green-400">{formatCurrency(order.totalAmount)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">{formatDateTime(paidAt(order))}</TableCell>
                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
