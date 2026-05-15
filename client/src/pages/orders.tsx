import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation } from "wouter";
import {
  Plus,
  Search,
  Loader2,
  ShoppingCart,
  Trash2,
  MapPin,
  UserCheck,
  Package,
  AlertCircle,
  ChevronRight,
  Sun,
  Moon,
  Sunset,
} from "lucide-react";
import { createOrderSchema, type CreateOrderInput, type IOrder, type IItem } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    "Pending Payment": "bg-yellow-500 text-white border-transparent",
    "Paid": "bg-blue-500 text-white border-transparent",
    "Pending Release": "bg-orange-500 text-white border-transparent",
    "Released": "bg-indigo-500 text-white border-transparent",
    "In Transit": "bg-purple-500 text-white border-transparent",
    "Completed": "bg-green-600 text-white border-transparent",
  };
  return <Badge className={colorMap[status] || ""}>{status}</Badge>;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return { text: "Good morning", Icon: Sun };
  if (hour < 18) return { text: "Good afternoon", Icon: Sunset };
  return { text: "Good evening", Icon: Moon };
}

function fmt12(d: string | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "2-digit", day: "2-digit", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

interface SimpleUser { username: string; role: string; }

function OrderRow({ order, onClick, assignable, allUsers, onAssign }: {
  order: IOrder;
  onClick: () => void;
  assignable?: boolean;
  allUsers?: SimpleUser[];
  onAssign?: (orderId: string, username: string, displayName: string) => void;
}) {
  const [assignVal, setAssignVal] = useState(order.assignedTo || "");

  return (
    <TableRow className="cursor-pointer group" data-testid={`row-order-${order._id}`}>
      <TableCell className="font-medium font-mono text-sm" onClick={onClick}>{order.trackingNumber}</TableCell>
      <TableCell onClick={onClick}>{order.customerName}</TableCell>
      <TableCell className="text-right" onClick={onClick}>{formatCurrency(order.totalAmount)}</TableCell>
      <TableCell onClick={onClick}><StatusBadge status={order.currentStatus} /></TableCell>
      <TableCell className="text-muted-foreground" onClick={onClick}>{formatDate(order.createdAt)}</TableCell>
      {assignable && allUsers && onAssign && (
        <TableCell onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5">
            <Select
              value={assignVal}
              onValueChange={(v) => {
                setAssignVal(v);
                const found = allUsers.find((u) => u.username === v);
                onAssign(order._id, v === "__unassign__" ? "" : v, found?.username || "");
              }}
            >
              <SelectTrigger className="h-7 text-xs w-[130px]">
                <SelectValue placeholder="Assign to..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__unassign__">— Unassign —</SelectItem>
                {allUsers.map((u) => (
                  <SelectItem key={u.username} value={u.username}>
                    {u.username} <span className="text-muted-foreground">({u.role === "ADMIN" ? "Admin" : "Staff"})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

export default function OrdersPage() {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [orderItems, setOrderItems] = useState<{ itemId: string; itemName: string; quantity: number; unitPrice: number }[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [itemQty, setItemQty] = useState(1);
  const [showAddress, setShowAddress] = useState(false);
  const [viewUser, setViewUser] = useState("");

  const { data: ordersData, isLoading } = useQuery<{ success: boolean; data: { orders: IOrder[]; total: number } }>({
    queryKey: ["/api/orders"],
  });

  const { data: assignedData } = useQuery<{ success: boolean; data: { orders: IOrder[] } }>({
    queryKey: ["/api/orders?assignedToMe=true"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/orders?assignedToMe=true&pageSize=100");
      return res.json();
    },
    enabled: !isAdmin,
  });

  const { data: viewUserOrdersData } = useQuery<{ success: boolean; data: { orders: IOrder[] } }>({
    queryKey: [`/api/orders?assignedTo=${viewUser}`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/orders?assignedTo=${encodeURIComponent(viewUser)}&pageSize=100`);
      return res.json();
    },
    enabled: isAdmin && !!viewUser,
  });

  const { data: allItemsData } = useQuery<{ success: boolean; data: IItem[] }>({
    queryKey: ["/api/items/all"],
  });

  const { data: usersData } = useQuery<{ success: boolean; data: SimpleUser[] }>({
    queryKey: ["/api/users/simple"],
    enabled: isAdmin,
  });

  const assignMutation = useMutation({
    mutationFn: async ({ orderId, username, displayName }: { orderId: string; username: string; displayName: string }) => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/assign`, { username, displayName });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order assigned" });
    },
    onError: (err: Error) => toast({ title: "Assignment failed", description: err.message, variant: "destructive" }),
  });

  const orders = ordersData?.data?.orders || [];
  const allItems = allItemsData?.data || [];
  const allUsers = usersData?.data || [];
  const myAssignedOrders = assignedData?.data?.orders || [];
  const viewUserOrders = viewUserOrdersData?.data?.orders || [];

  const myPendingAssigned = myAssignedOrders.filter((o) => o.currentStatus !== "Completed");
  const hasPendingAssigned = myPendingAssigned.length > 0;

  const employees = allUsers.filter((u) => u.role === "EMPLOYEE");
  const admins = allUsers.filter((u) => u.role === "ADMIN");

  const viewUserAssigned = viewUserOrders.filter((o) => o.currentStatus !== "Completed");
  const viewUserCompleted = viewUserOrders.filter((o) => o.currentStatus === "Completed");

  const form = useForm<CreateOrderInput>({
    resolver: zodResolver(createOrderSchema),
    defaultValues: { customerId: "", customerName: "", items: [], sourceChannel: "walk-in", notes: "" },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreateOrderInput) => {
      const res = await apiRequest("POST", "/api/orders", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setCreateOpen(false);
      form.reset();
      setOrderItems([]);
      toast({ title: "Order created successfully" });
    },
    onError: (err: Error) => toast({ title: "Failed to create order", description: err.message, variant: "destructive" }),
  });

  const addItemToOrder = () => {
    const item = allItems.find((i) => i._id === selectedItemId);
    if (!item || itemQty < 1) return;
    if (itemQty > item.currentQuantity) {
      toast({ title: "Insufficient stock", description: `Only ${item.currentQuantity} available for ${item.itemName}`, variant: "destructive" });
      return;
    }
    const exists = orderItems.find((oi) => oi.itemId === item._id);
    if (exists) {
      setOrderItems((prev) => prev.map((oi) => oi.itemId === item._id ? { ...oi, quantity: oi.quantity + itemQty } : oi));
    } else {
      setOrderItems((prev) => [...prev, { itemId: item._id, itemName: item.itemName, quantity: itemQty, unitPrice: item.unitPrice }]);
    }
    setSelectedItemId("");
    setItemQty(1);
  };

  const removeOrderItem = (itemId: string) => {
    setOrderItems((prev) => prev.filter((oi) => oi.itemId !== itemId));
  };

  const handleCreateSubmit = (data: CreateOrderInput) => {
    if (orderItems.length === 0) {
      toast({ title: "No items added", description: "Please add at least one item to the order", variant: "destructive" });
      return;
    }
    const addr = data.address;
    const hasAddress = addr && (addr.street || addr.unitNumber || addr.city || addr.province || addr.zipCode);
    createMutation.mutate({ ...data, items: orderItems, address: hasAddress ? addr : undefined });
  };

  const filterOrders = (status?: string) => {
    let filtered = orders;
    if (status) filtered = filtered.filter((o) => o.currentStatus === status);
    if (search) {
      filtered = filtered.filter(
        (o) =>
          o.trackingNumber.toLowerCase().includes(search.toLowerCase()) ||
          o.customerName.toLowerCase().includes(search.toLowerCase())
      );
    }
    return filtered;
  };

  const poolOrders = orders.filter((o) => {
    if (search) return o.trackingNumber.toLowerCase().includes(search.toLowerCase()) || o.customerName.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 overflow-auto h-full">
        <h1 className="text-xl sm:text-2xl font-bold">Orders</h1>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const AdminOrdersTable = ({ filteredOrders, showAssign = false }: { filteredOrders: IOrder[]; showAssign?: boolean }) => (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tracking #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              {showAssign && <TableHead>Assign To</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={showAssign ? 6 : 5} className="text-center text-muted-foreground py-8">
                  No orders found
                </TableCell>
              </TableRow>
            ) : (
              filteredOrders.map((order) => (
                <OrderRow
                  key={order._id}
                  order={order}
                  onClick={() => navigate(`/orders/${order._id}`)}
                  assignable={showAssign}
                  allUsers={allUsers}
                  onAssign={(orderId, username, displayName) =>
                    assignMutation.mutate({ orderId, username, displayName })
                  }
                />
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  // ─── EMPLOYEE VIEW ──────────────────────────────────────────────
  if (!isAdmin) {
    const { text: greetText, Icon: GreetIcon } = getGreeting();

    return (
      <div className="p-3 sm:p-6 space-y-6 overflow-auto h-full">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <GreetIcon className="h-4 w-4" />
              <span>{greetText}, <strong className="text-foreground">{user?.username}</strong>!</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-orders-title">Orders</h1>
          </div>
        </div>

        {/* Assigned Orders */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Assigned to You</h2>
            {myPendingAssigned.length > 0 && (
              <Badge className="bg-primary text-primary-foreground">{myPendingAssigned.length} pending</Badge>
            )}
          </div>

          {myAssignedOrders.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground text-sm">
                No orders are currently assigned to you.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {myPendingAssigned.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Pending</p>
                  <div className="space-y-2">
                    {myPendingAssigned.map((order) => (
                      <Card key={order._id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate(`/orders/${order._id}`)}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1.5 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono font-semibold text-sm">{order.trackingNumber}</span>
                                <StatusBadge status={order.currentStatus} />
                              </div>
                              <p className="font-medium">{order.customerName}</p>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>Total: <strong className="text-foreground">{formatCurrency(order.totalAmount)}</strong></span>
                                <span>Channel: <strong className="text-foreground capitalize">{order.sourceChannel}</strong></span>
                                <span>Created: <strong className="text-foreground">{fmt12(order.createdAt)}</strong></span>
                                {order.assignedAt && <span>Assigned: <strong className="text-foreground">{fmt12(order.assignedAt)}</strong></span>}
                                {order.assignedBy && <span>By: <strong className="text-foreground">{order.assignedBy}</strong></span>}
                              </div>
                              {order.notes && <p className="text-xs text-muted-foreground">Note: {order.notes}</p>}
                              <div className="flex flex-wrap gap-1">
                                {order.items.slice(0, 3).map((item, i) => (
                                  <Badge key={i} variant="outline" className="text-xs">{item.itemName} ×{item.quantity}</Badge>
                                ))}
                                {order.items.length > 3 && <Badge variant="outline" className="text-xs">+{order.items.length - 3} more</Badge>}
                              </div>
                            </div>
                            <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1" />
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {myAssignedOrders.filter((o) => o.currentStatus === "Completed").length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Completed</p>
                  <div className="space-y-2">
                    {myAssignedOrders.filter((o) => o.currentStatus === "Completed").map((order) => (
                      <Card key={order._id} className="cursor-pointer opacity-75 hover:opacity-100 transition-opacity" onClick={() => navigate(`/orders/${order._id}`)}>
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm">{order.trackingNumber}</span>
                                <StatusBadge status={order.currentStatus} />
                              </div>
                              <p className="text-sm text-muted-foreground">{order.customerName} · {formatCurrency(order.totalAmount)}</p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <Separator />

        {/* Order Pool */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-muted-foreground">Order Pool</h2>
          </div>

          {hasPendingAssigned && (
            <div className="flex items-start gap-3 p-3 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-300">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>Complete your <strong>{myPendingAssigned.length} assigned order{myPendingAssigned.length > 1 ? "s" : ""}</strong> before picking up from the pool.</span>
            </div>
          )}

          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search orders..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-orders"
            />
          </div>

          <Card className={hasPendingAssigned ? "opacity-60 pointer-events-none select-none" : ""}>
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
                  {poolOrders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No orders found</TableCell>
                    </TableRow>
                  ) : (
                    poolOrders.map((order) => (
                      <TableRow
                        key={order._id}
                        className="cursor-pointer"
                        onClick={() => !hasPendingAssigned && navigate(`/orders/${order._id}`)}
                        data-testid={`row-pool-order-${order._id}`}
                      >
                        <TableCell className="font-medium font-mono text-sm">{order.trackingNumber}</TableCell>
                        <TableCell>{order.customerName}</TableCell>
                        <TableCell className="text-right">{formatCurrency(order.totalAmount)}</TableCell>
                        <TableCell><StatusBadge status={order.currentStatus} /></TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(order.createdAt)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ─── ADMIN VIEW ─────────────────────────────────────────────────
  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 overflow-auto h-full">
      <div className="flex items-center justify-between gap-2 sm:gap-4 flex-wrap">
        <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-orders-title">Orders</h1>
        <Button onClick={() => { setCreateOpen(true); setOrderItems([]); form.reset(); setShowAddress(false); }} data-testid="button-create-order">
          <Plus className="mr-1" /> Create Order
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search orders..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-search-orders"
        />
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all" data-testid="tab-all">All</TabsTrigger>
          <TabsTrigger value="pending-payment" data-testid="tab-pending-payment">Pending Payment</TabsTrigger>
          <TabsTrigger value="pending-release" data-testid="tab-pending-release">Pending Release</TabsTrigger>
          <TabsTrigger value="released" data-testid="tab-released">Released</TabsTrigger>
          <TabsTrigger value="completed" data-testid="tab-completed">Completed</TabsTrigger>
        </TabsList>
        <TabsContent value="all"><AdminOrdersTable filteredOrders={filterOrders()} showAssign /></TabsContent>
        <TabsContent value="pending-payment"><AdminOrdersTable filteredOrders={filterOrders("Pending Payment")} showAssign /></TabsContent>
        <TabsContent value="pending-release"><AdminOrdersTable filteredOrders={filterOrders("Pending Release")} showAssign /></TabsContent>
        <TabsContent value="released"><AdminOrdersTable filteredOrders={filterOrders("Released")} showAssign /></TabsContent>
        <TabsContent value="completed"><AdminOrdersTable filteredOrders={filterOrders("Completed")} showAssign /></TabsContent>
      </Tabs>

      {/* View by Staff Member */}
      <Separator />
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <UserCheck className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">View by Staff Member</h2>
        </div>

        <div className="flex gap-3 flex-wrap">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">Employee</p>
            <Select
              value={viewUser && employees.find((u) => u.username === viewUser) ? viewUser : ""}
              onValueChange={(v) => setViewUser(v)}
            >
              <SelectTrigger className="w-[180px]" data-testid="select-view-employee">
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No employees</div>
                ) : employees.map((u) => (
                  <SelectItem key={u.username} value={u.username}>{u.username}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">Admin</p>
            <Select
              value={viewUser && admins.find((u) => u.username === viewUser) ? viewUser : ""}
              onValueChange={(v) => setViewUser(v)}
            >
              <SelectTrigger className="w-[180px]" data-testid="select-view-admin">
                <SelectValue placeholder="Select admin" />
              </SelectTrigger>
              <SelectContent>
                {admins.map((u) => (
                  <SelectItem key={u.username} value={u.username}>{u.username} {u.username === user?.username ? "(you)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {viewUser && (
            <div className="flex items-end">
              <Button variant="ghost" size="sm" onClick={() => setViewUser("")}>Clear</Button>
            </div>
          )}
        </div>

        {viewUser && (
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Assigned — Not Yet Completed</span>
                {viewUserAssigned.length > 0 && <Badge variant="outline">{viewUserAssigned.length}</Badge>}
              </div>
              {viewUserAssigned.length === 0 ? (
                <p className="text-sm text-muted-foreground pl-1">No pending assigned orders.</p>
              ) : (
                <div className="space-y-2">
                  {viewUserAssigned.map((order) => (
                    <Card key={order._id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate(`/orders/${order._id}`)}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1.5 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-semibold text-sm">{order.trackingNumber}</span>
                              <StatusBadge status={order.currentStatus} />
                            </div>
                            <p className="font-medium">{order.customerName}</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span>Total: <strong className="text-foreground">{formatCurrency(order.totalAmount)}</strong></span>
                              <span>Channel: <strong className="text-foreground capitalize">{order.sourceChannel}</strong></span>
                              <span>Created: <strong className="text-foreground">{fmt12(order.createdAt)}</strong></span>
                              {order.assignedAt && <span>Assigned: <strong className="text-foreground">{fmt12(order.assignedAt)}</strong></span>}
                              {order.assignedBy && <span>By: <strong className="text-foreground">{order.assignedBy}</strong></span>}
                              {order.lockedBy && <span>Processing: <strong className="text-foreground">{order.lockedBy}</strong></span>}
                            </div>
                            {order.notes && <p className="text-xs text-muted-foreground">Note: {order.notes}</p>}
                            <div className="flex flex-wrap gap-1">
                              {order.items.slice(0, 3).map((item, i) => (
                                <Badge key={i} variant="outline" className="text-xs">{item.itemName} ×{item.quantity}</Badge>
                              ))}
                              {order.items.length > 3 && <Badge variant="outline" className="text-xs">+{order.items.length - 3} more</Badge>}
                            </div>
                          </div>
                          <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Completed</span>
                {viewUserCompleted.length > 0 && <Badge variant="outline">{viewUserCompleted.length}</Badge>}
              </div>
              {viewUserCompleted.length === 0 ? (
                <p className="text-sm text-muted-foreground pl-1">No completed orders yet.</p>
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tracking #</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead>Completed On</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {viewUserCompleted.map((order) => {
                          const completedEntry = [...order.statusHistory].reverse().find((s) => s.status === "Completed");
                          return (
                            <TableRow key={order._id} className="cursor-pointer" onClick={() => navigate(`/orders/${order._id}`)}>
                              <TableCell className="font-mono text-sm font-medium">{order.trackingNumber}</TableCell>
                              <TableCell>{order.customerName}</TableCell>
                              <TableCell className="text-right">{formatCurrency(order.totalAmount)}</TableCell>
                              <TableCell className="text-muted-foreground text-sm">{completedEntry ? fmt12(completedEntry.timestamp) : fmt12(order.updatedAt)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create Order Dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) { setOrderItems([]); form.reset(); setShowAddress(false); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Order</DialogTitle>
            <DialogDescription>Fill in the details to create a new order.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleCreateSubmit)} className="space-y-4">
              <FormField control={form.control} name="customerName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Customer Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Type customer name" {...field} data-testid="input-customer-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="sourceChannel" render={({ field }) => (
                <FormItem>
                  <FormLabel>Source Channel</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-channel"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="walk-in">Walk-in</SelectItem>
                      <SelectItem value="phone">Phone</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="message">Message</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Items</label>
                <div className="flex items-end gap-2 flex-wrap">
                  <Select value={selectedItemId} onValueChange={setSelectedItemId}>
                    <SelectTrigger className="w-[200px]" data-testid="select-order-item">
                      <SelectValue placeholder="Select item" />
                    </SelectTrigger>
                    <SelectContent>
                      {allItems.map((item) => (
                        <SelectItem key={item._id} value={item._id}>
                          {item.itemName} ({item.currentQuantity} avail)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min={1}
                    value={itemQty}
                    onChange={(e) => setItemQty(parseInt(e.target.value) || 1)}
                    className="w-20"
                    data-testid="input-order-item-qty"
                  />
                  <Button type="button" variant="secondary" onClick={addItemToOrder} data-testid="button-add-order-item">
                    Add
                  </Button>
                </div>
                {orderItems.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderItems.map((oi) => (
                        <TableRow key={oi.itemId}>
                          <TableCell>{oi.itemName}</TableCell>
                          <TableCell className="text-right">{oi.quantity}</TableCell>
                          <TableCell className="text-right">{formatCurrency(oi.unitPrice)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(oi.unitPrice * oi.quantity)}</TableCell>
                          <TableCell>
                            <Button type="button" variant="ghost" size="icon" onClick={() => removeOrderItem(oi.itemId)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell colSpan={3} className="font-bold text-right">Total</TableCell>
                        <TableCell className="text-right font-bold">
                          {formatCurrency(orderItems.reduce((sum, oi) => sum + oi.unitPrice * oi.quantity, 0))}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
                {orderItems.length === 0 && (
                  <p className="text-sm text-muted-foreground">No items added yet</p>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="toggle-address"
                    checked={showAddress}
                    onCheckedChange={(checked) => setShowAddress(!!checked)}
                    data-testid="checkbox-toggle-address"
                  />
                  <label htmlFor="toggle-address" className="flex items-center gap-1.5 text-sm font-medium leading-none cursor-pointer">
                    <MapPin className="h-4 w-4" />
                    Add Delivery Address
                  </label>
                </div>
                {showAddress && (
                  <div className="space-y-3 pl-6">
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={form.control} name="address.street" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Street Name</FormLabel>
                          <FormControl><Input placeholder="Street name" {...field} data-testid="input-address-street" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="address.unitNumber" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Unit/Building Number</FormLabel>
                          <FormControl><Input placeholder="Unit/Building #" {...field} data-testid="input-address-unit" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <FormField control={form.control} name="address.city" render={({ field }) => (
                        <FormItem>
                          <FormLabel>City</FormLabel>
                          <FormControl><Input placeholder="City" {...field} data-testid="input-address-city" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="address.province" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Province</FormLabel>
                          <FormControl><Input placeholder="Province" {...field} data-testid="input-address-province" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="address.zipCode" render={({ field }) => (
                        <FormItem>
                          <FormLabel>ZIP Code</FormLabel>
                          <FormControl><Input placeholder="ZIP Code" {...field} data-testid="input-address-zip" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                  </div>
                )}
              </div>

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl><Input {...field} data-testid="input-order-notes" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <Button type="submit" className="w-full" disabled={createMutation.isPending || orderItems.length === 0} data-testid="button-submit-order">
                {createMutation.isPending && <Loader2 className="animate-spin mr-1" />}
                <ShoppingCart className="mr-1" /> Create Order
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
