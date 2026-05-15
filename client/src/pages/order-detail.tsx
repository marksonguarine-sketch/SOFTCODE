import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  Loader2,
  CreditCard,
  Truck,
  Clock,
  CheckCircle,
  MapPin,
  Navigation,
  Lock,
  UserCheck,
  AlertTriangle,
  User,
  RefreshCw,
} from "lucide-react";
import { logPaymentSchema, type LogPaymentInput, type IOrder } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { GoogleMap, useJsApiLoader, MarkerF } from "@react-google-maps/api";

function OrderAddressMap({ address, apiKey }: { address: { street: string; unitNumber: string; city: string; province: string; zipCode: string }; apiKey: string }) {
  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: apiKey });
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [mapError, setMapError] = useState(false);
  const geocoded = useRef(false);
  const fullAddress = [address.unitNumber, address.street, address.city, address.province, address.zipCode].filter(Boolean).join(", ") + ", Philippines";

  const onMapLoad = useCallback((map: google.maps.Map) => {
    if (geocoded.current) return;
    geocoded.current = true;
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: fullAddress }, (results, status) => {
      if (status === "OK" && results && results[0]) {
        const loc = results[0].geometry.location;
        const pos = { lat: loc.lat(), lng: loc.lng() };
        setCoords(pos);
        map.panTo(pos);
        map.setZoom(16);
      } else {
        setMapError(true);
      }
    });
  }, [fullAddress]);

  if (!isLoaded) {
    return (
      <div className="h-[300px] flex items-center justify-center bg-muted rounded-lg">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="rounded-lg overflow-hidden border" data-testid="map-order-address">
      <GoogleMap
        mapContainerStyle={{ width: "100%", height: "300px" }}
        center={coords || { lat: 14.5995, lng: 120.9842 }}
        zoom={coords ? 16 : 6}
        onLoad={onMapLoad}
        options={{ mapTypeControl: true, streetViewControl: true, fullscreenControl: true, zoomControl: true }}
      >
        {coords && <MarkerF position={coords} title={fullAddress} />}
      </GoogleMap>
      {mapError && (
        <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400 text-xs text-center">
          Could not locate exact address on map
        </div>
      )}
    </div>
  );
}

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

function fmt12(d: string | Date | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "2-digit", day: "2-digit", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

interface LockInfo {
  locked: boolean;
  lockedBy?: string;
  lockStartedAt?: string;
  lockLastSeen?: string;
}

export default function OrderDetailPage() {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const [, navigate] = useLocation();
  const [match, params] = useRoute("/orders/:id");
  const orderId = params?.id;

  const [lockInfo, setLockInfo] = useState<LockInfo | null>(null);
  const [assignTarget, setAssignTarget] = useState("");
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: orderData, isLoading } = useQuery<{ success: boolean; data: { order: IOrder; payments: any[] } }>({
    queryKey: ["/api/orders", orderId],
    enabled: !!orderId,
    refetchInterval: 15000,
  });

  const { data: mapsKeyData } = useQuery<{ success: boolean; data: { key: string } }>({
    queryKey: ["/api/config/maps-key"],
  });

  const { data: usersData } = useQuery<{ success: boolean; data: { username: string; role: string }[] }>({
    queryKey: ["/api/users/simple"],
    enabled: isAdmin,
  });

  const order = orderData?.data?.order;
  const mapsApiKey = mapsKeyData?.data?.key || "";
  const allUsers = usersData?.data || [];

  const acquireLock = useCallback(async () => {
    if (!orderId) return;
    try {
      const res = await apiRequest("POST", `/api/orders/${orderId}/lock`);
      const data = await res.json();
      if (data.success) setLockInfo(data.data);
    } catch {
      /* ignore */
    }
  }, [orderId]);

  const releaseLock = useCallback(() => {
    if (!orderId) return;
    navigator.sendBeacon(`/api/orders/${orderId}/lock-release`);
    apiRequest("DELETE", `/api/orders/${orderId}/lock`).catch(() => {});
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    acquireLock();
    heartbeatRef.current = setInterval(acquireLock, 90000);
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      releaseLock();
    };
  }, [orderId, acquireLock, releaseLock]);

  const formatCurrency = (v: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v);
  const formatDate = (d: string) => new Date(d).toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const paymentForm = useForm<LogPaymentInput>({
    resolver: zodResolver(logPaymentSchema),
    defaultValues: { orderId: orderId || "", paymentMethod: "GCash", gcashNumber: "", gcashReferenceNumber: "", amountPaid: 0, proofNote: "" },
  });

  const payMutation = useMutation({
    mutationFn: async (data: LogPaymentInput) => {
      const res = await apiRequest("POST", "/api/billing/pay", { ...data, orderId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      paymentForm.reset();
      toast({ title: "Payment logged successfully" });
    },
    onError: (err: Error) => toast({ title: "Payment failed", description: err.message, variant: "destructive" }),
  });

  const releaseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/release`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Items released successfully" });
    },
    onError: (err: Error) => toast({ title: "Release failed", description: err.message, variant: "destructive" }),
  });

  const takeoverMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/takeover`);
      return res.json();
    },
    onSuccess: () => {
      setLockInfo(null);
      toast({ title: "You have taken over this order" });
    },
    onError: (err: Error) => toast({ title: "Takeover failed", description: err.message, variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: async ({ username, displayName }: { username: string; displayName: string }) => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/assign`, { username, displayName });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order assigned successfully" });
    },
    onError: (err: Error) => toast({ title: "Assign failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 overflow-auto h-full">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-3 sm:p-6">
        <p className="text-muted-foreground">Order not found</p>
        <Button variant="ghost" onClick={() => navigate("/orders")} className="mt-4">
          <ArrowLeft className="mr-1" /> Back to Orders
        </Button>
      </div>
    );
  }

  const isLockedByOther = lockInfo?.locked && lockInfo.lockedBy !== user?.username;

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 overflow-auto h-full">

      {/* Lock overlay dialog */}
      <Dialog open={!!isLockedByOther} onOpenChange={() => {}}>
        <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <Lock className="h-5 w-5" /> Order In Progress
            </DialogTitle>
            <DialogDescription>
              This order is currently being processed by another user.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900">
                  <User className="h-5 w-5 text-amber-700 dark:text-amber-400" />
                </div>
                <div>
                  <p className="font-semibold text-sm">{lockInfo?.lockedBy}</p>
                  <p className="text-xs text-muted-foreground">is processing this order</p>
                </div>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Time Started</p>
                  <p className="font-medium mt-0.5">{fmt12(lockInfo?.lockStartedAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Last Active</p>
                  <p className="font-medium mt-0.5">{fmt12(lockInfo?.lockLastSeen)}</p>
                </div>
              </div>
            </div>

            {isAdmin && (
              <div className="space-y-3 pt-1">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Admin Actions</p>
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => takeoverMutation.mutate()}
                  disabled={takeoverMutation.isPending}
                >
                  {takeoverMutation.isPending ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Take Over Order
                </Button>
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Or assign this order to another staff member:</p>
                  <div className="flex gap-2">
                    <Select value={assignTarget} onValueChange={setAssignTarget}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select staff member" />
                      </SelectTrigger>
                      <SelectContent>
                        {allUsers.map((u) => (
                          <SelectItem key={u.username} value={u.username}>
                            {u.username} <span className="text-muted-foreground text-xs ml-1">({u.role})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      disabled={!assignTarget || assignMutation.isPending}
                      onClick={() => {
                        const found = allUsers.find((u) => u.username === assignTarget);
                        assignMutation.mutate({ username: assignTarget, displayName: found?.username || assignTarget });
                      }}
                    >
                      {assignMutation.isPending ? <Loader2 className="animate-spin h-4 w-4" /> : "Assign"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <Button variant="ghost" className="w-full" onClick={() => navigate("/orders")}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Go Back to Orders
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex items-center gap-4 flex-wrap">
        <Button variant="ghost" onClick={() => navigate("/orders")} data-testid="button-back-orders">
          <ArrowLeft className="mr-1" /> Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-order-tracking">Order {order.trackingNumber}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <StatusBadge status={order.currentStatus} />
            <span className="text-sm text-muted-foreground">{formatDate(order.createdAt)}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Order Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Customer</span>
                  <p className="font-medium" data-testid="text-order-customer">{order.customerName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Source Channel</span>
                  <p className="font-medium capitalize">{order.sourceChannel}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Created</span>
                  <p className="font-medium">{formatDate(order.createdAt)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Total</span>
                  <p className="font-medium text-lg" data-testid="text-order-total">{formatCurrency(order.totalAmount)}</p>
                </div>
              </div>
              {order.notes && (
                <div>
                  <span className="text-sm text-muted-foreground">Notes</span>
                  <p className="text-sm">{order.notes}</p>
                </div>
              )}
              {order.address && (order.address.street || order.address.city || order.address.province) && (
                <div className="pt-2">
                  <Separator className="mb-3" />
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Delivery Address</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {order.address.street && (
                      <div>
                        <span className="text-muted-foreground text-xs">Street</span>
                        <p className="font-medium">{order.address.street}</p>
                      </div>
                    )}
                    {order.address.unitNumber && (
                      <div>
                        <span className="text-muted-foreground text-xs">Unit/Building</span>
                        <p className="font-medium">{order.address.unitNumber}</p>
                      </div>
                    )}
                    {order.address.city && (
                      <div>
                        <span className="text-muted-foreground text-xs">City</span>
                        <p className="font-medium">{order.address.city}</p>
                      </div>
                    )}
                    {order.address.province && (
                      <div>
                        <span className="text-muted-foreground text-xs">Province</span>
                        <p className="font-medium">{order.address.province}</p>
                      </div>
                    )}
                    {order.address.zipCode && (
                      <div>
                        <span className="text-muted-foreground text-xs">ZIP Code</span>
                        <p className="font-medium">{order.address.zipCode}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {order.address && (order.address.street || order.address.city) && mapsApiKey && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Navigation className="h-4 w-4" /> Location Map
                </CardTitle>
                <CardDescription>Delivery address on Google Maps</CardDescription>
              </CardHeader>
              <CardContent>
                <OrderAddressMap address={order.address} apiKey={mapsApiKey} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Items</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items.map((item, i) => (
                    <TableRow key={i} data-testid={`row-order-item-${i}`}>
                      <TableCell className="font-medium">{item.itemName}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.lineTotal)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={3} className="font-bold text-right">Total</TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(order.totalAmount)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {order.currentStatus === "Pending Payment" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CreditCard className="h-4 w-4" /> Log Payment
                </CardTitle>
                <CardDescription>Record a payment for this order</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...paymentForm}>
                  <form onSubmit={paymentForm.handleSubmit((data) => payMutation.mutate(data))} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={paymentForm.control} name="gcashNumber" render={({ field }) => (
                        <FormItem>
                          <FormLabel>GCash Number</FormLabel>
                          <FormControl><Input {...field} data-testid="input-gcash-number" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={paymentForm.control} name="gcashReferenceNumber" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Reference Number</FormLabel>
                          <FormControl><Input {...field} data-testid="input-gcash-ref" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={paymentForm.control} name="amountPaid" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount Paid</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} data-testid="input-amount-paid" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={paymentForm.control} name="proofNote" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Proof / Note</FormLabel>
                        <FormControl><Input {...field} data-testid="input-proof-note" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <Button type="submit" disabled={payMutation.isPending} data-testid="button-submit-payment">
                      {payMutation.isPending && <Loader2 className="animate-spin mr-1" />}
                      Log Payment
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          )}

          {order.currentStatus === "Pending Release" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Truck className="h-4 w-4" /> Release Items
                </CardTitle>
                <CardDescription>Release items for this order</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => releaseMutation.mutate()} disabled={releaseMutation.isPending} data-testid="button-release-items">
                  {releaseMutation.isPending && <Loader2 className="animate-spin mr-1" />}
                  Release Items
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {/* Assignment panel */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <UserCheck className="h-4 w-4" /> Assignment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {order.assignedTo ? (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">{order.assignedToName || order.assignedTo}</p>
                  {order.assignedAt && (
                    <p className="text-xs text-muted-foreground">Assigned {fmt12(order.assignedAt)}</p>
                  )}
                  {order.assignedBy && (
                    <p className="text-xs text-muted-foreground">by {order.assignedBy}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Not assigned to anyone</p>
              )}
              {isAdmin && (
                <div className="space-y-2 pt-1">
                  <Select
                    value={assignTarget || order.assignedTo || ""}
                    onValueChange={setAssignTarget}
                  >
                    <SelectTrigger className="w-full" data-testid="select-assign-user">
                      <SelectValue placeholder="Assign to..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unassign__">— Unassign —</SelectItem>
                      {allUsers.map((u) => (
                        <SelectItem key={u.username} value={u.username}>
                          {u.username} <span className="text-muted-foreground text-xs">({u.role})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={!assignTarget || assignMutation.isPending}
                    onClick={() => {
                      const target = assignTarget === "__unassign__" ? "" : assignTarget;
                      const found = allUsers.find((u) => u.username === target);
                      assignMutation.mutate({ username: target, displayName: found?.username || target });
                      setAssignTarget("");
                    }}
                    data-testid="button-save-assign"
                  >
                    {assignMutation.isPending ? <Loader2 className="animate-spin mr-1 h-3 w-3" /> : null}
                    Save Assignment
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Lock status */}
          {order.lockedBy && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Lock className="h-4 w-4" /> Active Processor
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <p className="font-medium">{order.lockedBy}</p>
                <p className="text-xs text-muted-foreground">Started: {fmt12(order.lockStartedAt)}</p>
                <p className="text-xs text-muted-foreground">Last active: {fmt12(order.lockLastSeen)}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {order.statusHistory.map((entry, i) => (
                  <div key={i} className="flex gap-3" data-testid={`timeline-entry-${i}`}>
                    <div className="flex flex-col items-center">
                      <div className="rounded-full bg-primary p-1">
                        {i === order.statusHistory.length - 1 ? (
                          <CheckCircle className="h-3 w-3 text-primary-foreground" />
                        ) : (
                          <Clock className="h-3 w-3 text-primary-foreground" />
                        )}
                      </div>
                      {i < order.statusHistory.length - 1 && <div className="w-px h-full bg-border mt-1" />}
                    </div>
                    <div className="pb-4">
                      <p className="text-sm font-medium">{entry.status}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(entry.timestamp)}</p>
                      {entry.actor && <p className="text-xs text-muted-foreground">by {entry.actor}</p>}
                      {entry.note && <p className="text-xs mt-1">{entry.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
