import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Download,
  Calendar,
  Tag,
  ShoppingBag,
} from "lucide-react";
import {
  LineChart,
  Line,
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import type { IOrder, IItem } from "@shared/schema";

const PIE_COLORS = ["hsl(217,91%,60%)", "hsl(142,72%,45%)", "hsl(25,95%,53%)", "hsl(270,75%,60%)", "hsl(330,80%,55%)", "hsl(190,90%,45%)"];

function downloadCSV(data: any[], filename: string) {
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(","),
    ...data.map((row) =>
      headers.map((h) => {
        const val = row[h];
        return typeof val === "string" && val.includes(",") ? `"${val}"` : val;
      }).join(",")
    ),
  ].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const { data: ordersData, isLoading: ordersLoading } = useQuery<{ success: boolean; data: { orders: IOrder[]; total: number; page: number; pageSize: number } }>({
    queryKey: ["/api/orders"],
  });

  const { data: itemsData, isLoading: itemsLoading } = useQuery<{ success: boolean; data: { items: IItem[]; total: number; page: number; pageSize: number } }>({
    queryKey: ["/api/items"],
  });

  const { data: revenueData } = useQuery<{ success: boolean; data: Array<{ date: string; revenue: number }> }>({
    queryKey: ["/api/dashboard/revenue-chart"],
  });

  const { data: offersData } = useQuery<{ success: boolean; data: { offers: Array<{ _id: string; name: string; offerType: string; isActive: boolean; usageCount?: number; totalSavings?: number; items: any[] }> } }>({
    queryKey: ["/api/offers", "all-reports"],
    queryFn: () => fetch("/api/offers?page=1&pageSize=100").then((r) => r.json()),
  });

  const orders = ordersData?.data?.orders || [];
  const items = itemsData?.data?.items || [];
  const revenueChart = revenueData?.data || [];
  const allOffers = offersData?.data?.offers || [];

  const formatCurrency = (v: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v);

  const filteredOrders = orders.filter((o) => {
    if (startDate && new Date(o.createdAt) < new Date(startDate)) return false;
    if (endDate && new Date(o.createdAt) > new Date(endDate + "T23:59:59")) return false;
    return true;
  });

  const salesSummary = filteredOrders.reduce(
    (acc, o) => ({
      totalOrders: acc.totalOrders + 1,
      totalRevenue: acc.totalRevenue + o.totalAmount,
      avgOrderValue: 0,
    }),
    { totalOrders: 0, totalRevenue: 0, avgOrderValue: 0 }
  );
  salesSummary.avgOrderValue = salesSummary.totalOrders > 0 ? salesSummary.totalRevenue / salesSummary.totalOrders : 0;

  const lowStockItems = items.filter((i) => i.currentQuantity <= i.reorderLevel);

  const orderTypeBreakdown = Object.entries(
    orders.reduce((acc, o) => {
      const type = (o as any).orderType || o.sourceChannel || "unknown";
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));

  const paymentStatusBreakdown = Object.entries(
    orders.reduce((acc, o) => {
      const status = (o as any).paymentStatus || "unknown";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));

  const fulfillmentBreakdown = Object.entries(
    orders.reduce((acc, o) => {
      const status = (o as any).fulfillmentStatus || o.currentStatus || "unknown";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));

  const offerTableData = allOffers.map((offer) => {
    const ordersWithOffer = orders.filter((o) =>
      o.items.some((item) => (item as any).offerName === offer.name || (item as any).discountApplied)
    );
    const totalSavingsCalc = ordersWithOffer.reduce((acc, o) => {
      return acc + o.items.reduce((s, item: any) => {
        if (item.discountApplied && item.originalUnitPrice && item.discountedUnitPrice) {
          return s + (item.originalUnitPrice - item.discountedUnitPrice) * (item.qty || item.quantity || 0);
        }
        return s;
      }, 0);
    }, 0);
    return {
      ...offer,
      ordersUsed: offer.usageCount ?? ordersWithOffer.length,
      estimatedSavings: offer.totalSavings ?? totalSavingsCalc,
    };
  });

  if (ordersLoading || itemsLoading) {
    return (
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 overflow-auto h-full">
        <h1 className="text-xl sm:text-2xl font-bold">Reports</h1>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 overflow-auto h-full">
      <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-reports-title">Reports</h1>

      <div className="flex items-center gap-3 flex-wrap">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <Input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-[180px]"
          data-testid="input-start-date"
        />
        <span className="text-sm text-muted-foreground">to</span>
        <Input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="w-[180px]"
          data-testid="input-end-date"
        />
        {(startDate || endDate) && (
          <Button variant="ghost" size="sm" onClick={() => { setStartDate(""); setEndDate(""); }} data-testid="button-clear-dates">
            Clear
          </Button>
        )}
      </div>

      <Tabs defaultValue="sales">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="sales" data-testid="tab-sales"><BarChart3 className="h-3.5 w-3.5 mr-1" />Sales</TabsTrigger>
          <TabsTrigger value="inventory" data-testid="tab-inventory">Inventory</TabsTrigger>
          <TabsTrigger value="forecast" data-testid="tab-forecast">Forecast</TabsTrigger>
          <TabsTrigger value="order-types" data-testid="tab-order-types"><ShoppingBag className="h-3.5 w-3.5 mr-1" />Order Types</TabsTrigger>
          <TabsTrigger value="offers" data-testid="tab-offers"><Tag className="h-3.5 w-3.5 mr-1" />Offers</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="space-y-6">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent><div className="text-2xl font-bold" data-testid="stat-report-orders">{salesSummary.totalOrders}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              </CardHeader>
              <CardContent><div className="text-2xl font-bold" data-testid="stat-report-revenue">{formatCurrency(salesSummary.totalRevenue)}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Order Value</CardTitle>
              </CardHeader>
              <CardContent><div className="text-2xl font-bold" data-testid="stat-report-avg">{formatCurrency(salesSummary.avgOrderValue)}</div></CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base">Revenue Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {revenueChart.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={revenueChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip />
                    <Line type="monotone" dataKey="revenue" stroke="hsl(217, 91%, 60%)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">No data available</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base">Sales Data</CardTitle>
              <Button variant="outline" size="sm" onClick={() => downloadCSV(
                filteredOrders.map((o) => ({ trackingNumber: o.trackingNumber, customer: o.customerName, total: o.totalAmount, status: o.currentStatus, date: o.createdAt })),
                "sales-report.csv"
              )} data-testid="button-download-sales">
                <Download className="mr-1 h-3 w-3" /> CSV
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tracking #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No data</TableCell></TableRow>
                  ) : (
                    filteredOrders.slice(0, 50).map((o) => (
                      <TableRow key={o._id}>
                        <TableCell className="font-mono text-sm">{o.trackingNumber}</TableCell>
                        <TableCell>{o.customerName}</TableCell>
                        <TableCell className="text-right">{formatCurrency(o.totalAmount)}</TableCell>
                        <TableCell>{o.currentStatus}</TableCell>
                        <TableCell className="text-muted-foreground">{new Date(o.createdAt).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-base">Low Stock / Critical Items</CardTitle>
                <CardDescription>{lowStockItems.length} items need attention</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => downloadCSV(
                lowStockItems.map((i) => ({ name: i.itemName, category: i.category, quantity: i.currentQuantity, reorderLevel: i.reorderLevel, price: i.unitPrice })),
                "inventory-report.csv"
              )} data-testid="button-download-inventory">
                <Download className="mr-1 h-3 w-3" /> CSV
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Reorder Level</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowStockItems.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">All items stocked</TableCell></TableRow>
                  ) : (
                    lowStockItems.map((item) => (
                      <TableRow key={item._id}>
                        <TableCell className="font-medium">{item.itemName}</TableCell>
                        <TableCell>{item.category}</TableCell>
                        <TableCell className="text-right">{item.currentQuantity}</TableCell>
                        <TableCell className="text-right">{item.reorderLevel}</TableCell>
                        <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forecast" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sales Forecast</CardTitle>
              <CardDescription>Based on historical order data</CardDescription>
            </CardHeader>
            <CardContent>
              {revenueChart.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={revenueChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="revenue" fill="hsl(217, 91%, 60%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
                  Insufficient data for forecast
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="order-types" className="space-y-6">
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-base">Order Type Breakdown</CardTitle>
                <CardDescription>Distribution by order channel</CardDescription>
              </CardHeader>
              <CardContent>
                {orderTypeBreakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={orderTypeBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                        {orderTypeBreakdown.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[260px] text-muted-foreground text-sm">No data</div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-base">Payment Status</CardTitle>
                <CardDescription>Distribution by payment state</CardDescription>
              </CardHeader>
              <CardContent>
                {paymentStatusBreakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={paymentStatusBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                        {paymentStatusBreakdown.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v, name) => [v, name]} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[260px] text-muted-foreground text-sm">No data</div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-base">Fulfillment Status</CardTitle>
                <CardDescription>Distribution by fulfillment state</CardDescription>
              </CardHeader>
              <CardContent>
                {fulfillmentBreakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={fulfillmentBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                        {fulfillmentBreakdown.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v, name) => [v, name]} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[260px] text-muted-foreground text-sm">No data</div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Orders by Type</CardTitle>
            </CardHeader>
            <CardContent>
              {orderTypeBreakdown.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={orderTypeBreakdown} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" fontSize={12} />
                    <YAxis type="category" dataKey="name" fontSize={12} width={120} />
                    <Tooltip />
                    <Bar dataKey="value" fill="hsl(217,91%,60%)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[240px] text-muted-foreground text-sm">No data</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="offers" className="space-y-6">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Offers</CardTitle>
                <Tag className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent><div className="text-2xl font-bold" data-testid="stat-offers-total">{allOffers.length}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Offers</CardTitle>
                <Tag className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent><div className="text-2xl font-bold text-green-600" data-testid="stat-offers-active">{allOffers.filter((o) => o.isActive).length}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Items on Sale</CardTitle>
                <ShoppingBag className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent><div className="text-2xl font-bold" data-testid="stat-offers-items">{new Set(allOffers.filter((o) => o.isActive).flatMap((o) => o.items.map((it: any) => it.itemId))).size}</div></CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-base">Offers Performance</CardTitle>
                <CardDescription>Breakdown of all offers and their usage</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => downloadCSV(
                offerTableData.map((o) => ({ name: o.name, type: o.offerType, active: o.isActive, ordersUsed: o.ordersUsed, estimatedSavings: o.estimatedSavings, items: o.items.length })),
                "offers-report.csv"
              )} data-testid="button-download-offers">
                <Download className="mr-1 h-3 w-3" /> CSV
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Offer Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Orders Used</TableHead>
                    <TableHead className="text-right">Est. Savings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {offerTableData.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No offers found</TableCell></TableRow>
                  ) : (
                    offerTableData.map((offer) => (
                      <TableRow key={offer._id} data-testid={`row-offer-${offer._id}`}>
                        <TableCell className="font-medium">{offer.name}</TableCell>
                        <TableCell className="capitalize">{offer.offerType.replace(/_/g, " ")}</TableCell>
                        <TableCell>
                          <Badge variant={offer.isActive ? "default" : "secondary"}>
                            {offer.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{offer.items.length}</TableCell>
                        <TableCell className="text-right">{offer.ordersUsed}</TableCell>
                        <TableCell className="text-right">{formatCurrency(offer.estimatedSavings)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
