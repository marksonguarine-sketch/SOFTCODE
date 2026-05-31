/**
 * Pending Release page (REQUEST.pdf §18b)
 *
 * Lists orders that are either fully paid or partial≥50% but whose items
 * haven't been physically released yet. Clicking a row routes to the
 * order detail page with `?release=1` which auto-scrolls to the Release
 * Item panel.
 *
 * Filter rules (server-side):
 *   paymentStatus ∈ {paid, partial}
 *   AND fulfillmentStatus NOT IN {completed, cancelled}
 *   AND ( paymentStatus === "paid" OR amountPaid ≥ 50% of total )
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Truck, Search, ChevronRight, ChevronLeft, Loader2, PackageCheck } from "lucide-react";
import type { IOrder } from "@shared/schema";
import { ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface PendingReleaseRow extends IOrder {
  totalPaid: number;
  balance: number;
  releaseEligible: boolean;
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v);
}
function formatDate(d: string) {
  return new Date(d).toLocaleString("en-PH", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Manila",
  });
}

export default function PendingReleasePage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 5;

  const { data, isLoading } = useQuery<{ success: boolean; data: { orders: PendingReleaseRow[]; total: number } }>({
    queryKey: ["/api/orders/pending-release", page, search],
    queryFn: async () => {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        ...(search ? { search } : {}),
      });
      const res = await apiRequest("GET", `/api/orders/pending-release?${qs.toString()}`);
      return res.json();
    },
    refetchInterval: 15_000,
  });

  const orders = data?.data?.orders || [];
  const total = data?.data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-3 sm:p-6 space-y-4 pb-10" data-testid="page-pending-release">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Truck className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-pending-release-title">Pending Release</h1>
            <p className="text-sm text-muted-foreground">
              {orders.length} order{orders.length === 1 ? "" : "s"} ready to release — paid in full or ≥ 50% partial
            </p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by tracking # or customer..."
          className="pl-9 h-9"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          data-testid="input-search-pending-release"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : orders.length === 0 ? (
            <EmptyState
              icon={PackageCheck}
              title="Nothing to release"
              description="No paid or partial-paid orders are waiting for hand-off right now."
              tone="success"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tracking #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const isFull = order.paymentStatus === "paid";
                  const pct = order.totalAmount > 0 ? Math.round((order.totalPaid / order.totalAmount) * 100) : 0;
                  return (
                    <TableRow
                      key={order._id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => navigate(`/orders/${order._id}?release=1`)}
                      data-testid={`row-pending-release-${order._id}`}
                    >
                      <TableCell className="font-mono text-sm font-semibold">{order.trackingNumber}</TableCell>
                      <TableCell className="font-medium">{order.customerName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {ORDER_TYPE_LABELS[order.orderType] || order.orderType}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {PAYMENT_METHOD_LABELS[order.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] || order.paymentMethod}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatCurrency(order.totalAmount)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-emerald-700">
                        {formatCurrency(order.totalPaid)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-amber-700">
                        {formatCurrency(order.balance)}
                      </TableCell>
                      <TableCell>
                        <Badge className={isFull ? "bg-emerald-600 text-white border-transparent" : "bg-blue-500 text-white border-transparent"}>
                          {isFull ? "Full" : `Partial ${pct}%`}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={(e) => { e.stopPropagation(); navigate(`/orders/${order._id}?release=1`); }}
                          data-testid={`button-release-${order._id}`}
                        >
                          <Truck className="h-3 w-3 mr-1" />
                          Release Item
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {/* Pagination (5 rows per page per global rule §20.5) */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-2">
              <span className="text-xs text-muted-foreground tabular-nums">Page {page} of {totalPages}</span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  data-testid="button-page-prev"
                >
                  <ChevronLeft className="h-3 w-3 mr-1" />Prev
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  data-testid="button-page-next"
                >
                  Next<ChevronRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
