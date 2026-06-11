import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation } from "wouter";
import {
  Plus, Search, Loader2, ShoppingCart, Trash2, MapPin, UserCheck, Package,
  AlertCircle, ChevronRight, Sun, Moon, Sunset, Filter, ChevronLeft,
  CheckSquare, Tag, Info, Play, CheckCheck, ArrowRightCircle, Users, X,
} from "lucide-react";
import { speakTTS, formatAmountForTTS } from "@/lib/tts";
import {
  createOrderSchema, type CreateOrderInput, type IOrder, type IItem, type IOrderItem,
  ALLOWED_PAYMENT_METHODS, ALLOWED_ORDER_CHANNELS, ALLOWED_PAYMENT_STATUSES, ALLOWED_FULFILLMENT_STATUSES,
  ORDER_TYPE_LABELS, ORDER_CHANNEL_LABELS,
  PAYMENT_STATUS_LABELS, PAYMENT_METHOD_LABELS, FULFILLMENT_STATUS_LABELS,
  ORDER_TYPES, ORDER_CHANNELS, PAYMENT_STATUSES, PAYMENT_METHODS, FULFILLMENT_STATUSES,
  type OrderType, type PaymentMethod, type OrderChannel, type PaymentStatus, type FulfillmentStatus,
} from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NumberInput } from "@/components/number-input";
import { ReceiptDialog, ReceiptButton } from "@/components/order-receipt";
import { cn } from "@/lib/utils";

type OrderItemLocal = { itemId: string; itemName: string; qty: number; originalUnitPrice: number; discountedUnitPrice: number; discountApplied: boolean; offerName: string; lineTotal: number };

function PoolAdminRow({ order, allUsers, onAssignClick, onNavigate }: {
  order: IOrder; allUsers: SimpleUser[]; onAssignClick: (username: string) => void; onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [empSearch, setEmpSearch] = useState("");
  const visibleUsers = allUsers.filter((u) => u.username.toLowerCase().includes(empSearch.toLowerCase()));
  return (
    <TableRow data-testid={`row-pool-admin-${order._id}`}>
      <TableCell className="font-mono text-sm font-semibold cursor-pointer" onClick={onNavigate}>{order.trackingNumber}</TableCell>
      <TableCell className="cursor-pointer" onClick={onNavigate}>{order.customerName}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{ORDER_TYPE_LABELS[order.orderType] || order.orderType}</TableCell>
      <TableCell className="text-right cursor-pointer" onClick={onNavigate}>{formatCurrency(order.totalAmount)}</TableCell>
      <TableCell className="text-muted-foreground text-sm">{formatDate(order.createdAt)}</TableCell>
      <TableCell onClick={(e) => e.stopPropagation()} className="py-1.5">
        {/* Floating dropdown via Popover so it never gets clipped by the
            table overflow-x-auto (used to render with absolute right-0 and
            get cut on small viewports — see REQUEST.pdf round-5 screenshot). */}
        <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEmpSearch(""); }}>
          <PopoverTrigger asChild>
            <button
              className="flex items-center gap-1.5 pl-2 pr-3 py-1.5 rounded-full border border-dashed border-border hover:border-primary hover:bg-primary/5 transition-all text-xs font-medium text-muted-foreground hover:text-foreground group"
              data-testid={`button-pool-assign-${order._id}`}
            >
              <UserCheck className="h-3.5 w-3.5 group-hover:text-primary transition-colors shrink-0" />
              <span>Assign to…</span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className="w-[260px] p-0 border-border bg-popover shadow-xl"
          >
            <div className="px-3 py-2 border-b">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Assign to staff</p>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  autoFocus
                  placeholder="Search staff..."
                  className="pl-8 h-8 text-xs"
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  data-testid={`input-assign-search-${order._id}`}
                />
              </div>
            </div>
            <div className="max-h-[260px] overflow-y-auto py-1">
              {visibleUsers.length === 0 ? (
                <p className="text-xs text-muted-foreground px-3 py-2 text-center">{allUsers.length === 0 ? "No staff available" : "No match"}</p>
              ) : visibleUsers.map((u) => {
                const initials = u.username.slice(0, 2).toUpperCase();
                const colors = ["bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-purple-500", "bg-rose-500", "bg-cyan-500"];
                const color = colors[u.username.charCodeAt(0) % colors.length];
                return (
                  <button
                    key={u.username}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-accent text-sm transition-colors text-left"
                    onClick={() => { onAssignClick(u.username); setOpen(false); }}
                    data-testid={`assign-to-${u.username}-${order._id}`}
                  >
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[10px] font-bold shrink-0 ${color}`}>
                      {initials}
                    </span>
                    <span className="font-medium truncate">{u.username}</span>
                    {u.role === "ADMIN" && (
                      <span className="ml-auto text-[9px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">Admin</span>
                    )}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </TableCell>
    </TableRow>
  );
}

/**
 * Confirmation dialog shown when admin attempts to assign an order to a user.
 * Displays the user's currently pending tasks (5 per page, index pagination)
 * so the admin can make an informed decision about workload distribution.
 */
function AssignConfirmDialog({ open, onClose, targetUsername, orderTrackingNumber, allOrders, onConfirm, isPending }: {
  open: boolean;
  onClose: () => void;
  targetUsername: string;
  orderTrackingNumber: string;
  allOrders: IOrder[];
  onConfirm: () => void;
  isPending: boolean;
}) {
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 5;
  const pendingTasks = allOrders.filter((o) =>
    o.assignedTo === targetUsername &&
    !o.completedProcessingAt &&
    o.fulfillmentStatus !== "completed" &&
    o.fulfillmentStatus !== "cancelled" &&
    o.fulfillmentStatus !== "ready"
  );
  const totalPages = Math.ceil(pendingTasks.length / PAGE_SIZE);
  const pagedTasks = pendingTasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setPage(1); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-primary" />Confirm Assignment
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to assign order <span className="font-mono font-semibold">{orderTrackingNumber}</span> to <strong>{targetUsername}</strong>?
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Current pending tasks ({pendingTasks.length})</span>
            {pendingTasks.length === 0 && <Badge variant="outline" className="text-xs">No active tasks</Badge>}
          </div>
          {pendingTasks.length > 0 && (
            <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
              {pagedTasks.map((o) => (
                <div key={o._id} className="text-xs p-2 rounded-md bg-muted/40 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-semibold flex-shrink-0">{o.trackingNumber}</span>
                    <span className="text-muted-foreground truncate">· {o.customerName}</span>
                  </div>
                  <FulfillmentBadge status={o.fulfillmentStatus} />
                </div>
              ))}
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex justify-center gap-1">
              {Array.from({ length: totalPages }).map((_, i) => (
                <Button
                  key={i}
                  size="sm"
                  variant={page === i + 1 ? "default" : "outline"}
                  className="h-7 w-7 p-0 text-xs"
                  onClick={() => setPage(i + 1)}
                  data-testid={`page-${i + 1}`}
                >
                  {i + 1}
                </Button>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onConfirm} disabled={isPending} data-testid="button-confirm-assign">
            {isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FulfillmentBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-slate-400 text-white border-transparent",
    processing: "bg-blue-400 text-white border-transparent",
    ready: "bg-amber-500 text-white border-transparent",
    out_for_delivery: "bg-purple-500 text-white border-transparent",
    completed: "bg-green-600 text-white border-transparent",
    cancelled: "bg-red-500 text-white border-transparent",
  };
  return <Badge className={`text-xs ${map[status] || "bg-gray-400 text-white border-transparent"}`}>{FULFILLMENT_STATUS_LABELS[status as keyof typeof FULFILLMENT_STATUS_LABELS] || status}</Badge>;
}

function PaymentBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending_payment: "bg-yellow-500 text-white border-transparent",
    partial: "bg-orange-400 text-white border-transparent",
    paid: "bg-green-500 text-white border-transparent",
    reservation_only: "bg-purple-500 text-white border-transparent",
  };
  return <Badge className={`text-xs ${map[status] || "bg-gray-400 text-white border-transparent"}`}>{PAYMENT_STATUS_LABELS[status as keyof typeof PAYMENT_STATUS_LABELS] || status}</Badge>;
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
  return <Badge className={colorMap[status] || "bg-gray-400 text-white border-transparent"}>{status}</Badge>;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return { text: "Good morning", Icon: Sun };
  if (hour < 18) return { text: "Good afternoon", Icon: Sunset };
  return { text: "Good evening", Icon: Moon };
}

function fmt12(d: string | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v);
}
function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

interface SimpleUser { username: string; role: string; }

const STEP_LABELS = ["Customer & Type", "Items", "Payment", "Fulfillment", "Review"];

// ─── Duplicate Order Alert ────────────────────────────────────────────────────
function DuplicateOrderAlert({ duplicate, onDismiss, onSeeOrder }: {
  duplicate: IOrder | null;
  onDismiss: () => void;
  onSeeOrder: (id: string) => void;
}) {
  if (!duplicate) return null;
  return (
    <div className="flex items-start gap-3 p-3 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-sm text-amber-900 dark:text-amber-200">
      <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-500" />
      <div className="flex-1 space-y-1">
        <p className="font-medium">Possible duplicate order detected</p>
        <p className="text-xs">An existing order <strong>{duplicate.trackingNumber}</strong> for <strong>{duplicate.customerName}</strong> has similar items.</p>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <Button size="sm" variant="outline" className="h-7 text-xs border-amber-400 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900" onClick={() => onSeeOrder(duplicate._id)}>See Order</Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-amber-600" onClick={onDismiss}><X className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

function CreateOrderDialog({ open, onClose, allItems }: { open: boolean; onClose: () => void; allItems: IItem[] }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [orderItems, setOrderItems] = useState<OrderItemLocal[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [itemQty, setItemQty] = useState(1);
  const [showAddress, setShowAddress] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [duplicate, setDuplicate] = useState<IOrder | null>(null);
  // The freshly-created order, captured from the POST response so we can pop a
  // receipt the instant the order is logged.
  const [receiptOrder, setReceiptOrder] = useState<IOrder | null>(null);

  const form = useForm<CreateOrderInput>({
    resolver: zodResolver(createOrderSchema),
    defaultValues: {
      customerId: "",
      customerName: "",
      orderType: "walkin_pickup",
      orderChannel: "walkin",
      paymentStatus: "paid",
      paymentMethod: "cash",
      fulfillmentStatus: "pending",
      deliveryFee: 0,
      items: [],
      notes: "",
      scheduledDate: "",
    },
  });

  const orderType = form.watch("orderType") as OrderType;
  const orderChannel = form.watch("orderChannel") as OrderChannel;
  const allowedMethods = ALLOWED_PAYMENT_METHODS[orderType] || [];
  const allowedChannels = ALLOWED_ORDER_CHANNELS[orderType] || [];
  const allowedFulfillment = ALLOWED_FULFILLMENT_STATUSES[orderType] || [];
  const isReservation = orderType.includes("reservation");
  // Walk-in orders (non-reservation) are paid at the counter — only Paid or Partial allowed.
  const allowedPaymentStatuses = (() => {
    const base = ALLOWED_PAYMENT_STATUSES[orderType] || [];
    if (orderChannel === "walkin" && !isReservation) return base.filter((s) => s === "paid" || s === "partial");
    return base;
  })();

  const createMutation = useMutation({
    mutationFn: async (data: CreateOrderInput) => {
      const res = await apiRequest("POST", "/api/orders", data);
      return res.json();
    },
    onSuccess: async (resp: any) => {
      // Hard refetch (not just invalidate) so the new order shows up in the
      // pool table immediately. The 1-second global polling would also catch
      // it, but waiting up to a full second after pressing "Create" felt
      // broken to the user.
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["/api/orders"], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["/api/orders?pool=true"], type: "active" }),
      ]);
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders?pool=true"] });
      const data = form.getValues();
      const itemsList = orderItems.map((i) => `${i.qty} ${i.itemName}`).join(", ");
      const total = orderItems.reduce((s, i) => s + i.lineTotal, 0) + (Number(data.deliveryFee) || 0);
      const typeLabel = ORDER_TYPE_LABELS[data.orderType] || data.orderType;
      speakTTS(
        `New ${typeLabel} order has been created for ${data.customerName}. ` +
        `Items ordered: ${itemsList}. ` +
        `Total amount: ${formatAmountForTTS(total)} pesos. ` +
        `Payment method: ${PAYMENT_METHOD_LABELS[data.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] || data.paymentMethod}.`
      );
      onClose();
      form.reset();
      setOrderItems([]);
      setStep(0);
      setDuplicate(null);
      setPartialAck(new Set());
      toast({ title: "Order created successfully" });
      // Pop the receipt automatically the moment the order is done.
      const created = resp?.data?.order as IOrder | undefined;
      if (created) setReceiptOrder(created);
    },
    onError: (err: Error) => toast({ title: "Failed to create order", description: err.message, variant: "destructive" }),
  });

  // Check duplicate when moving from step 1 → step 2
  async function checkDuplicate(): Promise<boolean> {
    const customerName = form.getValues("customerName");
    if (!customerName || orderItems.length === 0) return false;
    try {
      const res = await apiRequest("POST", "/api/orders/check-duplicate", {
        customerName,
        itemIds: orderItems.map((i) => i.itemId),
      });
      const json = await res.json();
      if (json?.data?.duplicate) {
        setDuplicate(json.data.order);
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }

  function addItem() {
    const item = allItems.find((i) => i._id === selectedItemId);
    if (!item || itemQty < 1) return;
    if (itemQty > item.currentQuantity) {
      toast({ title: "Insufficient stock", description: `Only ${item.currentQuantity} available`, variant: "destructive" });
      return;
    }
    const exists = orderItems.find((oi) => oi.itemId === item._id);
    if (exists) {
      setOrderItems((prev) => prev.map((oi) => oi.itemId === item._id ? { ...oi, qty: oi.qty + itemQty, lineTotal: (oi.qty + itemQty) * oi.discountedUnitPrice } : oi));
    } else {
      setOrderItems((prev) => [...prev, { itemId: item._id, itemName: item.itemName, qty: itemQty, originalUnitPrice: item.unitPrice, discountedUnitPrice: item.unitPrice, discountApplied: false, offerName: "", lineTotal: itemQty * item.unitPrice }]);
    }
    setSelectedItemId("");
    setItemQty(1);
    setItemSearch("");
  }

  function removeItem(itemId: string) {
    setOrderItems((prev) => prev.filter((oi) => oi.itemId !== itemId));
  }

  const subtotal = orderItems.reduce((s, i) => s + i.lineTotal, 0);
  const deliveryFee = Number(form.watch("deliveryFee")) || 0;
  const estimatedTotal = subtotal + deliveryFee;

  // Whether the user has entered enough to advance to the next step. The "Next"
  // button is disabled until the current step's required data is present.
  const watchedCustomerName = form.watch("customerName");
  const watchedPaymentMethod = form.watch("paymentMethod");
  const watchedPaymentStatus = form.watch("paymentStatus");
  const watchedFulfillment = form.watch("fulfillmentStatus");
  // The Next button is enabled as long as the user has selected the order
  // type + channel (defaults already valid) — the customer-name field gets
  // validated inline via form.trigger when they click Next. Previously the
  // button stayed dead until they typed a name, which made "next button
  // cannot be click" the most common complaint when picking a new type.
  const canProceed = (() => {
    if (step === 0) return !!orderType && !!orderChannel;
    if (step === 1) return orderItems.length > 0;
    if (step === 2) return !!watchedPaymentMethod && !!watchedPaymentStatus;
    if (step === 3) return !!watchedFulfillment;
    return true;
  })();

  // True when the user has started filling the form — used to confirm before
  // closing so a half-typed order isn't lost.
  const hasUnsavedData =
    !!watchedCustomerName?.trim() || orderItems.length > 0 || !!form.watch("notes")?.trim();

  function requestClose() {
    if (hasUnsavedData) {
      if (!window.confirm("You have unsaved order details. Are you sure you want to close? Your changes will be lost.")) return;
    }
    onClose();
    setStep(0);
    setOrderItems([]);
    form.reset();
    setDuplicate(null);
    setPartialAck(new Set());
  }

  // Overflow / duplicate / approval state machine for the Items → Next step.
  const [overflow, setOverflow] = useState<{ itemId: string; itemName: string; want: number; have: number } | null>(null);
  const [duplicateInfo, setDuplicateInfo] = useState<any | null>(null);
  const [waitingApproval, setWaitingApproval] = useState<{ requestId: string; startedAt: number } | null>(null);
  // Items whose over-stock quantity the user has already accepted as a partial
  // release. Without this the overflow dialog re-fires on every "Next" click,
  // so the order can never advance past the Items step (the partial-release bug).
  const [partialAck, setPartialAck] = useState<Set<string>>(() => new Set());

  // Shared "advance past the Items step" logic. Runs the over-stock check
  // (skipping items already acknowledged for partial release), then the
  // duplicate check, then moves to Payment. Reused by both the Next button and
  // the Partial Release confirmation so accepting a partial release continues
  // the wizard instead of looping back to the same dialog.
  async function proceedFromItems(ack: Set<string>) {
    for (const oi of orderItems) {
      const stockItem = allItems.find((i) => i._id === oi.itemId);
      const stock = stockItem?.currentQuantity ?? 0;
      if (oi.qty > stock && !ack.has(oi.itemId)) {
        setOverflow({ itemId: oi.itemId, itemName: oi.itemName, want: oi.qty, have: stock });
        return; // block until the user picks an option for this item
      }
    }
    // Duplicate check (REQUEST.pdf §9-10): same customer + overlapping item
    try {
      const res = await apiRequest("POST", "/api/orders/check-duplicate", {
        customerName: form.getValues("customerName"),
        itemIds: orderItems.map((i) => i.itemId),
      });
      const json = await res.json();
      if (json?.data?.duplicate && !json?.data?.approvedGrantId) {
        setDuplicateInfo(json.data.duplicate);
        return; // dialog handles next move
      }
    } catch { /* network blip — allow through */ }
    setStep(2);
  }

  async function handleNext() {
    if (step === 0) {
      const fields = ["customerName", "orderType", "orderChannel"] as const;
      form.trigger(fields).then((ok) => { if (ok) setStep(1); });
    } else if (step === 1) {
      if (orderItems.length === 0) { toast({ title: "Add at least one item", variant: "destructive" }); return; }
      await proceedFromItems(partialAck);
    } else if (step === 2) {
      const fields = ["paymentMethod", "paymentStatus"] as const;
      form.trigger(fields).then((ok) => { if (ok) setStep(3); });
    } else if (step === 3) {
      setStep(4);
    }
  }

  // Poll for duplicate-order approval grant; once approved → flash success
  // and advance the wizard to Payment step. (Round 7 spec §10.)
  useQuery<{ success: boolean; data: { requests: any[] } }>({
    queryKey: ["/api/item-requests", "duplicate-watch", waitingApproval?.requestId || ""],
    queryFn: () => apiRequest("GET", `/api/item-requests?status=approved`).then((r) => r.json()),
    enabled: !!waitingApproval,
    refetchInterval: 3_000,
    refetchIntervalInBackground: true,
    structuralSharing: false,
    select: (d) => {
      // Side-effect on every poll
      const grant = (d?.data?.requests || []).find((r: any) => r._id === waitingApproval?.requestId);
      if (grant && grant.status === "approved") {
        setWaitingApproval(null);
        toast({ title: "An admin approved your order — proceeding to payment." });
        setStep(2);
      }
      return d;
    },
  });

  function handleBack() {
    if (step > 0) setStep(step - 1);
  }

  function handleSubmit() {
    const data = form.getValues();
    const addr = data.address;
    const hasAddress = addr && (addr.street || addr.unitNumber || addr.city || addr.province || addr.zipCode);
    createMutation.mutate({ ...data, items: orderItems, address: hasAddress ? addr : undefined });
  }

  const filteredItems = allItems.filter((it) =>
    !orderItems.find((oi) => oi.itemId === it._id) &&
    (itemSearch === "" || it.itemName.toLowerCase().includes(itemSearch.toLowerCase()))
  );

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!v) requestClose(); }}>
      <DialogContent className="fixed inset-0 max-w-none !w-screen !h-screen !translate-x-0 !translate-y-0 !left-0 !top-0 !rounded-none m-0 flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader className="flex-shrink-0 px-6 py-4 border-b bg-background">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5" />Create New Order</DialogTitle>
              <DialogDescription>Step {step + 1} of 5 — {STEP_LABELS[step]}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">

        {/* Duplicate warning */}
        {duplicate && (
          <div className="mb-4">
            <DuplicateOrderAlert
              duplicate={duplicate}
              onDismiss={() => setDuplicate(null)}
              onSeeOrder={(id) => { onClose(); navigate(`/orders/${id}`); }}
            />
          </div>
        )}

        {/* Progress bar */}
        <div className="flex gap-1 mb-4">
          {STEP_LABELS.map((label, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className={`h-1.5 w-full rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`} />
              <span className={`text-[10px] hidden sm:block ${i === step ? "text-primary font-medium" : "text-muted-foreground"}`}>{label}</span>
            </div>
          ))}
        </div>

        <Form {...form}>
          <form className="space-y-4 mt-2">
            {/* Step 0: Customer & Order Type */}
            {step === 0 && (
              <div className="space-y-4">
                <FormField control={form.control} name="customerName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Customer Name *</FormLabel>
                    <FormControl><Input placeholder="e.g. Juan dela Cruz" {...field} data-testid="input-customer-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="orderType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Order Type *</FormLabel>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {ORDER_TYPES.map((type) => (
                        <button key={type} type="button"
                          className={`p-3 rounded-lg border text-sm text-left transition-colors ${field.value === type ? "border-primary bg-primary/5 font-medium" : "border-border hover:border-primary/50"}`}
                          onClick={() => {
                            field.onChange(type);
                            // Reset payment method to a valid one for this type
                            const allowedM = ALLOWED_PAYMENT_METHODS[type];
                            const curM = form.getValues("paymentMethod") as PaymentMethod;
                            if (!allowedM.includes(curM)) form.setValue("paymentMethod", allowedM[0]);
                            // Reset order channel to a valid one for this type
                            const allowedC = ALLOWED_ORDER_CHANNELS[type];
                            const curC = form.getValues("orderChannel") as OrderChannel;
                            const nextC = allowedC.includes(curC) ? curC : allowedC[0];
                            if (nextC !== curC) form.setValue("orderChannel", nextC);
                            // Reset payment status — walk-in only allows paid or partial
                            const resv = type.includes("reservation");
                            let allowedS = ALLOWED_PAYMENT_STATUSES[type];
                            if (nextC === "walkin" && !resv) allowedS = allowedS.filter((s) => s === "paid" || s === "partial");
                            const curS = form.getValues("paymentStatus") as PaymentStatus;
                            if (!allowedS.includes(curS)) form.setValue("paymentStatus", allowedS[0]);
                            // Reset fulfillment status
                            const allowedF = ALLOWED_FULFILLMENT_STATUSES[type];
                            const curF = form.getValues("fulfillmentStatus") as FulfillmentStatus;
                            if (!allowedF.includes(curF)) form.setValue("fulfillmentStatus", allowedF[0]);
                            const needsAddress = type.includes("delivery");
                            setShowAddress(needsAddress);
                          }}
                          data-testid={`option-order-type-${type}`}>
                          {ORDER_TYPE_LABELS[type]}
                        </button>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="orderChannel" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Order Channel *</FormLabel>
                    <Select
                      onValueChange={(val) => {
                        field.onChange(val);
                        // Walk-in channel: only paid or partial allowed
                        let allowedS = ALLOWED_PAYMENT_STATUSES[orderType];
                        if (val === "walkin" && !isReservation) allowedS = allowedS.filter((s) => s === "paid" || s === "partial");
                        const curS = form.getValues("paymentStatus") as PaymentStatus;
                        if (!allowedS.includes(curS)) form.setValue("paymentStatus", allowedS[0]);
                      }}
                      value={field.value}
                      disabled={allowedChannels.length <= 1}
                    >
                      <FormControl><SelectTrigger data-testid="select-order-channel"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {allowedChannels.map((ch) => <SelectItem key={ch} value={ch}>{ORDER_CHANNEL_LABELS[ch]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {allowedChannels.length <= 1 && (
                      <p className="text-xs text-muted-foreground mt-1">Walk-in orders are always logged as in-store.</p>
                    )}
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            )}

            {/* Step 1: Items */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Search items..." value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} data-testid="input-order-item-search" />
                  {itemSearch && filteredItems.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-50 bg-popover border rounded-md shadow-lg max-h-72 overflow-y-auto mt-1">
                      {filteredItems.slice(0, 12).map((it) => {
                        const outOfStock = it.currentQuantity <= 0;
                        const insufficient = !outOfStock && itemQty > it.currentQuantity;

                        // Fire a notification to admins + inventory managers
                        // asking them to restock this item.
                        const requestRestock = async () => {
                          try {
                            await apiRequest("POST", "/api/inventory/notify-restock", {
                              itemId: it._id,
                              itemName: it.itemName,
                              needed: itemQty,
                              currentStock: it.currentQuantity,
                            });
                            toast({ title: "Restock requested", description: `Admin / IM notified about ${it.itemName}.` });
                          } catch (e: any) {
                            toast({ title: "Could not notify", description: e.message, variant: "destructive" });
                          }
                        };

                        const addQty = (qty: number) => {
                          const exists = orderItems.find((oi) => oi.itemId === it._id);
                          if (exists) {
                            setOrderItems((prev) => prev.map((oi) => oi.itemId === it._id ? { ...oi, qty: oi.qty + qty, lineTotal: (oi.qty + qty) * oi.discountedUnitPrice } : oi));
                          } else {
                            setOrderItems((prev) => [...prev, { itemId: it._id, itemName: it.itemName, qty, originalUnitPrice: it.unitPrice, discountedUnitPrice: it.unitPrice, discountApplied: false, offerName: "", lineTotal: qty * it.unitPrice }]);
                          }
                          setSelectedItemId("");
                          setItemSearch("");
                          setItemQty(1);
                        };

                        if (outOfStock) {
                          return (
                            <div key={it._id} className="px-3 py-2 border-b last:border-b-0 bg-red-50/40 dark:bg-red-950/20 cursor-not-allowed" data-testid={`option-order-item-${it._id}`}>
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <p className="text-sm font-medium opacity-70">{it.itemName}</p>
                                  <p className="text-[11px] text-red-600 dark:text-red-400">Out of stock — cannot be added</p>
                                </div>
                                <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={(e) => { e.stopPropagation(); requestRestock(); }} data-testid={`button-notify-restock-${it._id}`}>
                                  Notify Admin / IM
                                </Button>
                              </div>
                            </div>
                          );
                        }

                        if (insufficient) {
                          return (
                            <div key={it._id} className="px-3 py-2 border-b last:border-b-0 bg-amber-50/50 dark:bg-amber-950/30" data-testid={`option-order-item-${it._id}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <button type="button" className="text-sm font-medium hover:underline text-left" onClick={() => addQty(Math.min(itemQty, it.currentQuantity))}>
                                    {it.itemName}
                                  </button>
                                  <p className="text-[11px] text-amber-700 dark:text-amber-300">Only {it.currentQuantity} available (need {itemQty}) — partial release possible</p>
                                </div>
                                <div className="flex gap-1 shrink-0">
                                  <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={(e) => { e.stopPropagation(); requestRestock(); }} data-testid={`button-notify-restock-${it._id}`}>
                                    Notify Admin
                                  </Button>
                                  <Button type="button" size="sm" className="h-7 text-[11px]" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Partial release? Reserve ${itemQty} on the order (only ${it.currentQuantity} releasable now — the rest waits for restock).`)) { addQty(itemQty); requestRestock(); } }} data-testid={`button-partial-${it._id}`}>
                                    Partial Release
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <button key={it._id} type="button" className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent text-left" onClick={() => addQty(itemQty)} data-testid={`option-order-item-${it._id}`}>
                            <span>{it.itemName}</span>
                            <span className="text-muted-foreground text-xs">{formatCurrency(it.unitPrice)} · {it.currentQuantity} avail</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {orderItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm border-2 border-dashed rounded-lg">Search and add items above</div>
                ) : (
                  <div className="space-y-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-center w-24">Current Stock</TableHead>
                          <TableHead className="text-center w-[140px]">Qty</TableHead>
                          <TableHead className="text-right">Unit Price</TableHead>
                          <TableHead className="text-right">Subtotal</TableHead>
                          <TableHead className="w-8" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orderItems.map((oi) => {
                          const stockItem = allItems.find((i) => i._id === oi.itemId);
                          const stock = stockItem?.currentQuantity ?? 0;
                          const willPartial = oi.qty > stock;
                          return (
                            <TableRow key={oi.itemId} className={willPartial ? "bg-amber-50/40 dark:bg-amber-950/20" : undefined}>
                              <TableCell className="text-sm">
                                <div className="font-medium">{oi.itemName}</div>
                                {willPartial && (
                                  <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                                    Will partial release — {stock} now, {oi.qty - stock} backorder
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                <span className={cn("text-sm tabular-nums font-mono", stock <= 0 ? "text-red-600 font-semibold" : stock < oi.qty ? "text-amber-700 font-semibold" : "text-muted-foreground")}>{stock}</span>
                              </TableCell>
                              <TableCell className="text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button type="button"
                                    className="h-7 w-7 rounded border flex items-center justify-center hover:bg-accent text-base font-bold leading-none"
                                    onClick={() => {
                                      const newQty = Math.max(1, oi.qty - 1);
                                      setOrderItems((prev) => prev.map((item) => item.itemId === oi.itemId ? { ...item, qty: newQty, lineTotal: newQty * item.discountedUnitPrice } : item));
                                    }}>−</button>
                                  {/* Typeable qty (REQUEST.pdf round 7 section 3a) */}
                                  <NumberInput
                                    allowDecimal={false}
                                    min={1}
                                    value={oi.qty}
                                    placeholder="0"
                                    className="h-7 w-14 text-center text-sm font-medium tabular-nums px-1"
                                    onChange={(n) => {
                                      const newQty = Math.max(1, n);
                                      setOrderItems((prev) => prev.map((item) => item.itemId === oi.itemId ? { ...item, qty: newQty, lineTotal: newQty * item.discountedUnitPrice } : item));
                                    }}
                                  />
                                  <button type="button"
                                    className="h-7 w-7 rounded border flex items-center justify-center hover:bg-accent text-base font-bold leading-none"
                                    onClick={() => {
                                      // Soft cap at stock; the overflow dialog at Next handles >stock
                                      const newQty = oi.qty + 1;
                                      setOrderItems((prev) => prev.map((item) => item.itemId === oi.itemId ? { ...item, qty: newQty, lineTotal: newQty * item.discountedUnitPrice } : item));
                                    }}>+</button>
                                </div>
                              </TableCell>
                              <TableCell className="text-right text-sm">{formatCurrency(oi.originalUnitPrice)}</TableCell>
                              <TableCell className="text-right text-sm font-medium">{formatCurrency(oi.lineTotal)}</TableCell>
                              <TableCell>
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeItem(oi.itemId)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    <div className="flex justify-end text-sm font-medium pr-11">
                      Subtotal: <span className="ml-2">{formatCurrency(subtotal)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Payment */}
            {step === 2 && (
              <div className="space-y-4">
                <FormField control={form.control} name="paymentMethod" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Method *</FormLabel>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {allowedMethods.map((method) => (
                        <button key={method} type="button"
                          className={`p-3 rounded-lg border text-sm transition-colors ${field.value === method ? "border-primary bg-primary/5 font-medium" : "border-border hover:border-primary/50"}`}
                          onClick={() => field.onChange(method)}
                          data-testid={`option-payment-method-${method}`}>
                          {PAYMENT_METHOD_LABELS[method]}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Allowed for {ORDER_TYPE_LABELS[orderType]}</p>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="paymentStatus" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Status *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={allowedPaymentStatuses.length <= 1}>
                      <FormControl><SelectTrigger data-testid="select-payment-status"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {allowedPaymentStatuses.map((s) => <SelectItem key={s} value={s}>{PAYMENT_STATUS_LABELS[s]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {orderChannel === "walkin" && !isReservation && (
                      <p className="text-xs text-muted-foreground mt-1">Walk-in orders are paid at the counter.</p>
                    )}
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            )}

            {/* Step 3: Fulfillment */}
            {step === 3 && (
              <div className="space-y-4">
                <FormField control={form.control} name="fulfillmentStatus" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fulfillment Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={allowedFulfillment.length <= 1}>
                      <FormControl><SelectTrigger data-testid="select-fulfillment-status"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {allowedFulfillment.map((s) => <SelectItem key={s} value={s}>{FULFILLMENT_STATUS_LABELS[s]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="deliveryFee" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Delivery Fee (₱)</FormLabel>
                    <FormControl><Input type="number" min={0} {...field} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} data-testid="input-delivery-fee" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="scheduledDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scheduled Date (optional)</FormLabel>
                    <FormControl><Input type="date" {...field} data-testid="input-scheduled-date" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Checkbox id="toggle-address" checked={showAddress} onCheckedChange={(v) => setShowAddress(!!v)} data-testid="checkbox-toggle-address" />
                    <label htmlFor="toggle-address" className="flex items-center gap-1.5 text-sm font-medium cursor-pointer"><MapPin className="h-4 w-4" />Add Delivery Address</label>
                  </div>
                  {showAddress && (
                    <div className="space-y-3 pl-4 border-l-2">
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={form.control} name="address.street" render={({ field }) => (
                          <FormItem><FormLabel>Street Name</FormLabel><FormControl><Input placeholder="Street" {...field} data-testid="input-address-street" /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="address.unitNumber" render={({ field }) => (
                          <FormItem><FormLabel>Unit/Building #</FormLabel><FormControl><Input placeholder="Unit #" {...field} data-testid="input-address-unit" /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <FormField control={form.control} name="address.city" render={({ field }) => (
                          <FormItem><FormLabel>City</FormLabel><FormControl><Input placeholder="City" {...field} data-testid="input-address-city" /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="address.province" render={({ field }) => (
                          <FormItem><FormLabel>Province</FormLabel><FormControl><Input placeholder="Province" {...field} data-testid="input-address-province" /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="address.zipCode" render={({ field }) => (
                          <FormItem><FormLabel>ZIP Code</FormLabel><FormControl><Input placeholder="ZIP" {...field} data-testid="input-address-zip" /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                    </div>
                  )}
                </div>
                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (optional)</FormLabel>
                    <FormControl><Textarea {...field} rows={2} data-testid="input-order-notes" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            )}

            {/* Step 4: Review */}
            {step === 4 && (
              <div className="space-y-4">
                <div className="bg-muted/40 rounded-xl p-4 space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="text-muted-foreground">Customer:</span> <span className="font-medium ml-1">{form.getValues("customerName")}</span></div>
                    <div><span className="text-muted-foreground">Order Type:</span> <span className="font-medium ml-1">{ORDER_TYPE_LABELS[form.getValues("orderType")]}</span></div>
                    <div><span className="text-muted-foreground">Channel:</span> <span className="font-medium ml-1">{ORDER_CHANNEL_LABELS[form.getValues("orderChannel")]}</span></div>
                    <div><span className="text-muted-foreground">Payment:</span> <span className="font-medium ml-1">{PAYMENT_METHOD_LABELS[form.getValues("paymentMethod")]}</span></div>
                    <div><span className="text-muted-foreground">Payment Status:</span> <span className="font-medium ml-1">{PAYMENT_STATUS_LABELS[form.getValues("paymentStatus")]}</span></div>
                    <div><span className="text-muted-foreground">Fulfillment:</span> <span className="font-medium ml-1">{FULFILLMENT_STATUS_LABELS[form.getValues("fulfillmentStatus")]}</span></div>
                  </div>
                  <Separator />
                  <div className="space-y-1">
                    {orderItems.map((oi) => (
                      <div key={oi.itemId} className="flex justify-between">
                        <span>{oi.itemName} ×{oi.qty}</span>
                        <span className="font-medium">{formatCurrency(oi.lineTotal)}</span>
                      </div>
                    ))}
                  </div>
                  <Separator />
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal:</span><span>{formatCurrency(subtotal)}</span>
                  </div>
                  {deliveryFee > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Delivery Fee:</span><span>{formatCurrency(deliveryFee)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-base">
                    <span>Estimated Total:</span><span>{formatCurrency(estimatedTotal)}</span>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/20 rounded-lg p-3">
                  <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>Active offers will be automatically applied if available. Final total may differ after offer application.</span>
                </div>
              </div>
            )}
          </form>
        </Form>
        </div>

        <div className="flex-shrink-0 px-6 py-3 border-t bg-background">
          <div className="flex gap-2 flex-wrap justify-end">
            {step > 0 && <Button type="button" variant="outline" onClick={handleBack} data-testid="button-order-back"><ChevronLeft className="h-4 w-4 mr-1" />Back</Button>}
            {step < 4 ? (
              <Button type="button" onClick={handleNext} disabled={!canProceed} data-testid="button-order-next">
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button type="button" onClick={handleSubmit} disabled={createMutation.isPending} data-testid="button-submit-order">
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <ShoppingCart className="h-4 w-4 mr-2" />Create Order
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* ── Overflow dialog (qty > current stock) ──────────────────────────
        Round 7 §3b: Partial Release / Notify Admin / Cancel This Order. */}
    <Dialog open={!!overflow} onOpenChange={(o) => !o && setOverflow(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertCircle className="h-5 w-5" /> Order Exceeds Available Stock
          </DialogTitle>
          <DialogDescription className="text-foreground/80 pt-2 leading-relaxed">
            The requested quantity (<strong>{overflow?.want}</strong>) for{" "}
            <strong>"{overflow?.itemName}"</strong> exceeds the current stock of{" "}
            <strong>{overflow?.have}</strong> units.
            <br /><br />What would you like to do?
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="destructive"
            onClick={() => {
              // Cancel this order — close the whole create-order dialog
              setOverflow(null);
              requestClose();
            }}
            data-testid="overflow-cancel"
          >Cancel This Order</Button>
          <Button
            variant="outline"
            onClick={async () => {
              if (!overflow) return;
              try {
                await apiRequest("POST", "/api/inventory/notify-restock", {
                  itemId: overflow.itemId, itemName: overflow.itemName,
                  needed: overflow.want, currentStock: overflow.have,
                  customerName: form.getValues("customerName"),
                });
                toast({ title: "Admin & inventory manager notified" });
              } catch (e: any) {
                toast({ title: "Notify failed", description: e.message, variant: "destructive" });
              }
            }}
            data-testid="overflow-notify"
          >Notify Admin</Button>
          <Button
            onClick={() => {
              // Partial release — keep the line at the requested qty so the
              // server's release flow can release what's available now and
              // leave the rest as pending. Acknowledge this item so the
              // overflow check won't re-fire, then continue the wizard.
              if (!overflow) return;
              const acked = overflow;
              toast({
                title: `Partial release accepted`,
                description: `${acked.have} of ${acked.itemName} will release now; ${acked.want - acked.have} stays as backorder.`,
              });
              const nextAck = new Set(partialAck).add(acked.itemId);
              setPartialAck(nextAck);
              setOverflow(null);
              void proceedFromItems(nextAck);
            }}
            data-testid="overflow-partial"
          >Partial Release</Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* ── Duplicate-order detection dialog (§9) ─────────────────────────── */}
    <Dialog open={!!duplicateInfo} onOpenChange={(o) => !o && setDuplicateInfo(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertCircle className="h-5 w-5" /> Possible Duplicate Order Detected
          </DialogTitle>
          <DialogDescription className="text-foreground/80 pt-2 leading-relaxed">
            An order for <strong>{duplicateInfo?.customerName}</strong> with one
            of the same items is already logged.
            <br /><br />
            <span className="text-xs font-mono">Order: {duplicateInfo?.trackingNumber}</span>
            <br />
            <span className="text-xs">Status: {duplicateInfo?.fulfillmentStatus}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setDuplicateInfo(null)} data-testid="dup-close">Close</Button>
          <Button
            variant="outline"
            onClick={() => {
              if (duplicateInfo?._id) {
                setDuplicateInfo(null);
                onClose();
                navigate(`/orders/${duplicateInfo._id}`);
              }
            }}
            data-testid="dup-check"
          >Check the Order</Button>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const res = await apiRequest("POST", "/api/item-requests", {
                  action: "DUPLICATE_ORDER",
                  payload: {
                    customerName: form.getValues("customerName"),
                    items: orderItems.map((i) => ({ itemId: i.itemId, itemName: i.itemName, qty: i.qty })),
                    duplicateOf: duplicateInfo?._id,
                    duplicateTracking: duplicateInfo?.trackingNumber,
                  },
                  notes: `Duplicate detected for ${duplicateInfo?.customerName}. Asking permission to log a 2nd order.`,
                });
                const json = await res.json();
                if (json?.success) toast({ title: "Notified admin / inventory manager" });
                setDuplicateInfo(null);
              } catch (e: any) {
                toast({ title: "Notify failed", description: e.message, variant: "destructive" });
              }
            }}
            data-testid="dup-notify"
          >Notify Admin</Button>
          <Button
            onClick={async () => {
              try {
                const res = await apiRequest("POST", "/api/item-requests", {
                  action: "DUPLICATE_ORDER",
                  payload: {
                    customerName: form.getValues("customerName"),
                    items: orderItems.map((i) => ({ itemId: i.itemId, itemName: i.itemName, qty: i.qty })),
                    duplicateOf: duplicateInfo?._id,
                    duplicateTracking: duplicateInfo?.trackingNumber,
                  },
                  notes: `Employee wants to proceed past a duplicate hit. Approve in the inbox to release.`,
                });
                const json = await res.json();
                if (json?.success) {
                  setWaitingApproval({ requestId: json.data.request._id, startedAt: Date.now() });
                  toast({ title: "Request sent — waiting for admin approval" });
                }
                setDuplicateInfo(null);
              } catch (e: any) {
                toast({ title: "Could not send", description: e.message, variant: "destructive" });
              }
            }}
            data-testid="dup-proceed"
          >Proceed to Checkout</Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* ── Waiting-for-admin overlay with live elapsed counter (§9) ─────── */}
    <Dialog open={!!waitingApproval} onOpenChange={(o) => !o && setWaitingApproval(null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Waiting for Admin Approval…
          </DialogTitle>
          <DialogDescription>
            The admin / inventory manager has been notified. You can close this dialog —
            the page will auto-advance the moment approval lands.
          </DialogDescription>
        </DialogHeader>
        <ElapsedTimer startedAt={waitingApproval?.startedAt ?? Date.now()} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setWaitingApproval(null)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* ── Auto-receipt — pops the moment an order is created ───────────── */}
    <ReceiptDialog
      order={receiptOrder}
      open={!!receiptOrder}
      onClose={() => setReceiptOrder(null)}
      autoTitle="Order Created"
    />
    </>
  );
}

/** Live MM:SS elapsed counter for the waiting-for-admin overlay. */
function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [n, setN] = useState(0);
  useMemo(() => setN(0), [startedAt]);
  // tick every second
  useState(() => {
    const t = setInterval(() => setN((x) => x + 1), 1000);
    return () => clearInterval(t);
  });
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  void n;
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <div className="text-center py-3">
      <p className="text-3xl font-mono tabular-nums" data-testid="text-approval-elapsed">{mm}:{ss}</p>
      <p className="text-xs text-muted-foreground mt-1">Elapsed</p>
    </div>
  );
}

export default function OrdersPage() {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [assignedSearch, setAssignedSearch] = useState("");
  const [assignedEmployeeFilter, setAssignedEmployeeFilter] = useState("all");
  const [assignedDoneFilter, setAssignedDoneFilter] = useState("not_yet"); // "all" | "done" | "not_yet"
  const [poolSearch, setPoolSearch] = useState("");
  const [poolTypeFilter, setPoolTypeFilter] = useState("all");
  const [poolSort, setPoolSort] = useState("date_desc"); // date_desc | date_asc | type | amount_asc | amount_desc
  const [poolPage, setPoolPage] = useState(1);
  const POOL_PAGE_SIZE = 10;
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<string>("");
  const [assignPending, setAssignPending] = useState<{ orderId: string; trackingNumber: string; username: string } | null>(null);

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

  const { data: poolData } = useQuery<{ success: boolean; data: { orders: IOrder[] } }>({
    queryKey: ["/api/orders?pool=true"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/orders?pool=true");
      return res.json();
    },
  });

  const { data: myActiveData } = useQuery<{ success: boolean; data: { order: IOrder | null; orders?: IOrder[] } }>({
    queryKey: ["/api/orders/my-active"],
    enabled: !isAdmin,
  });

  const { data: allItemsData } = useQuery<{ success: boolean; data: IItem[] }>({ queryKey: ["/api/items/all"] });
  const { data: usersData } = useQuery<{ success: boolean; data: SimpleUser[] }>({ queryKey: ["/api/users/simple"], enabled: isAdmin });

  const assignMutation = useMutation({
    mutationFn: async ({ orderId, username, displayName }: { orderId: string; username: string; displayName: string }) => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/assign`, { username, displayName });
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["/api/orders"], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["/api/orders?pool=true"], type: "active" }),
      ]);
      toast({ title: "Order assigned" });
    },
    onError: (err: Error) => toast({ title: "Assignment failed", description: err.message, variant: "destructive" }),
  });

  // Inline "Return to pool" — unassigns the order and resets its fulfillment
  // back to "pending" so it shows up in the Pending Pool below.
  const unassignMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await apiRequest("DELETE", `/api/orders/${orderId}/assign`);
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["/api/orders"], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["/api/orders?pool=true"], type: "active" }),
      ]);
      toast({ title: "Returned to pool" });
    },
    onError: (err: Error) => toast({ title: "Failed to return to pool", description: err.message, variant: "destructive" }),
  });

  const claimMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/claim`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "Cannot claim");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders?assignedToMe=true"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders?pool=true"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/my-active"] });
      toast({ title: "Order claimed — it's now yours!" });
    },
    onError: (err: Error) => toast({ title: "Cannot claim order", description: err.message, variant: "destructive" }),
  });

  const startMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/start-processing`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "Failed to start");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders?assignedToMe=true"] });
      toast({ title: "Processing started" });
    },
    onError: (err: Error) => toast({ title: "Failed to start processing", description: err.message, variant: "destructive" }),
  });

  const completeMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/complete-processing`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "Failed to complete");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders?assignedToMe=true"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/my-active"] });
      toast({ title: "Processing complete — order is ready!" });
    },
    onError: (err: Error) => toast({ title: "Failed to complete processing", description: err.message, variant: "destructive" }),
  });

  const orders = ordersData?.data?.orders || [];
  const allItems = allItemsData?.data || [];
  const allUsers = usersData?.data || [];
  const myAssignedOrders = assignedData?.data?.orders || [];
  const poolOrders = poolData?.data?.orders || [];
  const myBlockingOrder = myActiveData?.data?.order || null;
  const myBlockingOrders = myActiveData?.data?.orders || (myBlockingOrder ? [myBlockingOrder] : []);

  // "Assigned to You" pending list excludes:
  // - currentStatus === "Completed"
  // - completedProcessingAt is set (Mark Done was clicked)
  // - fulfillmentStatus is "ready", "completed", or "cancelled"
  const myPendingAssigned = myAssignedOrders.filter(
    (o) =>
      o.currentStatus !== "Completed" &&
      !o.completedProcessingAt &&
      o.fulfillmentStatus !== "ready" &&
      o.fulfillmentStatus !== "completed" &&
      o.fulfillmentStatus !== "cancelled"
  );
  const isTaskLocked = !isAdmin && myBlockingOrders.length > 0;
  const employees = allUsers.filter((u) => u.role === "EMPLOYEE");

  // ── Admin: Assigned Orders (all assigned orders from main list) ──────────────
  const allAssignedOrders = orders.filter((o) => o.assignedTo && o.assignedTo !== "");

  const filteredAssignedOrders = useMemo(() => {
    let res = allAssignedOrders;
    if (assignedEmployeeFilter !== "all") res = res.filter((o) => o.assignedTo === assignedEmployeeFilter);
    if (assignedDoneFilter === "done") res = res.filter((o) => !!o.completedProcessingAt);
    if (assignedDoneFilter === "not_yet") res = res.filter((o) => !o.completedProcessingAt);
    if (assignedSearch) res = res.filter((o) =>
      o.trackingNumber.toLowerCase().includes(assignedSearch.toLowerCase()) ||
      o.customerName.toLowerCase().includes(assignedSearch.toLowerCase()) ||
      (o.assignedTo || "").toLowerCase().includes(assignedSearch.toLowerCase())
    );
    return res;
  }, [allAssignedOrders, assignedEmployeeFilter, assignedDoneFilter, assignedSearch]);

  // Group by employee for display
  const assignedByEmployee = useMemo(() => {
    const map = new Map<string, IOrder[]>();
    filteredAssignedOrders.forEach((o) => {
      const emp = o.assignedTo || "—";
      if (!map.has(emp)) map.set(emp, []);
      map.get(emp)!.push(o);
    });
    return map;
  }, [filteredAssignedOrders]);

  // ── Admin: Pool ──────────────────────────────────────────────────────────────
  const filteredPoolOrders = useMemo(() => {
    let res = poolOrders;
    if (poolSearch) {
      res = res.filter((o) =>
        o.trackingNumber.toLowerCase().includes(poolSearch.toLowerCase()) ||
        o.customerName.toLowerCase().includes(poolSearch.toLowerCase())
      );
    }
    if (poolTypeFilter !== "all") res = res.filter((o) => o.orderType === poolTypeFilter);
    res = [...res].sort((a, b) => {
      switch (poolSort) {
        case "date_asc": return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "amount_asc": return a.totalAmount - b.totalAmount;
        case "amount_desc": return b.totalAmount - a.totalAmount;
        case "type": return (ORDER_TYPE_LABELS[a.orderType] || a.orderType).localeCompare(ORDER_TYPE_LABELS[b.orderType] || b.orderType);
        case "date_desc":
        default: return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });
    return res;
  }, [poolOrders, poolSearch, poolTypeFilter, poolSort]);

  const poolTotalPages = Math.max(1, Math.ceil(filteredPoolOrders.length / POOL_PAGE_SIZE));
  const poolPageSafe = Math.min(poolPage, poolTotalPages);
  const pagedPoolOrders = filteredPoolOrders.slice((poolPageSafe - 1) * POOL_PAGE_SIZE, poolPageSafe * POOL_PAGE_SIZE);

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 space-y-4 pb-10">
        <h1 className="text-xl sm:text-2xl font-bold">Orders</h1>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // ─── EMPLOYEE VIEW ───────────────────────────────────────────────
  if (!isAdmin) {
    const { text: greetText, Icon: GreetIcon } = getGreeting();
    return (
      <div className="p-3 sm:p-6 space-y-6 pb-10">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <GreetIcon className="h-4 w-4" />
              <span>{greetText}, <strong className="text-foreground">{user?.username}</strong>!</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-orders-title">Orders</h1>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-create-order">
            <Plus className="mr-1 h-4 w-4" />Create Order
          </Button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Assigned to You</h2>
            {myPendingAssigned.length > 0 && <Badge className="bg-primary text-primary-foreground">{myPendingAssigned.length} pending</Badge>}
          </div>
          {myAssignedOrders.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No orders are currently assigned to you.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {myPendingAssigned.map((order) => {
                const canStart = order.fulfillmentStatus === "pending" && !order.startedAt;
                const canComplete = order.fulfillmentStatus === "processing" || (!!order.startedAt && !order.completedProcessingAt);
                return (
                <Card key={order._id} className="hover:border-primary/50 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5 flex-1 cursor-pointer" onClick={() => navigate(`/orders/${order._id}`)}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-semibold text-sm">{order.trackingNumber}</span>
                          <StatusBadge status={order.currentStatus} />
                          <FulfillmentBadge status={order.fulfillmentStatus} />
                          <PaymentBadge status={order.paymentStatus} />
                        </div>
                        <p className="font-medium">{order.customerName}</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>Total: <strong className="text-foreground">{formatCurrency(order.totalAmount)}</strong></span>
                          <span>Type: <strong className="text-foreground">{ORDER_TYPE_LABELS[order.orderType] || order.orderType}</strong></span>
                          <span>Created: <strong className="text-foreground">{fmt12(order.createdAt)}</strong></span>
                          {order.assignedAt && <span>Assigned: <strong className="text-foreground">{fmt12(order.assignedAt)}</strong></span>}
                          {order.startedAt && <span>Started: <strong className="text-foreground">{fmt12(order.startedAt)}</strong></span>}
                        </div>
                        {order.notes && <p className="text-xs text-muted-foreground">Note: {order.notes}</p>}
                        <div className="flex flex-wrap gap-1">
                          {order.items.slice(0, 3).map((item, i) => (
                            <Badge key={i} variant="outline" className="text-xs">{item.itemName} ×{item.qty}</Badge>
                          ))}
                          {order.items.length > 3 && <Badge variant="outline" className="text-xs">+{order.items.length - 3} more</Badge>}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 items-end flex-shrink-0">
                        {canStart && (
                          <Button size="sm" variant="default" className="h-8 text-xs"
                            disabled={startMutation.isPending}
                            onClick={(e) => { e.stopPropagation(); startMutation.mutate(order._id); }}
                            data-testid={`button-start-processing-${order._id}`}
                          >
                            {startMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
                            Start Processing
                          </Button>
                        )}
                        {canComplete && (
                          <Button size="sm" variant="default" className="h-8 text-xs bg-green-600 hover:bg-green-700"
                            disabled={completeMutation.isPending}
                            onClick={(e) => { e.stopPropagation(); completeMutation.mutate(order._id); }}
                            data-testid={`button-complete-processing-${order._id}`}
                          >
                            {completeMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCheck className="h-3 w-3 mr-1" />}
                            Mark Done
                          </Button>
                        )}
                        <ChevronRight className="h-5 w-5 text-muted-foreground mt-1 cursor-pointer" onClick={() => navigate(`/orders/${order._id}`)} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                );
              })}
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
                      <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        {order.paymentStatus === "paid" && <ReceiptButton order={order} />}
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-muted-foreground">Pending Pool</h2>
            {poolOrders.length > 0 && <Badge variant="outline">{poolOrders.length} available</Badge>}
          </div>
          {isTaskLocked && myBlockingOrders.length > 0 && (
            <div className="flex items-start gap-3 p-3 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-300">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium mb-1">
                  You have {myBlockingOrders.length} active order{myBlockingOrders.length !== 1 ? "s" : ""}. Mark them done before claiming new ones:
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {myBlockingOrders.map((o) => (
                    <button
                      key={o._id}
                      onClick={() => navigate(`/orders/${o._id}`)}
                      className="font-mono text-xs px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 border border-amber-300 dark:border-amber-700 hover:bg-amber-200 dark:hover:bg-amber-900"
                      data-testid={`blocking-order-${o._id}`}
                    >
                      {o.trackingNumber}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search pool..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-orders" />
          </div>
          {poolOrders.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No orders in the pool right now.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {poolOrders
                .filter((o) => !search || o.trackingNumber.toLowerCase().includes(search.toLowerCase()) || o.customerName.toLowerCase().includes(search.toLowerCase()))
                .map((order) => (
                <Card key={order._id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5 flex-1 cursor-pointer" onClick={() => navigate(`/orders/${order._id}`)}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-semibold text-sm">{order.trackingNumber}</span>
                          <FulfillmentBadge status={order.fulfillmentStatus} />
                          <PaymentBadge status={order.paymentStatus} />
                        </div>
                        <p className="font-medium">{order.customerName}</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>Total: <strong className="text-foreground">{formatCurrency(order.totalAmount)}</strong></span>
                          <span>Type: <strong className="text-foreground">{ORDER_TYPE_LABELS[order.orderType] || order.orderType}</strong></span>
                          <span>Created: <strong className="text-foreground">{fmt12(order.createdAt)}</strong></span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {order.items.slice(0, 3).map((item, i) => (
                            <Badge key={i} variant="outline" className="text-xs">{item.itemName} ×{item.qty}</Badge>
                          ))}
                          {order.items.length > 3 && <Badge variant="outline" className="text-xs">+{order.items.length - 3} more</Badge>}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-shrink-0 h-9 text-xs border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                        disabled={isTaskLocked || claimMutation.isPending}
                        onClick={(e) => { e.stopPropagation(); claimMutation.mutate(order._id); }}
                        data-testid={`button-claim-order-${order._id}`}
                      >
                        {claimMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ArrowRightCircle className="h-3 w-3 mr-1" />}
                        Claim
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <CreateOrderDialog open={createOpen} onClose={() => setCreateOpen(false)} allItems={allItems} />
      </div>
    );
  }

  // ─── ADMIN VIEW ──────────────────────────────────────────────────
  return (
    <div className="p-3 sm:p-6 space-y-6 pb-10">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-orders-title">Orders</h1>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-create-order">
          <Plus className="mr-1 h-4 w-4" />Create Order
        </Button>
      </div>

      {/* ── Section 1: Assigned Orders ──────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <UserCheck className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Assigned Orders</h2>
          <Badge variant="outline">{allAssignedOrders.length} total</Badge>
        </div>

        {/* Filters row */}
        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search assigned..." className="pl-9 h-8" value={assignedSearch} onChange={(e) => setAssignedSearch(e.target.value)} data-testid="input-search-assigned" />
          </div>
          <Select value={assignedEmployeeFilter} onValueChange={setAssignedEmployeeFilter}>
            <SelectTrigger className="w-[175px] h-8 text-xs" data-testid="select-filter-employee">
              <Users className="h-3.5 w-3.5 mr-1" />
              <SelectValue placeholder="View employee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {Array.from(new Set(allAssignedOrders.map((o) => o.assignedTo || ""))).filter(Boolean).map((emp) => (
                <SelectItem key={emp} value={emp}>{emp}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={assignedDoneFilter} onValueChange={setAssignedDoneFilter}>
            <SelectTrigger className="w-[145px] h-8 text-xs" data-testid="select-filter-done">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="not_yet">Not Yet Done</SelectItem>
              <SelectItem value="done">Done</SelectItem>
            </SelectContent>
          </Select>
          {(assignedSearch || assignedEmployeeFilter !== "all" || assignedDoneFilter !== "not_yet") && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setAssignedSearch(""); setAssignedEmployeeFilter("all"); setAssignedDoneFilter("not_yet"); }}>
              Clear
            </Button>
          )}
        </div>

        {/* Grouped by employee */}
        {filteredAssignedOrders.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground text-sm">No assigned orders match your filters.</CardContent></Card>
        ) : (
          <div className="space-y-4">
            {Array.from(assignedByEmployee.entries()).map(([emp, empOrders]) => (
              <div key={emp} className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                    <Users className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <span className="font-semibold text-sm">{emp}</span>
                  <Badge variant="secondary" className="text-xs">{empOrders.length} order{empOrders.length !== 1 ? "s" : ""}</Badge>
                </div>
                <Card>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Tracking #</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Payment</TableHead>
                            <TableHead>Fulfillment</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead>Assigned</TableHead>
                            <TableHead>Processing</TableHead>
                            <TableHead className="w-16">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {empOrders.map((order) => (
                            <TableRow key={order._id} className="cursor-pointer" onClick={() => navigate(`/orders/${order._id}`)}>
                              <TableCell className="font-mono text-sm font-medium">{order.trackingNumber}</TableCell>
                              <TableCell>{order.customerName}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{ORDER_TYPE_LABELS[order.orderType] || order.orderType}</TableCell>
                              <TableCell><PaymentBadge status={order.paymentStatus} /></TableCell>
                              <TableCell><FulfillmentBadge status={order.fulfillmentStatus} /></TableCell>
                              <TableCell className="text-right">{formatCurrency(order.totalAmount)}</TableCell>
                              <TableCell className="text-muted-foreground text-xs">{fmt12(order.assignedAt)}</TableCell>
                              <TableCell>
                                {order.completedProcessingAt ? (
                                  <Badge className="text-xs bg-green-600 text-white border-transparent">Done</Badge>
                                ) : order.startedAt ? (
                                  <Badge className="text-xs bg-blue-500 text-white border-transparent">In Progress</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs">Not Started</Badge>
                                )}
                              </TableCell>
                              <TableCell onClick={(e) => e.stopPropagation()}>
                                {order.paymentStatus === "paid" ? (
                                  <ReceiptButton order={order} variant="ghost" label="Receipt" />
                                ) : (!order.completedProcessingAt && order.fulfillmentStatus !== "completed" && order.fulfillmentStatus !== "cancelled" && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                                    title="Return to pool"
                                    disabled={unassignMutation.isPending}
                                    onClick={() => {
                                      if (window.confirm(`Return ${order.trackingNumber} to the pool?`)) {
                                        unassignMutation.mutate(order._id);
                                      }
                                    }}
                                    data-testid={`button-unassign-${order._id}`}
                                  >
                                    Return to pool
                                  </Button>
                                ))}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* ── Section 2: Pending Pool ──────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-amber-500" />
          <h2 className="text-lg font-semibold">Pending Pool</h2>
          <Badge className="bg-amber-500 text-white border-transparent">{poolOrders.length} unassigned</Badge>
        </div>

        {/* Pool search + filters */}
        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search pool..." className="pl-9 h-8" value={poolSearch} onChange={(e) => { setPoolSearch(e.target.value); setPoolPage(1); }} data-testid="input-search-pool" />
          </div>
          <Select value={poolTypeFilter} onValueChange={(v) => { setPoolTypeFilter(v); setPoolPage(1); }}>
            <SelectTrigger className="w-[170px] h-8 text-xs" data-testid="select-pool-type">
              <Filter className="h-3.5 w-3.5 mr-1" />
              <SelectValue placeholder="Order type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {ORDER_TYPES.map((t) => <SelectItem key={t} value={t}>{ORDER_TYPE_LABELS[t]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={poolSort} onValueChange={(v) => { setPoolSort(v); setPoolPage(1); }}>
            <SelectTrigger className="w-[185px] h-8 text-xs" data-testid="select-pool-sort">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date_desc">Date — Newest first</SelectItem>
              <SelectItem value="date_asc">Date — Oldest first</SelectItem>
              <SelectItem value="type">Type (A–Z)</SelectItem>
              <SelectItem value="amount_asc">Amount — Low to High</SelectItem>
              <SelectItem value="amount_desc">Amount — High to Low</SelectItem>
            </SelectContent>
          </Select>
          {(poolSearch || poolTypeFilter !== "all" || poolSort !== "date_desc") && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setPoolSearch(""); setPoolTypeFilter("all"); setPoolSort("date_desc"); setPoolPage(1); }}>
              Clear
            </Button>
          )}
        </div>

        {filteredPoolOrders.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground text-sm">
            {poolOrders.length === 0 ? "No orders in the pool right now." : "No pool orders match your filters."}
          </CardContent></Card>
        ) : (
          <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tracking #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Assign To</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedPoolOrders.map((order) => (
                      <PoolAdminRow
                        key={order._id}
                        order={order}
                        allUsers={allUsers}
                        onAssignClick={(username) => {
                          if (username && username !== "__unassign__") {
                            setAssignPending({ orderId: order._id, trackingNumber: order.trackingNumber, username });
                          }
                        }}
                        onNavigate={() => navigate(`/orders/${order._id}`)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          {/* Pagination — 10 per page */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-muted-foreground">
              Showing {(poolPageSafe - 1) * POOL_PAGE_SIZE + 1}–{Math.min(poolPageSafe * POOL_PAGE_SIZE, filteredPoolOrders.length)} of {filteredPoolOrders.length}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" disabled={poolPageSafe <= 1} onClick={() => setPoolPage((p) => Math.max(1, p - 1))} data-testid="button-pool-prev">
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />Prev
              </Button>
              <span className="text-xs text-muted-foreground">Page {poolPageSafe} of {poolTotalPages}</span>
              <Button variant="outline" size="sm" className="h-8 text-xs" disabled={poolPageSafe >= poolTotalPages} onClick={() => setPoolPage((p) => Math.min(poolTotalPages, p + 1))} data-testid="button-pool-next">
                Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </div>
          </>
        )}
      </div>

      {/* Dialogs */}
      <CreateOrderDialog open={createOpen} onClose={() => setCreateOpen(false)} allItems={allItems} />

      {assignPending && (
        <AssignConfirmDialog
          open={!!assignPending}
          onClose={() => setAssignPending(null)}
          targetUsername={assignPending.username}
          orderTrackingNumber={assignPending.trackingNumber}
          allOrders={orders}
          isPending={assignMutation.isPending}
          onConfirm={() => {
            assignMutation.mutate({ orderId: assignPending.orderId, username: assignPending.username, displayName: assignPending.username });
            setAssignPending(null);
          }}
        />
      )}
    </div>
  );
}
