import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft, Loader2, CreditCard, Truck, Clock, CheckCircle, MapPin,
  Lock, UserCheck, AlertTriangle, User, RefreshCw, Play, CheckCheck,
  UserX, Circle, Upload, X, Receipt, Banknote, Smartphone, Package,
  FileText, Hash, DollarSign, ImageIcon, Car, ClipboardCheck,
  Building2, Phone, UserRound, BadgeCheck, WalletCards, Camera,
  ChevronRight, Scale, Wallet, CalendarClock, Clipboard,
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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

// ─── Comprehensive Order Log Details Modal ────────────────────────────────────
interface PaymentModalProps {
  open: boolean;
  order: IOrder;
  onClose: () => void;
  onSuccess: () => void;
}

function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">{title}</h3>
    </div>
  );
}

function UploadBox({
  label, hint, file, preview, inputRef, onChange, onClear, required,
}: {
  label: string; hint: string; file: File | null; preview: string;
  inputRef: React.RefObject<HTMLInputElement>; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void; required?: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-medium mb-1.5">{label}{required && <span className="text-destructive ml-1">*</span>}</p>
      <div
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed rounded-lg p-4 flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:border-primary/60 hover:bg-muted/20 transition-colors min-h-[90px]"
      >
        {preview ? (
          <div className="relative w-full">
            <img src={preview} alt="preview" className="max-h-36 mx-auto rounded object-contain" />
            <Button type="button" variant="destructive" size="sm" className="absolute top-1 right-1 h-6 w-6 p-0"
              onClick={(e) => { e.stopPropagation(); onClear(); }}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <>
            <Camera className="h-7 w-7 text-muted-foreground" />
            <p className="text-xs font-medium text-center">{hint}</p>
            <p className="text-[10px] text-muted-foreground">JPG, PNG, WEBP · max 10MB</p>
          </>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onChange} />
    </div>
  );
}

function PaymentModal({ open, order, onClose, onSuccess }: PaymentModalProps) {
  const { toast } = useToast();
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState("");
  const [deliveryFile, setDeliveryFile] = useState<File | null>(null);
  const [deliveryPreview, setDeliveryPreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const receiptRef = useRef<HTMLInputElement>(null);
  const deliveryRef = useRef<HTMLInputElement>(null);

  const isGcash = order.paymentMethod === "gcash" || order.paymentMethod === "gcash_qr";
  const isCash = order.paymentMethod === "cash";
  const isCod = order.paymentMethod === "cod";
  const isBank = order.paymentMethod === "bank";
  const isDelivery = order.orderType?.includes("delivery");
  const isPickup = !isDelivery;

  const defaultAddress = [order.address?.street, order.address?.unitNumber, order.address?.city, order.address?.province, order.address?.zipCode].filter(Boolean).join(", ");

  const form = useForm<ProcessPaymentInput>({
    resolver: zodResolver(processPaymentSchema),
    defaultValues: {
      orderId: order._id, paymentMethod: order.paymentMethod,
      customerName: order.customerName, contactNumber: "", recipientName: order.customerName,
      companyName: "", deliveryAddress: defaultAddress,
      allItemsComplete: true, itemConditionNotes: "", checkerName: "",
      amountPaid: order.totalAmount, amountTendered: order.totalAmount,
      orNumber: "", gcashSenderName: "", gcashSenderNumber: "", gcashReferenceNumber: "",
      bankName: "", bankReference: "",
      receiptImagePath: "", proofOfDeliveryPath: "",
      driverName: "", plateNumber: "",
      isFullPayment: true, remainingBalance: 0, balanceDueDate: "",
      transactionCode: "", notes: "",
      paymentDate: new Date().toISOString().slice(0, 16),
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        orderId: order._id, paymentMethod: order.paymentMethod,
        customerName: order.customerName, contactNumber: "", recipientName: order.customerName,
        companyName: "", deliveryAddress: defaultAddress,
        allItemsComplete: true, itemConditionNotes: "", checkerName: "",
        amountPaid: order.totalAmount, amountTendered: order.totalAmount,
        orNumber: "", gcashSenderName: "", gcashSenderNumber: "", gcashReferenceNumber: "",
        bankName: "", bankReference: "",
        receiptImagePath: "", proofOfDeliveryPath: "",
        driverName: "", plateNumber: "",
        isFullPayment: true, remainingBalance: 0, balanceDueDate: "",
        transactionCode: "", notes: "",
        paymentDate: new Date().toISOString().slice(0, 16),
      });
      setReceiptFile(null); setReceiptPreview("");
      setDeliveryFile(null); setDeliveryPreview("");
    }
  }, [open, order._id]);

  function mkFileHandler(setFile: (f: File) => void, setPreview: (s: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]; if (!f) return;
      setFile(f);
      const reader = new FileReader();
      reader.onload = (ev) => setPreview(ev.target?.result as string);
      reader.readAsDataURL(f);
    };
  }

  async function uploadFile(file: File): Promise<string> {
    const fd = new FormData(); fd.append("receipt", file);
    const res = await fetch("/api/billing/upload-receipt", { method: "POST", body: fd, credentials: "include" });
    const json = await res.json();
    return json.success ? json.data.path : "";
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
      if (receiptFile) data.receiptImagePath = await uploadFile(receiptFile);
      if (deliveryFile) data.proofOfDeliveryPath = await uploadFile(deliveryFile);
      setUploading(false);

      const payResult = await payMutation.mutateAsync(data);
      if (!order.completedProcessingAt) await completeMutation.mutateAsync();

      queryClient.invalidateQueries({ queryKey: ["/api/orders", order._id] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/ledger"] });

      const txnCode = payResult?.data?.transactionCode || "";
      toast({ title: "Order details logged!", description: txnCode ? `Txn Code: ${txnCode}` : "Order moved to Pending Release." });
      onSuccess(); onClose();
    } catch (err: any) {
      setUploading(false);
      toast({ title: "Failed to log details", description: err.message, variant: "destructive" });
    }
  };

  const amountPaid = form.watch("amountPaid") || 0;
  const amountTendered = form.watch("amountTendered") || 0;
  const isFullPayment = form.watch("isFullPayment");
  const allItemsComplete = form.watch("allItemsComplete");
  const change = Math.max(0, amountTendered - amountPaid);
  const isSubmitting = uploading || payMutation.isPending || completeMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isSubmitting) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-background border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2 text-base font-bold">
                <ClipboardCheck className="h-5 w-5 text-primary" />
                Log Order Details
              </DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                {order.trackingNumber} · {order.customerName} · {formatCurrency(order.totalAmount)}
              </DialogDescription>
            </div>
            <Badge variant="outline" className="capitalize text-xs">
              {PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod}
            </Badge>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="px-6 py-5 space-y-6">

            {/* ── ORDER SUMMARY ─────────────────────────────────────── */}
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-1.5">
                  <Package className="h-4 w-4 text-muted-foreground" />{order.trackingNumber}
                  <Badge variant="secondary" className="text-xs capitalize ml-1">{order.orderType?.replace(/_/g, " ")}</Badge>
                </span>
                <span className="text-lg font-bold text-primary">{formatCurrency(order.totalAmount)}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-muted-foreground">
                {order.items.map((it, i) => (
                  <div key={i} className="flex justify-between">
                    <span>{it.itemName} × {it.qty}</span>
                    <span>{formatCurrency(it.lineTotal)}</span>
                  </div>
                ))}
              </div>
              {order.deliveryFee > 0 && (
                <div className="flex justify-between text-xs border-t pt-1">
                  <span className="text-muted-foreground">Delivery Fee</span>
                  <span>{formatCurrency(order.deliveryFee)}</span>
                </div>
              )}
            </div>

            {/* ── SECTION 1: CUSTOMER & RECIPIENT ──────────────────── */}
            <div>
              <SectionHeader icon={UserRound} title="Customer & Recipient Details" />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="customerName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Customer Name <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input {...field} data-testid="input-customer-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="contactNumber" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact / Mobile Number</FormLabel>
                    <FormControl><Input {...field} placeholder="09XXXXXXXXX" maxLength={11} data-testid="input-contact-number" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="recipientName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Received By <span className="text-muted-foreground text-xs">(if different from customer)</span></FormLabel>
                    <FormControl><Input {...field} placeholder="Name of person who received the items" data-testid="input-recipient-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="companyName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company / Contractor Name <span className="text-muted-foreground text-xs">(optional)</span></FormLabel>
                    <FormControl><Input {...field} placeholder="e.g. ABC Construction" data-testid="input-company-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="col-span-2">
                  <FormField control={form.control} name="deliveryAddress" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{isDelivery ? "Delivery Address" : "Pickup / Home Address"}</FormLabel>
                      <FormControl><Input {...field} placeholder="Complete address" data-testid="input-delivery-address" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>
            </div>

            <Separator />

            {/* ── SECTION 2: ITEM VERIFICATION ─────────────────────── */}
            <div>
              <SectionHeader icon={BadgeCheck} title="Item Verification & Condition" />
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/20">
                  <div>
                    <p className="text-sm font-medium">All items complete and in good condition?</p>
                    <p className="text-xs text-muted-foreground">Toggle off if any items are missing, damaged, or wet</p>
                  </div>
                  <FormField control={form.control} name="allItemsComplete" render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-items-complete" />
                      </FormControl>
                    </FormItem>
                  )} />
                </div>

                {!allItemsComplete && (
                  <FormField control={form.control} name="itemConditionNotes" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-amber-700 dark:text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5" /> Describe the issue <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Textarea {...field} rows={2} placeholder="e.g. 2 bags of cement torn/wet, 1 sheet plywood with crack, missing 5 pcs nails..." data-testid="input-item-condition" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}

                <FormField control={form.control} name="checkerName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Checker / Packer Name <span className="text-muted-foreground text-xs">(staff who prepared this order)</span></FormLabel>
                    <FormControl><Input {...field} placeholder="Staff name who packed and checked the items" data-testid="input-checker-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </div>

            <Separator />

            {/* ── SECTION 3: PAYMENT DETAILS ────────────────────────── */}
            <div>
              <SectionHeader icon={WalletCards} title="Payment Collection" />
              <div className="space-y-3">

                {/* CASH */}
                {isCash && (
                  <div className="rounded-lg border p-4 space-y-3 bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
                    <p className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide flex items-center gap-1.5">
                      <Banknote className="h-3.5 w-3.5" /> Cash Payment
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={form.control} name="amountTendered" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Amount Tendered (₱) <span className="text-destructive">*</span></FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" min={order.totalAmount} {...field}
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} data-testid="input-amount-tendered" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <div className="flex flex-col justify-end pb-1">
                        <p className="text-xs text-muted-foreground font-medium mb-1">Change Due</p>
                        <div className={`text-3xl font-bold tabular-nums ${change > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                          {formatCurrency(change)}
                        </div>
                      </div>
                    </div>
                    <FormField control={form.control} name="orNumber" render={({ field }) => (
                      <FormItem>
                        <FormLabel>OR / Official Receipt Number <span className="text-muted-foreground text-xs">(for BIR compliance)</span></FormLabel>
                        <FormControl><Input {...field} placeholder="e.g. OR-0012345" data-testid="input-or-number" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                )}

                {/* GCASH */}
                {isGcash && (
                  <div className="rounded-lg border p-4 space-y-3 bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide flex items-center gap-1.5">
                      <Smartphone className="h-3.5 w-3.5" /> GCash / GCash QR
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={form.control} name="gcashSenderName" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Sender's Full Name <span className="text-destructive">*</span></FormLabel>
                          <FormControl><Input {...field} placeholder="Name on GCash account" data-testid="input-gcash-sender-name" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="gcashSenderNumber" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Sender's GCash Number <span className="text-destructive">*</span></FormLabel>
                          <FormControl><Input {...field} placeholder="09XXXXXXXXX" maxLength={11} data-testid="input-gcash-sender" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="gcashReferenceNumber" render={({ field }) => (
                        <FormItem>
                          <FormLabel>GCash Reference Number <span className="text-destructive">*</span></FormLabel>
                          <FormControl><Input {...field} placeholder="e.g. 12345678901" data-testid="input-gcash-ref" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="orNumber" render={({ field }) => (
                        <FormItem>
                          <FormLabel>OR / Invoice Number <span className="text-muted-foreground text-xs">(optional)</span></FormLabel>
                          <FormControl><Input {...field} placeholder="e.g. INV-0001" data-testid="input-or-gcash" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                  </div>
                )}

                {/* COD */}
                {isCod && (
                  <div className="rounded-lg border p-4 space-y-3 bg-orange-50/50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800">
                    <p className="text-xs font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-wide flex items-center gap-1.5">
                      <Truck className="h-3.5 w-3.5" /> Cash on Delivery
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={form.control} name="amountTendered" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Amount Collected (₱) <span className="text-destructive">*</span></FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" min={0} {...field}
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} data-testid="input-cod-collected" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="driverName" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Collected By (Driver / Rider)</FormLabel>
                          <FormControl><Input {...field} placeholder="Name of the delivery rider" data-testid="input-cod-driver" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="orNumber" render={({ field }) => (
                      <FormItem>
                        <FormLabel>OR / Receipt Number</FormLabel>
                        <FormControl><Input {...field} placeholder="e.g. OR-0012345" data-testid="input-cod-or" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                )}

                {/* BANK */}
                {isBank && (
                  <div className="rounded-lg border p-4 space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5" /> Bank Transfer
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={form.control} name="bankName" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bank Name <span className="text-destructive">*</span></FormLabel>
                          <FormControl><Input {...field} placeholder="e.g. BDO, BPI, Landbank" data-testid="input-bank-name" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="bankReference" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bank Reference / Trace Number <span className="text-destructive">*</span></FormLabel>
                          <FormControl><Input {...field} placeholder="e.g. 202605240001" data-testid="input-bank-ref" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="orNumber" render={({ field }) => (
                      <FormItem>
                        <FormLabel>OR / Invoice Number</FormLabel>
                        <FormControl><Input {...field} placeholder="OR or invoice number" data-testid="input-bank-or" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                )}

                {/* Amount Paid */}
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="amountPaid" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount Paid (₱) <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min={0.01} {...field}
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} data-testid="input-amount-paid" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="flex flex-col justify-end gap-1">
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Hash className="h-3 w-3" /> Transaction Code</p>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/40 h-9">
                      <span className="font-mono text-xs text-muted-foreground">Auto-generated on save</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* ── SECTION 4: PROOF / DOCUMENTATION ─────────────────── */}
            <div>
              <SectionHeader icon={Camera} title="Proof of Payment & Delivery" />
              <div className="grid grid-cols-2 gap-4">
                <UploadBox
                  label={isGcash ? "GCash Screenshot" : "Receipt / Payment Proof"}
                  hint={isGcash ? "Take a photo of the GCash confirmation" : "Photo of cash receipt or OR"}
                  file={receiptFile} preview={receiptPreview} inputRef={receiptRef}
                  onChange={mkFileHandler(setReceiptFile, setReceiptPreview)}
                  onClear={() => { setReceiptFile(null); setReceiptPreview(""); }}
                  required={isGcash}
                />
                <UploadBox
                  label="Proof of Delivery / Pickup"
                  hint="Photo at delivery site, truck unloading, or customer pickup"
                  file={deliveryFile} preview={deliveryPreview} inputRef={deliveryRef}
                  onChange={mkFileHandler(setDeliveryFile, setDeliveryPreview)}
                  onClear={() => { setDeliveryFile(null); setDeliveryPreview(""); }}
                />
              </div>
            </div>

            <Separator />

            {/* ── SECTION 5: LOGISTICS ──────────────────────────────── */}
            <div>
              <SectionHeader icon={Car} title={isDelivery ? "Delivery Logistics" : "Pickup Logistics"} />
              {isDelivery ? (
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="driverName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Driver / Rider Name</FormLabel>
                      <FormControl><Input {...field} placeholder="Name of delivery driver" data-testid="input-driver-name" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="plateNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vehicle Plate Number</FormLabel>
                      <FormControl><Input {...field} placeholder="e.g. ABC 1234" data-testid="input-plate-number" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="paymentDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date & Time of Delivery</FormLabel>
                      <FormControl><Input type="datetime-local" {...field} data-testid="input-delivery-datetime" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="paymentDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date & Time of Pickup</FormLabel>
                      <FormControl><Input type="datetime-local" {...field} data-testid="input-pickup-datetime" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="plateNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer's Vehicle Plate <span className="text-muted-foreground text-xs">(if items loaded to vehicle)</span></FormLabel>
                      <FormControl><Input {...field} placeholder="e.g. ABC 1234 (optional)" data-testid="input-customer-plate" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              )}
            </div>

            <Separator />

            {/* ── SECTION 6: BALANCE & PAYMENT TERMS ───────────────── */}
            <div>
              <SectionHeader icon={Scale} title="Payment Completion & Balance" />
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/20">
                  <div>
                    <p className="text-sm font-medium">Full payment received?</p>
                    <p className="text-xs text-muted-foreground">Toggle off if customer will pay the remaining balance later</p>
                  </div>
                  <FormField control={form.control} name="isFullPayment" render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-full-payment" />
                      </FormControl>
                    </FormItem>
                  )} />
                </div>

                {!isFullPayment && (
                  <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20">
                    <FormField control={form.control} name="remainingBalance" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-amber-700 dark:text-amber-400">Remaining Balance (₱) <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" min={0.01} {...field}
                            onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} data-testid="input-remaining-balance" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="balanceDueDate" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-amber-700 dark:text-amber-400">Agreed Payment Due Date</FormLabel>
                        <FormControl><Input type="date" {...field} data-testid="input-balance-due-date" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* ── SECTION 7: INTERNAL NOTES ────────────────────────── */}
            <div>
              <SectionHeader icon={Clipboard} title="Internal Staff Notes" />
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes / Remarks <span className="text-muted-foreground text-xs">(staff-only, not shown to customer)</span></FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3}
                      placeholder="e.g. Customer requested delivery to 2nd floor. Cement bags stacked properly. Customer had no complaints. Rider waited 15 min..."
                      data-testid="input-payment-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* ── SUMMARY FOOTER ────────────────────────────────────── */}
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total Amount</p>
                <p className="text-xl font-bold">{formatCurrency(order.totalAmount)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Amount Paid</p>
                <p className="text-xl font-bold text-green-600">{formatCurrency(amountPaid)}</p>
              </div>
              {(isCash || isCod) && amountTendered > 0 ? (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Change</p>
                  <p className={`text-xl font-bold ${change > 0 ? "text-green-600" : "text-muted-foreground"}`}>{formatCurrency(change)}</p>
                </div>
              ) : !isFullPayment ? (
                <div>
                  <p className="text-xs text-amber-600 uppercase tracking-wide font-medium">Balance Remaining</p>
                  <p className="text-xl font-bold text-amber-600">{formatCurrency(form.watch("remainingBalance") || 0)}</p>
                </div>
              ) : <div />}
            </div>

            {/* ── ACTIONS ───────────────────────────────────────────── */}
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={isSubmitting} data-testid="button-cancel-payment">
                Cancel
              </Button>
              <Button type="submit" className="flex-2 bg-green-600 hover:bg-green-700 text-white flex-[2]" disabled={isSubmitting} data-testid="button-confirm-payment">
                {isSubmitting
                  ? <><Loader2 className="animate-spin mr-2 h-4 w-4" />{uploading ? "Uploading files..." : "Saving..."}</>
                  : <><ClipboardCheck className="mr-2 h-4 w-4" /> Submit & Mark as Paid</>}
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

  // Auto-scroll to the Release panel when navigated with ?release=1
  // (REQUEST.pdf §18a — "Release Item" button in Pending Payment table
  // routes here and opens the panel automatically).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.location.search.includes("release=1")) return;
    const t = setTimeout(() => {
      const el = document.getElementById("release-panel");
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 350);
    return () => clearTimeout(t);
  }, [orderId]);

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
      if (!res.ok) throw new Error(json?.error || json?.message || "Release failed");
      return json;
    },
    onSuccess: (json: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({
        title: json?.data?.partial ? "Partial release recorded" : "Items released — order completed!",
        description: json?.data?.partial
          ? "Order stays in Active until stock catches up."
          : "Inventory + revenue updated.",
      });
    },
    onError: (err: Error) => toast({ title: "Release failed", description: err.message, variant: "destructive" }),
  });

  // Mark this order as delivered. Admin / Employee only (not Inventory
  // Manager). Once delivered the order leaves Active and moves to History.
  const deliverMutation = useMutation({
    mutationFn: async (note: string) => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/deliver`, { note });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || json?.message || "Delivery confirmation failed");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Marked delivered", description: "Order moved to History." });
    },
    onError: (err: Error) => toast({ title: "Delivery confirmation failed", description: err.message, variant: "destructive" }),
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
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 pb-10">
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
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 pb-10">

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

          {/* Action Required Banner — shows for any unpaid order */}
          {order.paymentStatus !== "paid" && (
            <Card className={`border-2 ${order.startedAt ? "border-green-400 dark:border-green-700 bg-green-50/40 dark:bg-green-950/20" : "border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-950/20"}`}>
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${order.startedAt ? "bg-green-100 dark:bg-green-900" : "bg-amber-100 dark:bg-amber-900"}`}>
                    {order.startedAt
                      ? <ClipboardCheck className="h-5 w-5 text-green-700 dark:text-green-400" />
                      : <CreditCard className="h-5 w-5 text-amber-700 dark:text-amber-400" />}
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${order.startedAt ? "text-green-800 dark:text-green-300" : "text-amber-800 dark:text-amber-300"}`}>
                      {order.startedAt ? "Ready to Log Details & Collect Payment" : "Awaiting Payment Collection"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {order.startedAt
                        ? `Order is being processed by ${order.assignedTo || "staff"}. Fill in the log details form to record payment and complete this order.`
                        : "This order is pending payment. Assign and start processing, or log the payment directly as admin."}
                    </p>
                    {!order.startedAt && (
                      <p className="text-xs font-medium mt-1 text-amber-700 dark:text-amber-400">
                        Balance due: <span className="font-bold">{formatCurrency(order.totalAmount)}</span>
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  onClick={() => setPaymentModalOpen(true)}
                  className={`flex-shrink-0 font-semibold ${order.startedAt ? "bg-green-600 hover:bg-green-700 text-white" : "bg-amber-600 hover:bg-amber-700 text-white"}`}
                  data-testid="button-log-details-banner"
                >
                  <ClipboardCheck className="mr-2 h-4 w-4" />
                  Log Details
                </Button>
              </CardContent>
            </Card>
          )}

          {order.currentStatus === "Pending Release" && (
            <Card id="release-panel" className={cn(window.location.search.includes("release=1") && "ring-2 ring-blue-500/50")}>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Truck className="h-4 w-4" /> Order Release Details
                </CardTitle>
                <CardDescription>Payment confirmed. Review and release items from inventory to complete this order.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* REQUEST.pdf §18b — full detail panel */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  <div className="text-muted-foreground">Order ID</div>
                  <div className="font-mono font-semibold">{order.trackingNumber}</div>
                  <div className="text-muted-foreground">Customer</div>
                  <div className="font-medium">{order.customerName}</div>
                  <div className="text-muted-foreground">Order Type</div>
                  <div>{order.orderType.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}</div>
                  <div className="text-muted-foreground">Date Ordered</div>
                  <div>{formatDate(order.createdAt)}</div>
                  {order.assignedTo && (
                    <>
                      <div className="text-muted-foreground">Assigned Staff</div>
                      <div className="font-medium">{order.assignedTo}</div>
                    </>
                  )}
                </div>

                <div className="border-t pt-3">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Items</div>
                  <div className="space-y-1.5 text-sm">
                    {order.items.map((it: any, i: number) => (
                      <div key={i} className="flex justify-between items-center">
                        <span className="truncate">{it.itemName} × {it.qty}</span>
                        <span className="font-mono tabular-nums text-muted-foreground">₱{(it.discountedUnitPrice || it.originalUnitPrice).toFixed(2)} = <strong className="text-foreground">₱{it.lineTotal.toFixed(2)}</strong></span>
                      </div>
                    ))}
                  </div>
                </div>

                {(() => {
                  const totalPaid = (orderData?.data?.payments || []).reduce((s: number, p: any) => s + (p.amountPaid || 0), 0);
                  const balance = Math.max(0, order.totalAmount - totalPaid);
                  const pct = order.totalAmount > 0 ? (totalPaid / order.totalAmount) * 100 : 0;
                  const isPartial = totalPaid > 0 && totalPaid < order.totalAmount;
                  return (
                    <div className="border-t pt-3">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Payment</div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                        <div className="text-muted-foreground">Total Amount</div>
                        <div className="font-mono tabular-nums">₱{order.totalAmount.toFixed(2)}</div>
                        <div className="text-muted-foreground">Amount Paid</div>
                        <div className="font-mono tabular-nums text-emerald-700">₱{totalPaid.toFixed(2)}</div>
                        <div className="text-muted-foreground">Balance</div>
                        <div className="font-mono tabular-nums text-amber-700">₱{balance.toFixed(2)}</div>
                        <div className="text-muted-foreground">Payment Method</div>
                        <div>{order.paymentMethod}</div>
                        <div className="text-muted-foreground">Payment Status</div>
                        <div>{order.paymentStatus === "paid" ? "Full" : isPartial ? `Partial ≥50% (${pct.toFixed(0)}%)` : order.paymentStatus}</div>
                      </div>
                    </div>
                  );
                })()}

                <div className="border-t pt-3 flex items-center justify-between">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Release Status: </span>
                    <Badge className="bg-amber-500 text-white border-transparent">Pending Release</Badge>
                  </div>
                  <Button
                    onClick={() => releaseMutation.mutate()}
                    disabled={releaseMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    data-testid="button-release-items"
                  >
                    {releaseMutation.isPending && <Loader2 className="animate-spin mr-1 h-4 w-4" />}
                    <Truck className="mr-2 h-4 w-4" /> Release Item
                  </Button>
                </div>
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
                  {order.startedAt && !order.completedProcessingAt && order.paymentStatus !== "paid" && (
                    <Button
                      size="sm"
                      className="w-full bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => setPaymentModalOpen(true)}
                      data-testid="button-complete-processing"
                    >
                      <ClipboardCheck className="h-3 w-3 mr-1" />
                      Log Details
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
                  {/* Admin can also log details / payment directly */}
                  {order.paymentStatus !== "paid" && (
                    <Button
                      size="sm"
                      className="w-full bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => setPaymentModalOpen(true)}
                      data-testid="button-admin-log-payment"
                    >
                      <ClipboardCheck className="h-3 w-3 mr-1" /> Log Details &amp; Payment
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
