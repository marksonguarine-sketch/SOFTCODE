import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Clock, Search, ChevronRight, CreditCard } from "lucide-react";
import type { IOrder } from "@shared/schema";
import { PAYMENT_STATUS_LABELS, ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v);
}
function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
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

  const allOrders = data?.data?.orders || [];
  const filtered = allOrders.filter((o) =>
    !search ||
    o.trackingNumber.toLowerCase().includes(search.toLowerCase()) ||
    o.customerName.toLowerCase().includes(search.toLowerCase())
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

      {/* Table */}
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
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-0">
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
                filtered.map((order) => (
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
