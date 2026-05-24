import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft, Loader2, CreditCard, Truck, Clock, CheckCircle, MapPin,
  Lock, UserCheck, AlertTriangle, User, RefreshCw, Play, CheckCheck,
  UserX, Circle, Upload, X, Receipt, Banknote, Smartphone, Package,
  FileText, Hash, DollarSign, ImageIcon,
} from "lucide-react";
import { processPaymentSchema, type ProcessPaymentInput, type IOrder, PAYMENT_METHOD_LABELS } from "@shared/schema";
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
import { Textarea } from "@/components/ui/textarea";

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

function formatCurrency(v: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v);
}

// ─── Payment Processing Modal ─────────────────────────────────────────────────
interface PaymentModalProps {
  open: boolean;
  order: IOrder;
  onClose: () => void;
  onSuccess: () => void;
}

function PaymentModal({ open, order, onClose, onSuccess }: PaymentModalProps) {
  const { toast } = useToast();
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isGcash = order.paymentMethod === "gcash" || order.paymentMethod === "gcash_qr";
  const isCash = order.paymentMethod === "cash";
  const isCod = order.paymentMethod === "cod";
  const isPickup = order.orderType?.includes("pickup") || order.orderType?.includes("walkin");

  const form = useForm<ProcessPaymentInput>({
    resolver: zodResolver(processPaymentSchema),
    defaultValues: {
      orderId: order._id,
      paymentMethod: order.paymentMethod,
      customerName: order.customerName,
      deliveryAddress: [
        order.address?.street,
        order.address?.city,
        order.address?.province,
        order.address?.zipCode,
      ].filter(Boolean).join(", "),
      amountPaid: order.totalAmount,
      amountTendered: order.totalAmount,
      transactionCode: "",
      gcashSenderNumber: "",
      gcashReferenceNumber: "",
      receiptImagePath: "",
      notes: "",
      paymentDate: new Date().toISOString().slice(0, 16),
    },
  });

  const amountPaid = form.watch("amountPaid") || 0;
  const amountTendered = form.watch("amountTendered") || 0;
  const change = Math.max(0, amountTendered - amountPaid);

  useEffect(() => {
    if (open) {
      form.reset({
        orderId: order._id,
        paymentMethod: order.paymentMethod,
        customerName: order.customerName,
        deliveryAddress: [
          order.address?.street,
          order.address?.city,
          order.address?.province,
          order.address?.zipCode,
        ].filter(Boolean).join(", "),
        amountPaid: order.totalAmount,
        amountTendered: order.totalAmount,
        transactionCode: "",
        gcashSenderNumber: "",
        gcashReferenceNumber: "",
        receiptImagePath: "",
        notes: "",
        paymentDate: new Date().toISOString().slice(0, 16),
      });
      setReceiptFile(null);
      setReceiptPreview("");
    }
  }, [open, order]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setReceiptPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  const completeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/orders/${order._id}/complete-processing`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "Failed to complete processing");
      return json;
    },
  });

  const payMutation = useMutation({
    mutationFn: async (data: ProcessPaymentInput) => {
      const res = await apiRequest("POST", "/api/billing/pay", data);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || json?.message || "Payment failed");
      return json;
    },
  });

  const handleSubmit = async (data: ProcessPaymentInput) => {
    try {
      setUploading(true);

      // 1. Upload receipt image if selected
      if (receiptFile) {
        const formData = new FormData();
        formData.append("receipt", receiptFile);
        const uploadRes = await fetch("/api/billing/upload-receipt", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        const uploadJson = await uploadRes.json();
        if (uploadJson.success) {
          data.receiptImagePath = uploadJson.data.path;
        }
      }

      setUploading(false);

      // 2. Log payment (this moves order to Pending Release)
      const payResult = await payMutation.mutateAsync(data);

      // 3. Mark processing complete (set fulfillmentStatus = ready)
      if (!order.completedProcessingAt) {
        await completeMutation.mutateAsync();
      }

      // 4. Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ["/api/orders", order._id] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/ledger"] });

      const txnCode = payResult?.data?.transactionCode || "";
      toast({
        title: "Payment recorded successfully!",
        description: txnCode ? `Transaction Code: ${txnCode}` : "Order is now Pending Release.",
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setUploading(false);
      toast({ title: "Payment failed", description: err.message, variant: "destructive" });
    }
  };

  const isSubmitting = uploading || payMutation.isPending || completeMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isSubmitting) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            {isGcash ? <Smartphone className="h-5 w-5 text-blue-500" /> : <Banknote className="h-5 w-5 text-green-600" />}
            Process Payment — {PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod}
          </DialogTitle>
          <DialogDescription>
            Complete all required details to record payment for order {order.trackingNumber}
          </DialogDescription>
        </DialogHeader>

        {/* Order Summary Banner */}
        <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">{order.trackingNumber}</span>
              <Badge variant="outline" className="text-xs capitalize">
                {order.orderType?.replace(/_/g, " ") || ""}
              </Badge>
            </div>
            <span className="text-xl font-bold text-primary">{formatCurrency(order.totalAmount)}</span>
          </div>

          {/* Items list */}
          <div className="space-y-1">
            {order.items.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{item.itemName} × {item.qty}</span>
                <span className="font-medium">{formatCurrency(item.lineTotal)}</span>
              </div>
            ))}
            {order.deliveryFee > 0 && (
              <div className="flex justify-between text-sm pt-1 border-t">
                <span className="text-muted-foreground">Delivery Fee</span>
                <span className="font-medium">{formatCurrency(order.deliveryFee)}</span>
              </div>
            )}
          </div>

          {/* Customer info */}
          <div className="flex items-center gap-4 text-sm pt-1 border-t">
            <div className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">{order.customerName}</span>
            </div>
            {order.address && (order.address.street || order.address.city) && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                <span>{[order.address.street, order.address.city].filter(Boolean).join(", ")}</span>
              </div>
            )}
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">

            {/* ── SECTION: Customer & Address ────────────────────── */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> Customer Details
              </h3>
              <div className="grid grid-cols-1 gap-3">
                <FormField control={form.control} name="customerName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Customer Name</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-customer-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {isPickup && (
                  <FormField control={form.control} name="deliveryAddress" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pickup / Delivery Address</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Street, City, Province" data-testid="input-delivery-address" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
                {!isPickup && order.address && (
                  <FormField control={form.control} name="deliveryAddress" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Delivery Address</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Full delivery address" data-testid="input-delivery-address" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </div>
            </div>

            <Separator />

            {/* ── SECTION: Payment Details (GCash) ─────────────────── */}
            {isGcash && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <Smartphone className="h-3.5 w-3.5" /> GCash Details
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="gcashSenderNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sender's GCash Number <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="09XXXXXXXXX" maxLength={11} data-testid="input-gcash-sender" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="gcashReferenceNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel>GCash Reference Number <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. 12345678901" data-testid="input-gcash-ref" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>
            )}

            {/* ── SECTION: Payment Details (Cash / COD) ────────────── */}
            {(isCash || isCod) && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <Banknote className="h-3.5 w-3.5" /> {isCod ? "Cash on Delivery Details" : "Cash Payment Details"}
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="amountTendered" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount Tendered (₱) <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min={order.totalAmount}
                          {...field}
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                          data-testid="input-amount-tendered"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="flex flex-col justify-end pb-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Change Due</p>
                    <div className={`text-2xl font-bold tabular-nums ${change > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                      {formatCurrency(change)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <Separator />

            {/* ── SECTION: Amount & Transaction Code ──────────────── */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5" /> Amount & Transaction
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="amountPaid" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount Paid (₱) <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min={0.01}
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                        data-testid="input-amount-paid"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Hash className="h-3 w-3" /> Transaction Code
                  </p>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/40 h-9">
                    <span className="font-mono text-sm text-muted-foreground select-all">
                      Auto-generated on save
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">System-generated unique code</p>
                </div>
              </div>

              <div className="mt-3">
                <FormField control={form.control} name="paymentDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date & Time of Payment</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} data-testid="input-payment-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </div>

            <Separator />

            {/* ── SECTION: Receipt / Proof Upload ─────────────────── */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <ImageIcon className="h-3.5 w-3.5" />
                {isGcash ? "GCash Screenshot / Proof" : "Receipt Image"}
                {isGcash && <span className="text-destructive ml-1">*</span>}
              </h3>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                data-testid="upload-receipt-drop"
              >
                {receiptPreview ? (
                  <div className="relative w-full">
                    <img src={receiptPreview} alt="Receipt preview" className="max-h-48 mx-auto rounded-md object-contain" />
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="absolute top-1 right-1 h-6 w-6 p-0"
                      onClick={(e) => { e.stopPropagation(); setReceiptFile(null); setReceiptPreview(""); }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      {isGcash ? "Upload GCash screenshot" : "Upload receipt photo"}
                    </p>
                    <p className="text-xs text-muted-foreground">JPG, PNG, WEBP up to 10MB</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              {isGcash && !receiptFile && (
                <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> GCash screenshot is strongly recommended for verification
                </p>
              )}
            </div>

            <Separator />

            {/* ── SECTION: Notes ───────────────────────────────────── */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Notes / Remarks
              </h3>
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Any remarks, instructions, or verification notes..."
                      rows={2}
                      data-testid="input-payment-notes"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* ── Summary Row ──────────────────────────────────────── */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total to Collect</p>
                <p className="text-2xl font-bold">{formatCurrency(order.totalAmount)}</p>
              </div>
              {(isCash || isCod) && amountTendered > 0 && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Change</p>
                  <p className={`text-2xl font-bold ${change > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                    {formatCurrency(change)}
                  </p>
                </div>
              )}
            </div>

            {/* ── Action Buttons ────────────────────────────────────── */}
            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={onClose}
                disabled={isSubmitting}
                data-testid="button-cancel-payment"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                disabled={isSubmitting}
                data-testid="button-confirm-payment"
              >
                {isSubmitting ? (
                  <><Loader2 className="animate-spin mr-2 h-4 w-4" />
                    {uploading ? "Uploading..." : "Processing..."}
                  </>
                ) : (
                  <><Receipt className="mr-2 h-4 w-4" /> Confirm & Record Payment</>
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Order Detail Page ───────────────────────────────────────────────────
export default function OrderDetailPage() {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const [, navigate] = useLocation();
  const [match, params] = useRoute("/orders/:id");
  const orderId = params?.id;

  const [lockInfo, setLockInfo] = useState<LockInfo | null>(null);
  const [assignTarget, setAssignTarget] = useState("");
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: orderData, isLoading } = useQuery<{ success: boolean; data: { order: IOrder; payments: any[] } }>({
    queryKey: ["/api/orders", orderId],
    enabled: !!orderId,
    refetchInterval: 8000,
  });

  const { data: usersData } = useQuery<{ success: boolean; data: { username: string; role: string }[] }>({
    queryKey: ["/api/users/simple"],
    enabled: isAdmin,
  });

  const order = orderData?.data?.order;
  const allUsers = usersData?.data || [];

  const acquireLock = useCallback(async () => {
    if (!orderId) return;
    try {
      const res = await apiRequest("POST", `/api/orders/${orderId}/lock`);
      const data = await res.json();
      if (data.success) setLockInfo(data.data);
    } catch { /* ignore */ }
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

  const formatDate = (d: string) => new Date(d).toLocaleString("en-PH", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });

  const releaseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/release`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "Release failed");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Items released — order is now Completed!" });
    },
    onError: (err: Error) => toast({ title: "Release failed", description: err.message, variant: "destructive" }),
  });

  const takeoverMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/takeover`);
      return res.json();
    },
    onSuccess: () => { setLockInfo(null); toast({ title: "You have taken over this order" }); },
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

  const unassignMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/orders/${orderId}/assign`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "Failed to unassign");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders?pool=true"] });
      toast({ title: "Order returned to pool" });
    },
    onError: (err: Error) => toast({ title: "Unassign failed", description: err.message, variant: "destructive" }),
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/start-processing`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "Failed to start");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Processing started — collect payment details when done" });
    },
    onError: (err: Error) => toast({ title: "Failed to start processing", description: err.message, variant: "destructive" }),
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

      {/* Payment Processing Modal */}
      {paymentModalOpen && (
        <PaymentModal
          open={paymentModalOpen}
          order={order}
          onClose={() => setPaymentModalOpen(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
            queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
            queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
          }}
        />
      )}

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
                  <span className="text-muted-foreground">Order Type</span>
                  <p className="font-medium capitalize">{order.orderType?.replace(/_/g, " ") || order.sourceChannel}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Channel</span>
                  <p className="font-medium capitalize">{order.orderChannel || order.sourceChannel}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Payment Status</span>
                  <p className="font-medium capitalize">{order.paymentStatus?.replace(/_/g, " ") || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Fulfillment</span>
                  <p className="font-medium capitalize">{order.fulfillmentStatus?.replace(/_/g, " ") || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Payment Method</span>
                  <p className="font-medium capitalize">
                    {PAYMENT_METHOD_LABELS[order.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] || order.paymentMethod || "—"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Created</span>
                  <p className="font-medium">{formatDate(order.createdAt)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Total</span>
                  <p className="font-medium text-lg" data-testid="text-order-total">{formatCurrency(order.totalAmount)}</p>
                </div>
                {order.deliveryFee > 0 && (
                  <div>
                    <span className="text-muted-foreground">Delivery Fee</span>
                    <p className="font-medium">{formatCurrency(order.deliveryFee)}</p>
                  </div>
                )}
                {order.scheduledDate && (
                  <div>
                    <span className="text-muted-foreground">Scheduled Date</span>
                    <p className="font-medium">{new Date(order.scheduledDate).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })}</p>
                  </div>
                )}
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
                      <TableCell>
                        <p className="font-medium">{item.itemName}</p>
                        {item.discountApplied && item.offerName && (
                          <p className="text-xs text-green-600 mt-0.5">🏷 {item.offerName}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{item.qty ?? (item as any).quantity ?? 0}</TableCell>
                      <TableCell className="text-right">
                        {item.discountApplied ? (
                          <div>
                            <span className="line-through text-muted-foreground text-xs">{formatCurrency(item.originalUnitPrice)}</span>
                            <span className="ml-1 text-green-600 font-medium">{formatCurrency(item.discountedUnitPrice)}</span>
                          </div>
                        ) : (
                          formatCurrency(item.originalUnitPrice ?? (item as any).unitPrice ?? 0)
                        )}
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(item.lineTotal)}</TableCell>
                    </TableRow>
                  ))}
                  {order.deliveryFee > 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-right text-muted-foreground">Subtotal</TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatCurrency(order.subtotal || order.totalAmount - order.deliveryFee)}</TableCell>
                    </TableRow>
                  )}
                  {order.deliveryFee > 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-right text-muted-foreground">Delivery Fee</TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatCurrency(order.deliveryFee)}</TableCell>
                    </TableRow>
                  )}
                  <TableRow>
                    <TableCell colSpan={3} className="font-bold text-right">Total</TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(order.totalAmount)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Log Payment — fallback card for orders already in Pending Payment but not through the modal flow */}
          {order.currentStatus === "Pending Payment" && !order.startedAt && (
            <Card className="border-amber-200 dark:border-amber-800">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <CreditCard className="h-4 w-4" /> Payment Pending
                </CardTitle>
                <CardDescription>
                  This order is waiting for payment. Assign it to a staff member and start processing to collect payment.
                </CardDescription>
              </CardHeader>
              {isAdmin && (
                <CardContent>
                  <Button
                    onClick={() => setPaymentModalOpen(true)}
                    className="bg-green-600 hover:bg-green-700 text-white"
                    data-testid="button-log-payment-admin"
                  >
                    <Receipt className="mr-2 h-4 w-4" /> Log Payment Now
                  </Button>
                </CardContent>
              )}
            </Card>
          )}

          {order.currentStatus === "Pending Release" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Truck className="h-4 w-4" /> Release Items
                </CardTitle>
                <CardDescription>Payment confirmed. Release items from inventory to complete this order.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => releaseMutation.mutate()}
                  disabled={releaseMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                  data-testid="button-release-items"
                >
                  {releaseMutation.isPending && <Loader2 className="animate-spin mr-1" />}
                  <Truck className="mr-2 h-4 w-4" /> Release Items & Complete Order
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
            <CardContent className="space-y-4">
              {/* Lifecycle steps */}
              <div className="space-y-2">
                {/* Step 1: Assigned */}
                <div className={`flex items-start gap-3 rounded-md p-2.5 ${order.assignedTo ? "bg-primary/5 border border-primary/20" : "bg-muted/30 border border-transparent"}`}>
                  <div className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${order.assignedTo ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {order.assignedTo ? <CheckCheck className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${order.assignedTo ? "" : "text-muted-foreground"}`}>
                      {order.assignedTo ? (order.assignedToName || order.assignedTo) : "Unassigned"}
                    </p>
                    {order.assignedAt && <p className="text-xs text-muted-foreground">{fmt12(order.assignedAt)}{order.assignedBy ? ` · by ${order.assignedBy}` : ""}</p>}
                    {!order.assignedTo && <p className="text-xs text-muted-foreground">Waiting in the pool</p>}
                  </div>
                </div>

                {/* Step 2: Processing started */}
                <div className={`flex items-start gap-3 rounded-md p-2.5 ${order.startedAt ? "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800" : "bg-muted/30 border border-transparent"}`}>
                  <div className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${order.startedAt ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground"}`}>
                    {order.startedAt ? <Play className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${order.startedAt ? "" : "text-muted-foreground"}`}>Processing Started</p>
                    {order.startedAt ? <p className="text-xs text-muted-foreground">{fmt12(order.startedAt)}</p> : <p className="text-xs text-muted-foreground">Not started</p>}
                  </div>
                </div>

                {/* Step 3: Payment collected */}
                <div className={`flex items-start gap-3 rounded-md p-2.5 ${order.completedProcessingAt ? "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800" : "bg-muted/30 border border-transparent"}`}>
                  <div className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${order.completedProcessingAt ? "bg-green-600 text-white" : "bg-muted text-muted-foreground"}`}>
                    {order.completedProcessingAt ? <CheckCheck className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${order.completedProcessingAt ? "" : "text-muted-foreground"}`}>Payment Collected</p>
                    {order.completedProcessingAt ? <p className="text-xs text-muted-foreground">{fmt12(order.completedProcessingAt)}</p> : <p className="text-xs text-muted-foreground">Not done yet</p>}
                  </div>
                </div>
              </div>

              {/* Assignee action buttons */}
              {order.assignedTo && order.assignedTo === user?.username && (
                <div className="space-y-2 pt-1">
                  {!order.startedAt && (
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={startMutation.isPending}
                      onClick={() => startMutation.mutate()}
                      data-testid="button-start-processing"
                    >
                      {startMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
                      Start Processing
                    </Button>
                  )}
                  {order.startedAt && !order.completedProcessingAt && order.currentStatus === "Pending Payment" && (
                    <Button
                      size="sm"
                      className="w-full bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => setPaymentModalOpen(true)}
                      data-testid="button-complete-processing"
                    >
                      <Receipt className="h-3 w-3 mr-1" />
                      Mark Done & Collect Payment
                    </Button>
                  )}
                </div>
              )}

              {/* Admin controls */}
              {isAdmin && (
                <div className="space-y-2 pt-1 border-t">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide pt-1">Admin Controls</p>
                  <Select value={assignTarget} onValueChange={setAssignTarget}>
                    <SelectTrigger className="w-full" data-testid="select-assign-user">
                      <SelectValue placeholder={order.assignedTo ? "Reassign to..." : "Assign to..."} />
                    </SelectTrigger>
                    <SelectContent>
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
                      const found = allUsers.find((u) => u.username === assignTarget);
                      assignMutation.mutate({ username: assignTarget, displayName: found?.username || assignTarget });
                      setAssignTarget("");
                    }}
                    data-testid="button-save-assign"
                  >
                    {assignMutation.isPending ? <Loader2 className="animate-spin mr-1 h-3 w-3" /> : <UserCheck className="h-3 w-3 mr-1" />}
                    {order.assignedTo ? "Reassign" : "Assign"}
                  </Button>
                  {order.assignedTo && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full text-destructive border-destructive/30 hover:bg-destructive/10"
                      disabled={unassignMutation.isPending}
                      onClick={() => unassignMutation.mutate()}
                      data-testid="button-unassign"
                    >
                      {unassignMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <UserX className="h-3 w-3 mr-1" />}
                      Unassign
                    </Button>
                  )}
                  {/* Admin can also log payment directly */}
                  {order.currentStatus === "Pending Payment" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-700 dark:hover:bg-green-950/30"
                      onClick={() => setPaymentModalOpen(true)}
                      data-testid="button-admin-log-payment"
                    >
                      <Receipt className="h-3 w-3 mr-1" /> Log Payment
                    </Button>
                  )}
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
                      {entry.note && <p className="text-xs mt-1 text-muted-foreground">{entry.note}</p>}
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
