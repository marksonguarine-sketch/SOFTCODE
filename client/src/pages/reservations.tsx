import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, formatDistanceToNow, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday, isFuture, isPast, addMonths, subMonths, differenceInDays } from "date-fns";
import {
  CalendarCheck, ChevronLeft, ChevronRight, Search, X, Filter, FileText,
  Phone, User, Clock, Copy, Check, Loader2, Eye, MoreHorizontal,
  StickyNote, Printer, CalendarDays, MapPin, CreditCard, Package,
  AlertCircle, CheckCircle2, Ban, ChevronDown, Plus, Trash2,
} from "lucide-react";
import type { IItem } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getStatusBadgeClass } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { speakTTS } from "@/lib/tts";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const ORDER_TYPE_LABEL: Record<string, string> = {
  online_reservation: "Online Reservation",
  walkin_reservation: "Walk-in Reservation",
};
const FULFILLMENT_LABELS: Record<string, string> = {
  pending: "Pending", processing: "Confirmed", ready: "Ready",
  completed: "Completed", cancelled: "Cancelled",
};
const PAYMENT_LABELS: Record<string, string> = {
  pending_payment: "Unpaid", partial: "Partial", paid: "Paid", refunded: "Refunded",
};

function formatPHP(v: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v);
}

function pdfCurrency(v: number): string {
  const abs = Math.abs(v);
  const parts = abs.toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (v < 0 ? "-PHP " : "PHP ") + parts[0] + "." + parts[1];
}

type ResItemLocal = {
  itemId: string; itemName: string; qty: number;
  originalUnitPrice: number; discountedUnitPrice: number;
  discountApplied: boolean; offerName: string; lineTotal: number;
};

const RES_ORDER_TYPES = ["walkin_reservation", "online_reservation"] as const;
const RES_ORDER_CHANNELS = ["walkin", "email", "sms", "messenger", "phone"] as const;
const RES_ALLOWED_METHODS: Record<string, string[]> = {
  walkin_reservation: ["cash", "gcash_qr"],
  online_reservation: ["gcash_qr"],
};
const RES_PAYMENT_STATUSES = ["pending_payment", "partial", "paid"] as const;
const RES_FULFILLMENT_STATUSES = ["pending", "processing", "ready", "completed", "cancelled"] as const;

function CreateReservationDialog({ open, onClose, allItems }: { open: boolean; onClose: () => void; allItems: IItem[] }) {
  const { toast } = useToast();
  const [orderItems, setOrderItems] = useState<ResItemLocal[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [orderType, setOrderType] = useState<"walkin_reservation" | "online_reservation">("walkin_reservation");
  const [orderChannel, setOrderChannel] = useState("walkin");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentStatus, setPaymentStatus] = useState("pending_payment");
  const [fulfillmentStatus, setFulfillmentStatus] = useState("pending");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const allowedMethods = RES_ALLOWED_METHODS[orderType] || ["cash"];

  const filteredItems = allItems.filter(
    (it) => !orderItems.find((oi) => oi.itemId === it._id) &&
      (itemSearch === "" || it.itemName.toLowerCase().includes(itemSearch.toLowerCase()))
  );

  function addItemToList(item: IItem) {
    const exists = orderItems.find((oi) => oi.itemId === item._id);
    if (exists) {
      setOrderItems((prev) => prev.map((oi) => oi.itemId === item._id
        ? { ...oi, qty: oi.qty + 1, lineTotal: (oi.qty + 1) * oi.discountedUnitPrice } : oi));
    } else {
      setOrderItems((prev) => [...prev, {
        itemId: item._id, itemName: item.itemName, qty: 1,
        originalUnitPrice: item.unitPrice, discountedUnitPrice: item.unitPrice,
        discountApplied: false, offerName: "", lineTotal: item.unitPrice,
      }]);
    }
    setItemSearch("");
  }

  function removeItem(itemId: string) {
    setOrderItems((prev) => prev.filter((oi) => oi.itemId !== itemId));
  }

  const subtotal = orderItems.reduce((s, i) => s + i.lineTotal, 0);

  function validate() {
    const e: Record<string, string> = {};
    if (!customerName.trim()) e.customerName = "Customer name is required";
    if (!scheduledDate) e.scheduledDate = "Scheduled date and time is required";
    if (!paymentMethod) e.paymentMethod = "Payment method is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function resetForm() {
    setCustomerName(""); setCustomerPhone(""); setScheduledDate(""); setNotes("");
    setOrderItems([]); setItemSearch(""); setErrors({});
    setOrderType("walkin_reservation"); setOrderChannel("walkin");
    setPaymentMethod("cash"); setPaymentStatus("pending_payment"); setFulfillmentStatus("pending");
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/orders", {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        orderType, orderChannel, paymentMethod, paymentStatus, fulfillmentStatus,
        scheduledDate, notes, deliveryFee: 0, items: orderItems,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
      const dateLabel = scheduledDate
        ? new Date(scheduledDate).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" })
        : "a scheduled date";
      const itemsList = orderItems.length > 0
        ? orderItems.map((i) => `${i.qty} ${i.itemName}`).join(", ")
        : "no specific items";
      const typeLabel = orderType === "online_reservation" ? "online reservation" : "walk-in reservation";
      speakTTS(
        `New ${typeLabel} has been created for ${customerName}, scheduled for ${dateLabel}. ` +
        `Items: ${itemsList}. ` +
        (subtotal > 0 ? `Total amount: ${new Intl.NumberFormat("en-PH", { style: "decimal", minimumFractionDigits: 2 }).format(subtotal)} pesos. ` : "") +
        `Payment via ${paymentMethod === "gcash_qr" ? "GCash" : paymentMethod}.`
      );
      toast({ title: "Reservation created successfully" });
      onClose();
      resetForm();
    },
    onError: (err: Error) => toast({ title: "Failed to create reservation", description: err.message, variant: "destructive" }),
  });

  function handleSubmit() {
    if (!validate()) return;
    createMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); resetForm(); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5" />New Reservation
          </DialogTitle>
          <DialogDescription>Fill in all required details to schedule a new reservation.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Customer Name <span className="text-destructive">*</span></label>
              <Input placeholder="e.g. Juan dela Cruz" value={customerName}
                onChange={(e) => setCustomerName(e.target.value)} data-testid="input-res-customer-name" />
              {errors.customerName && <p className="text-xs text-destructive">{errors.customerName}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Customer Phone</label>
              <Input placeholder="e.g. 0917-123-4567" value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)} data-testid="input-res-customer-phone" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Reservation Type <span className="text-destructive">*</span></label>
            <div className="grid grid-cols-2 gap-2">
              {RES_ORDER_TYPES.map((type) => (
                <button key={type} type="button"
                  className={`p-3 rounded-lg border text-sm text-left transition-colors ${orderType === type ? "border-primary bg-primary/5 font-medium" : "border-border hover:border-primary/50"}`}
                  onClick={() => {
                    setOrderType(type);
                    const allowed = RES_ALLOWED_METHODS[type] || ["cash"];
                    if (!allowed.includes(paymentMethod)) setPaymentMethod(allowed[0]);
                  }}>
                  {type === "walkin_reservation" ? "Walk-in Reservation" : "Online Reservation"}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Scheduled Date & Time <span className="text-destructive">*</span></label>
            <Input type="datetime-local" value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)} data-testid="input-res-scheduled-date" />
            {errors.scheduledDate && <p className="text-xs text-destructive">{errors.scheduledDate}</p>}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Order Channel</label>
            <Select value={orderChannel} onValueChange={setOrderChannel}>
              <SelectTrigger data-testid="select-res-channel"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RES_ORDER_CHANNELS.map((ch) => (
                  <SelectItem key={ch} value={ch}>{ch.charAt(0).toUpperCase() + ch.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Payment Method <span className="text-destructive">*</span></label>
              <div className="grid grid-cols-2 gap-2">
                {allowedMethods.map((method) => (
                  <button key={method} type="button"
                    className={`p-2 rounded-lg border text-xs text-center transition-colors ${paymentMethod === method ? "border-primary bg-primary/5 font-medium" : "border-border hover:border-primary/50"}`}
                    onClick={() => setPaymentMethod(method)}>
                    {method === "gcash_qr" ? "GCash QR" : method.charAt(0).toUpperCase() + method.slice(1)}
                  </button>
                ))}
              </div>
              {errors.paymentMethod && <p className="text-xs text-destructive">{errors.paymentMethod}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Payment Status</label>
              <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                <SelectTrigger data-testid="select-res-payment-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RES_PAYMENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "pending_payment" ? "Pending Payment" : s === "partial" ? "Partial" : "Paid"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Fulfillment Status</label>
            <Select value={fulfillmentStatus} onValueChange={setFulfillmentStatus}>
              <SelectTrigger data-testid="select-res-fulfillment"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RES_FULFILLMENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Items <span className="text-muted-foreground text-xs">(optional)</span></label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search items to add…" value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)} data-testid="input-res-item-search" />
              {itemSearch && filteredItems.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-50 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto mt-1">
                  {filteredItems.slice(0, 8).map((it) => (
                    <button key={it._id} type="button"
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent text-left"
                      onClick={() => addItemToList(it)} data-testid={`option-res-item-${it._id}`}>
                      <span>{it.itemName}</span>
                      <span className="text-muted-foreground text-xs">{formatPHP(it.unitPrice)} · {it.currentQuantity} avail</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {orderItems.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-2 text-left font-medium">Item</th>
                      <th className="p-2 text-center font-medium">Qty</th>
                      <th className="p-2 text-right font-medium">Price</th>
                      <th className="p-2 text-right font-medium">Total</th>
                      <th className="p-2 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {orderItems.map((oi) => (
                      <tr key={oi.itemId} className="border-b">
                        <td className="p-2">{oi.itemName}</td>
                        <td className="p-2">
                          <div className="flex items-center justify-center gap-1">
                            <button type="button"
                              className="h-7 w-7 rounded border flex items-center justify-center hover:bg-accent font-bold text-base leading-none"
                              onClick={() => {
                                const newQty = Math.max(1, oi.qty - 1);
                                setOrderItems((prev) => prev.map((i) => i.itemId === oi.itemId ? { ...i, qty: newQty, lineTotal: newQty * i.discountedUnitPrice } : i));
                              }}>−</button>
                            <span className="w-8 text-center font-medium">{oi.qty}</span>
                            <button type="button"
                              className="h-7 w-7 rounded border flex items-center justify-center hover:bg-accent font-bold text-base leading-none"
                              onClick={() => {
                                const stock = allItems.find((i) => i._id === oi.itemId)?.currentQuantity ?? 999;
                                const newQty = Math.min(stock, oi.qty + 1);
                                setOrderItems((prev) => prev.map((i) => i.itemId === oi.itemId ? { ...i, qty: newQty, lineTotal: newQty * i.discountedUnitPrice } : i));
                              }}>+</button>
                          </div>
                        </td>
                        <td className="p-2 text-right">{formatPHP(oi.originalUnitPrice)}</td>
                        <td className="p-2 text-right font-medium">{formatPHP(oi.lineTotal)}</td>
                        <td className="p-2">
                          <button type="button" onClick={() => removeItem(oi.itemId)}
                            className="text-destructive hover:text-destructive/80 p-1">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="p-2 text-right text-sm font-semibold">Subtotal: {formatPHP(subtotal)}</div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Notes</label>
            <Textarea placeholder="Any special instructions or notes…" value={notes}
              onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="input-res-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); resetForm(); }} type="button">Cancel</Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending} type="button" data-testid="button-create-reservation">
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <CalendarCheck className="h-4 w-4 mr-2" />Create Reservation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status, size = "sm" }: { status: string; size?: "xs" | "sm" }) {
  const cls = getStatusBadgeClass(status);
  const label =
    FULFILLMENT_LABELS[status] ||
    PAYMENT_LABELS[status] ||
    ORDER_TYPE_LABEL[status] ||
    status.replace(/_/g, " ");
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 font-medium border-0", size === "xs" ? "text-[10px]" : "text-xs", cls)}>
      {label}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button onClick={copy} className="ml-1 text-muted-foreground hover:text-foreground transition-colors">
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function generatePDF(reservation: any, settings?: any) {
  const doc = new jsPDF();
  const primaryColor: [number, number, number] = [30, 58, 95];
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, pageW, 40, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("JOAP Hardware Trading", 14, 16);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(settings?.storeAddress || "Hardware Store", 14, 23);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("RESERVATION CONFIRMATION", pageW / 2, 22, { align: "center" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`RC-${reservation.trackingNumber}`, pageW / 2, 30, { align: "center" });
  doc.text(`Issued: ${format(new Date(), "MMMM d, yyyy")}`, pageW / 2, 36, { align: "center" });

  doc.setTextColor(0, 0, 0);
  let y = 52;
  doc.setFontSize(11);
  doc.text(`Dear ${reservation.customerName},`, 14, y);
  y += 7;
  doc.setFontSize(10);
  doc.text("We are pleased to confirm your reservation with JOAP Hardware Trading.", 14, y);
  y += 12;

  doc.setFillColor(245, 247, 250);
  doc.rect(14, y - 4, pageW - 28, 44, "F");
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Reservation Details", 18, y + 2);
  doc.setFont("helvetica", "normal");
  const details = [
    ["Tracking #", reservation.trackingNumber],
    ["Type", ORDER_TYPE_LABEL[reservation.orderType] || reservation.orderType],
    ["Scheduled Date", reservation.scheduledDate ? format(new Date(reservation.scheduledDate), "EEEE, MMMM d, yyyy") : "Not set"],
    ["Order Channel", reservation.orderChannel || "N/A"],
    ["Payment Method", reservation.paymentMethod || "N/A"],
    ["Payment Status", PAYMENT_LABELS[reservation.paymentStatus] || reservation.paymentStatus],
  ];
  details.forEach(([label, value], i) => {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, 18, y + 10 + i * 5);
    doc.setFont("helvetica", "normal");
    doc.text(value, 70, y + 10 + i * 5);
  });
  y += 50;

  if (reservation.items?.length) {
    const rows = reservation.items.map((it: any) => [
      it.itemName,
      String(it.qty ?? it.quantity ?? 1),
      pdfCurrency(it.originalUnitPrice || it.unitPrice || 0),
      it.discountApplied ? pdfCurrency((it.originalUnitPrice - it.discountedUnitPrice) * (it.qty ?? 1)) : "—",
      pdfCurrency(it.lineTotal ?? 0),
    ]);
    autoTable(doc, {
      startY: y,
      head: [["Item Name", "Qty", "Unit Price", "Discount", "Line Total"]],
      body: rows,
      headStyles: { fillColor: primaryColor, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 249, 250] },
      styles: { fontSize: 8, cellPadding: 2 },
      columnStyles: { 1: { halign: "center" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    const subtotal = reservation.subtotal || reservation.totalAmount || 0;
    const delivery = reservation.deliveryFee || 0;
    const total = reservation.totalAmount || 0;
    doc.setFontSize(9);
    doc.text(`Subtotal: ${pdfCurrency(subtotal)}`, pageW - 14, y, { align: "right" });
    doc.text(`Delivery Fee: ${pdfCurrency(delivery)}`, pageW - 14, y + 5, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(`Total: ${pdfCurrency(total)}`, pageW - 14, y + 12, { align: "right" });
    y += 20;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.text(`JOAP Hardware Trading — Confidential | Page ${i} of ${pageCount} | Generated ${format(new Date(), "PPP")}`, pageW / 2, doc.internal.pageSize.getHeight() - 8, { align: "center" });
  }

  doc.save(`reservation-confirmation-${reservation.trackingNumber}.pdf`);
}

// ─── CALENDAR VIEW ────────────────────────────────────────────────────────────

function CalendarView({ reservations, isLoading }: { reservations: any[]; isLoading: boolean }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [detailRes, setDetailRes] = useState<any | null>(null);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDow = getDay(monthStart);

  const byDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    reservations.forEach((r) => {
      if (!r.scheduledDate) return;
      const key = format(new Date(r.scheduledDate), "yyyy-MM-dd");
      if (!map[key]) map[key] = [];
      map[key].push(r);
    });
    return map;
  }, [reservations]);

  const selectedDayRes = selectedDay ? (byDate[format(selectedDay, "yyyy-MM-dd")] || []) : [];

  function DayCell({ day }: { day: Date }) {
    const key = format(day, "yyyy-MM-dd");
    const dayRes = byDate[key] || [];
    const selected = selectedDay && isSameDay(day, selectedDay);
    const today = isToday(day);

    return (
      <div
        onClick={() => setSelectedDay(isSameDay(day, selectedDay!) ? null : day)}
        className={cn(
          "min-h-[80px] p-1.5 border border-border rounded-md cursor-pointer transition-all hover:bg-accent/50",
          today && "bg-primary/5 ring-1 ring-primary",
          selected && "ring-2 ring-primary bg-primary/10",
        )}
      >
        <p className={cn("text-xs mb-1 w-6 h-6 flex items-center justify-center rounded-full",
          today ? "bg-primary text-primary-foreground font-bold" : dayRes.length > 0 ? "font-bold" : "text-muted-foreground"
        )}>
          {format(day, "d")}
        </p>
        <div className="space-y-0.5">
          {dayRes.slice(0, 3).map((r) => (
            <div
              key={r._id}
              onClick={(e) => { e.stopPropagation(); setDetailRes(r); }}
              className={cn(
                "text-[9px] truncate px-1 py-0.5 rounded cursor-pointer hover:opacity-80",
                r.orderType === "online_reservation" ? "bg-blue-100 text-blue-800" : "bg-teal-100 text-teal-800"
              )}
            >
              {r.customerName}
            </div>
          ))}
          {dayRes.length > 3 && (
            <div className="text-[9px] text-muted-foreground px-1">+{dayRes.length - 3} more</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold min-w-[160px] text-center">{format(currentMonth, "MMMM yyyy")}</h2>
          <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCurrentMonth(new Date())}>Today</Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
          ))}
          {Array.from({ length: startDow }).map((_, i) => <div key={`pad-${i}`} />)}
          {days.map((day) => <DayCell key={format(day, "yyyy-MM-dd")} day={day} />)}
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-xs">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-100 border border-blue-300" />Online Reservation</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-teal-100 border border-teal-300" />Walk-in Reservation</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-300" />Unpaid</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-300" />Cancelled</span>
      </div>

      {selectedDay && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Reservations for {format(selectedDay, "EEEE, MMMM d, yyyy")}</span>
              <Badge variant="outline">{selectedDayRes.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedDayRes.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No reservations scheduled for this day.</p>
            ) : (
              <div className="space-y-3">
                {selectedDayRes.map((r) => (
                  <DayResCard key={r._id} r={r} onViewDetail={() => setDetailRes(r)} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {detailRes && (
        <ReservationDetailDrawer reservation={detailRes} onClose={() => setDetailRes(null)} />
      )}
    </div>
  );
}

function DayResCard({ r, onViewDetail }: { r: any; onViewDetail: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const confirmMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/reservations/${r._id}/status`, { fulfillmentStatus: "processing" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
      toast({ title: "Reservation confirmed" });
    },
  });
  const completeMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/reservations/${r._id}/status`, { fulfillmentStatus: "completed" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
      toast({ title: "Reservation completed" });
    },
  });

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{r.customerName}</p>
          <p className="text-xs text-muted-foreground font-mono">{r.trackingNumber}</p>
        </div>
        <div className="flex flex-wrap gap-1 justify-end">
          <StatusBadge status={r.orderType} size="xs" />
          <StatusBadge status={r.paymentStatus} size="xs" />
          <StatusBadge status={r.fulfillmentStatus} size="xs" />
        </div>
      </div>
      {r.scheduledDate && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {format(new Date(r.scheduledDate), "h:mm a") !== "12:00 AM"
            ? format(new Date(r.scheduledDate), "h:mm a")
            : "Time not specified"}
        </p>
      )}
      {r.items?.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {r.items.slice(0, 3).map((it: any) => `${it.itemName} ×${it.qty ?? 1}`).join(", ")}
          {r.items.length > 3 && ` +${r.items.length - 3} more`}
        </p>
      )}
      <p className="text-sm font-semibold">{formatPHP(r.totalAmount || 0)}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onViewDetail}>
          <Eye className="h-3 w-3 mr-1" />View Details
        </Button>
        {r.fulfillmentStatus === "pending" && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
            <CheckCircle2 className="h-3 w-3 mr-1" />Confirm
          </Button>
        )}
        {r.fulfillmentStatus !== "completed" && r.fulfillmentStatus !== "cancelled" && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending}>
            <Check className="h-3 w-3 mr-1" />Complete
          </Button>
        )}
        {r.customerPhone && (
          <a href={`tel:${r.customerPhone}`}>
            <Button size="sm" variant="outline" className="h-7 text-xs">
              <Phone className="h-3 w-3 mr-1" />Call
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}

// ─── LIST VIEW ────────────────────────────────────────────────────────────────

function ListView({ reservations, isLoading }: { reservations: any[]; isLoading: boolean }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [detailRes, setDetailRes] = useState<any | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const PAGE_SIZE = 15;

  const filtered = useMemo(() => {
    return reservations.filter((r) => {
      const s = search.toLowerCase();
      const matchSearch = !search ||
        r.customerName?.toLowerCase().includes(s) ||
        r.trackingNumber?.toLowerCase().includes(s) ||
        r.customerPhone?.toLowerCase().includes(s);
      const matchType = typeFilter === "all" || r.orderType === typeFilter;
      const matchStatus = statusFilter === "all" || r.fulfillmentStatus === statusFilter;
      const matchPayment = paymentFilter === "all" || r.paymentStatus === paymentFilter;
      return matchSearch && matchType && matchStatus && matchPayment;
    });
  }, [reservations, search, typeFilter, statusFilter, paymentFilter]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  function toggleSelect(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function clearFilters() {
    setSearch(""); setTypeFilter("all"); setStatusFilter("all"); setPaymentFilter("all"); setPage(1);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search customer, phone, tracking #…" className="pl-9" value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }} data-testid="input-res-search" />
        </div>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="online_reservation">Online Reservation</SelectItem>
            <SelectItem value="walkin_reservation">Walk-in Reservation</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Confirmed</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={paymentFilter} onValueChange={(v) => { setPaymentFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Payment" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Payment</SelectItem>
            <SelectItem value="pending_payment">Unpaid</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
          </SelectContent>
        </Select>
        {(search || typeFilter !== "all" || statusFilter !== "all" || paymentFilter !== "all") && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
            <X className="h-4 w-4 mr-1" />Clear
          </Button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg p-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={async () => {
            for (const id of Array.from(selected)) {
              await apiRequest("PATCH", `/api/reservations/${id}/status`, { fulfillmentStatus: "processing" });
            }
            queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
            setSelected(new Set());
            toast({ title: `${selected.size} reservations confirmed` });
          }}>Confirm All</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={async () => {
            for (const id of Array.from(selected)) {
              await apiRequest("PATCH", `/api/reservations/${id}/status`, { fulfillmentStatus: "ready" });
            }
            queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
            setSelected(new Set());
            toast({ title: `${selected.size} reservations marked ready` });
          }}>Mark All Ready</Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <CalendarCheck className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-muted-foreground font-medium">No reservations found</p>
          <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 w-8"><input type="checkbox" checked={selected.size === paged.length && paged.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) setSelected(new Set(paged.map((r) => r._id)));
                      else setSelected(new Set());
                    }} /></th>
                  <th className="p-3 text-left font-medium">Customer</th>
                  <th className="p-3 text-left font-medium">Tracking #</th>
                  <th className="p-3 text-left font-medium">Type</th>
                  <th className="p-3 text-left font-medium">Scheduled</th>
                  <th className="p-3 text-left font-medium">Items</th>
                  <th className="p-3 text-right font-medium">Total</th>
                  <th className="p-3 text-left font-medium">Payment</th>
                  <th className="p-3 text-left font-medium">Status</th>
                  <th className="p-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr key={r._id} className="border-b hover:bg-muted/30 transition-colors" data-testid={`row-res-${r._id}`}>
                    <td className="p-3"><input type="checkbox" checked={selected.has(r._id)} onChange={() => toggleSelect(r._id)} /></td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                          {r.customerName?.charAt(0)?.toUpperCase() || "?"}
                        </div>
                        <div>
                          <p className="font-medium">{r.customerName}</p>
                          {r.customerPhone && <p className="text-xs text-muted-foreground">{r.customerPhone}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <span className="font-mono text-xs">{r.trackingNumber}</span>
                      <CopyButton text={r.trackingNumber} />
                    </td>
                    <td className="p-3"><StatusBadge status={r.orderType} /></td>
                    <td className="p-3 text-xs">
                      {r.scheduledDate
                        ? format(new Date(r.scheduledDate), "EEE, MMM d yyyy")
                        : <span className="text-muted-foreground">Date TBD</span>}
                    </td>
                    <td className="p-3">
                      <Tooltip>
                        <TooltipTrigger>
                          <Badge variant="secondary">{r.items?.length ?? 0} items</Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="text-xs space-y-0.5 max-w-[200px]">
                            {r.items?.map((it: any, i: number) => (
                              <p key={i}>{it.itemName} ×{it.qty ?? 1}</p>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </td>
                    <td className="p-3 text-right font-medium">{formatPHP(r.totalAmount || 0)}</td>
                    <td className="p-3"><StatusBadge status={r.paymentStatus} /></td>
                    <td className="p-3"><StatusBadge status={r.fulfillmentStatus} /></td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setDetailRes(r)} data-testid={`button-view-res-${r._id}`}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => generatePDF(r)} data-testid={`button-print-res-${r._id}`}>
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const pg = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                  return (
                    <Button key={pg} variant={page === pg ? "default" : "outline"} size="sm" className="h-8 w-8 p-0" onClick={() => setPage(pg)}>
                      {pg}
                    </Button>
                  );
                })}
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {detailRes && (
        <ReservationDetailDrawer reservation={detailRes} onClose={() => setDetailRes(null)} />
      )}
    </div>
  );
}

// ─── STATS SIDEBAR ────────────────────────────────────────────────────────────

function StatsSidebar({ reservations }: { reservations: any[] }) {
  const now = new Date();
  const todayRes = reservations.filter((r) => r.scheduledDate && isSameDay(new Date(r.scheduledDate), now));
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const thisWeek = reservations.filter((r) => r.scheduledDate && new Date(r.scheduledDate) >= weekStart && new Date(r.scheduledDate) <= weekEnd);
  const monthStart2 = startOfMonth(now); const monthEnd2 = endOfMonth(now);
  const thisMonth = reservations.filter((r) => r.scheduledDate && new Date(r.scheduledDate) >= monthStart2 && new Date(r.scheduledDate) <= monthEnd2);
  const unpaid = reservations.filter((r) => r.paymentStatus === "pending_payment" || r.paymentStatus === "partial");
  const unpaidAmt = unpaid.reduce((s, r) => s + (r.totalAmount || 0), 0);
  const next7 = new Date(now.getTime() + 7 * 86400000);
  const upcoming7 = reservations.filter((r) => r.scheduledDate && new Date(r.scheduledDate) > now && new Date(r.scheduledDate) <= next7)
    .sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime());

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="text-sm">
            <p className="font-semibold text-lg">{todayRes.length}</p>
            <p className="text-xs text-muted-foreground">Today's Reservations</p>
            {todayRes.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {todayRes.slice(0, 3).map((r) => <p key={r._id} className="text-xs truncate text-muted-foreground">{r.customerName}</p>)}
              </div>
            )}
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><p className="font-semibold">{thisWeek.length}</p><p className="text-xs text-muted-foreground">This Week</p></div>
            <div><p className="font-semibold">{thisMonth.length}</p><p className="text-xs text-muted-foreground">This Month</p></div>
          </div>
          <Separator />
          <div className="text-sm">
            <p className="font-semibold text-amber-600">{unpaid.length}</p>
            <p className="text-xs text-muted-foreground">Pending Payment</p>
            {unpaid.length > 0 && <p className="text-xs text-amber-600 font-medium">{formatPHP(unpaidAmt)}</p>}
          </div>
        </CardContent>
      </Card>

      {upcoming7.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Next 7 Days</CardTitle></CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            {upcoming7.slice(0, 5).map((r) => (
              <div key={r._id} className="flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <p className="font-medium truncate">{r.customerName}</p>
                  <p className="text-muted-foreground">{format(new Date(r.scheduledDate), "EEE, MMM d")}</p>
                </div>
                <StatusBadge status={r.orderType} size="xs" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── RESERVATION DETAIL DRAWER ────────────────────────────────────────────────

function ReservationDetailDrawer({ reservation: initialRes, onClose }: { reservation: any; onClose: () => void }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [noteText, setNoteText] = useState("");
  const [editingStatus, setEditingStatus] = useState<string | null>(null);

  const { data: resData } = useQuery<{ success: boolean; data: any }>({
    queryKey: ["/api/reservations", initialRes._id],
    queryFn: () => apiRequest("GET", `/api/reservations/${initialRes._id}`).then((r) => r.json()),
  });

  const reservation = resData?.data || initialRes;

  const statusMutation = useMutation({
    mutationFn: (body: any) => apiRequest("PATCH", `/api/reservations/${reservation._id}/status`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reservations", reservation._id] });
      toast({ title: "Status updated" });
      setEditingStatus(null);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const noteMutation = useMutation({
    mutationFn: (note: string) => apiRequest("POST", `/api/reservations/${reservation._id}/notes`, { note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations", reservation._id] });
      toast({ title: "Note added" });
      setNoteText("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/reservations/${reservation._id}/status`, { fulfillmentStatus: "cancelled" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
      toast({ title: "Reservation cancelled" });
      onClose();
    },
  });

  const [deletePasswordOpen, setDeletePasswordOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletePasswordError, setDeletePasswordError] = useState("");

  const deleteMutation = useMutation({
    mutationFn: async () => {
      // Verify password first
      const verifyRes = await apiRequest("POST", "/api/auth/verify-password", { password: deletePassword });
      if (!verifyRes.ok) throw new Error("Incorrect password");
      const deleteRes = await apiRequest("DELETE", `/api/reservations/${reservation._id}`);
      if (!deleteRes.ok) { const e = await deleteRes.json(); throw new Error(e?.message || "Delete failed"); }
      return deleteRes.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
      toast({ title: "Reservation deleted" });
      setDeletePasswordOpen(false);
      onClose();
    },
    onError: (err: Error) => {
      setDeletePasswordError(err.message);
    },
  });

  const hasSavings = reservation.items?.some((it: any) => it.discountApplied);

  function StatusDropdown({ field, value, options }: { field: string; value: string; options: Record<string, string> }) {
    const isEditing = editingStatus === field;
    return (
      <div className="relative">
        <div
          className="cursor-pointer"
          onClick={() => setEditingStatus(isEditing ? null : field)}
        >
          <StatusBadge status={value} />
          <ChevronDown className="inline h-3 w-3 ml-1 text-muted-foreground" />
        </div>
        {isEditing && (
          <div className="absolute top-full left-0 z-50 mt-1 bg-popover border rounded-md shadow-lg min-w-[160px]">
            {Object.entries(options).map(([k, v]) => (
              <button key={k} className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                onClick={() => statusMutation.mutate({ [field]: k })}>
                {v}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Sheet open onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-[680px] overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xl font-bold">{reservation.customerName}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="font-mono text-sm text-muted-foreground">{reservation.trackingNumber}</span>
                <CopyButton text={reservation.trackingNumber} />
              </div>
              {reservation.createdAt && (
                <p className="text-xs text-muted-foreground mt-0.5">Created {format(new Date(reservation.createdAt), "MMM d, yyyy")}</p>
              )}
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => { onClose(); navigate(`/orders/${reservation._id}`); }}>
              Open Full Order ↗
            </Button>
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="text-xs text-muted-foreground">Type:</div>
            <StatusDropdown field="orderType" value={reservation.orderType} options={ORDER_TYPE_LABEL} />
            <div className="text-xs text-muted-foreground">Fulfillment:</div>
            <StatusDropdown field="fulfillmentStatus" value={reservation.fulfillmentStatus}
              options={{ pending: "Pending", processing: "Confirmed", ready: "Ready", completed: "Completed", cancelled: "Cancelled" }} />
            <div className="text-xs text-muted-foreground">Payment:</div>
            <StatusDropdown field="paymentStatus" value={reservation.paymentStatus}
              options={{ pending_payment: "Unpaid", partial: "Partial", paid: "Paid" }} />
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Reservation Details</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="grid grid-cols-2 gap-y-2">
                <span className="text-muted-foreground">Scheduled</span>
                <span>{reservation.scheduledDate ? format(new Date(reservation.scheduledDate), "EEE, MMM d yyyy · h:mm a") : "Not set"}</span>
                <span className="text-muted-foreground">Channel</span>
                <span>{reservation.orderChannel || "N/A"}</span>
                <span className="text-muted-foreground">Payment Method</span>
                <span>{reservation.paymentMethod || "N/A"}</span>
                <span className="text-muted-foreground">Delivery Fee</span>
                <span>{formatPHP(reservation.deliveryFee || 0)}</span>
                {reservation.notes && (
                  <>
                    <span className="text-muted-foreground">Notes</span>
                    <span className="text-sm">{reservation.notes}</span>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {reservation.customerName && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Customer Info</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1">
                <p className="font-medium">{reservation.customerName}</p>
                {reservation.customerPhone && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" />{reservation.customerPhone}
                  </p>
                )}
                {reservation.address?.street && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    {[reservation.address.street, reservation.address.city, reservation.address.province].filter(Boolean).join(", ")}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {reservation.items?.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Items Ordered</CardTitle></CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-2 text-left font-medium">Item</th>
                      <th className="p-2 text-center font-medium">Qty</th>
                      <th className="p-2 text-right font-medium">Unit Price</th>
                      <th className="p-2 text-right font-medium">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reservation.items.map((it: any, i: number) => (
                      <tr key={i} className="border-b">
                        <td className="p-2">
                          <p>{it.itemName}</p>
                          {it.discountApplied && <span className="text-xs text-green-600">Offer: {it.offerName}</span>}
                        </td>
                        <td className="p-2 text-center">{it.qty ?? it.quantity ?? 1}</td>
                        <td className="p-2 text-right">
                          {it.discountApplied ? (
                            <span>
                              <span className="line-through text-muted-foreground text-xs mr-1">{formatPHP(it.originalUnitPrice)}</span>
                              {formatPHP(it.discountedUnitPrice)}
                            </span>
                          ) : formatPHP(it.originalUnitPrice || it.unitPrice || 0)}
                        </td>
                        <td className="p-2 text-right">{formatPHP(it.lineTotal ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="p-3 text-right space-y-1 text-sm">
                  <p>Subtotal: <span className="font-medium">{formatPHP(reservation.subtotal || 0)}</span></p>
                  {hasSavings && (
                    <p className="text-green-600">
                      Savings: <span className="font-medium">
                        -{formatPHP(reservation.items.reduce((s: number, it: any) =>
                          s + (it.discountApplied ? (it.originalUnitPrice - it.discountedUnitPrice) * (it.qty ?? 1) : 0), 0))}
                      </span>
                    </p>
                  )}
                  <p className="font-bold">Total: {formatPHP(reservation.totalAmount || 0)}</p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><StickyNote className="h-4 w-4" />Notes & Communication</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(!reservation.notesHistory || reservation.notesHistory.length === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-2">No notes yet. Add the first note below.</p>
              ) : (
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {[...reservation.notesHistory].reverse().map((n: any, i: number) => (
                    <div key={i} className="bg-muted/40 rounded-lg p-2.5">
                      <p className="text-sm">{n.note}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />{n.addedBy}
                        <span>·</span>
                        <Tooltip>
                          <TooltipTrigger>
                            <span>{formatDistanceToNow(new Date(n.addedAt), { addSuffix: true })}</span>
                          </TooltipTrigger>
                          <TooltipContent>{format(new Date(n.addedAt), "PPp")}</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                <Textarea placeholder="Add a note…" value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2} />
                <Button size="sm" onClick={() => noteText.trim() && noteMutation.mutate(noteText.trim())} disabled={!noteText.trim() || noteMutation.isPending}>
                  {noteMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                  Add Note
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => generatePDF(reservation)}>
              <Printer className="h-4 w-4 mr-2" />Print Confirmation
            </Button>
            {reservation.fulfillmentStatus !== "cancelled" && reservation.fulfillmentStatus !== "completed" && (
              <Button variant="outline" className="text-destructive border-destructive hover:bg-destructive/10"
                onClick={() => { if (window.confirm("Cancel this reservation?")) cancelMutation.mutate(); }}>
                <Ban className="h-4 w-4 mr-2" />Cancel Reservation
              </Button>
            )}
            {reservation.fulfillmentStatus === "cancelled" && (
              <Button variant="destructive" size="sm"
                onClick={() => { setDeletePassword(""); setDeletePasswordError(""); setDeletePasswordOpen(true); }}>
                <Trash2 className="h-4 w-4 mr-2" />Delete Permanently
              </Button>
            )}
          </div>

          {/* Delete confirmation dialog */}
          <Dialog open={deletePasswordOpen} onOpenChange={(v) => { if (!v) { setDeletePasswordOpen(false); setDeletePassword(""); setDeletePasswordError(""); } }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="text-destructive flex items-center gap-2">
                  <Trash2 className="h-4 w-4" />Delete Cancelled Reservation
                </DialogTitle>
                <DialogDescription>This action is permanent and cannot be undone. Enter your admin password to confirm deletion of <strong>{reservation.trackingNumber}</strong>.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <input
                  type="password"
                  placeholder="Your admin password"
                  value={deletePassword}
                  onChange={(e) => { setDeletePassword(e.target.value); setDeletePasswordError(""); }}
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  data-testid="input-delete-res-password"
                />
                {deletePasswordError && <p className="text-sm text-destructive">{deletePasswordError}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setDeletePasswordOpen(false); setDeletePassword(""); }}>Cancel</Button>
                <Button variant="destructive" disabled={!deletePassword || deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate()} data-testid="button-confirm-delete-res">
                  {deleteMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function ReservationsPage() {
  const [, params] = useLocation();
  const urlParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const defaultTab = urlParams.get("tab") || "calendar";
  const [createResOpen, setCreateResOpen] = useState(false);

  const { data, isLoading } = useQuery<{ success: boolean; data: any[] }>({
    queryKey: ["/api/reservations"],
    queryFn: () => apiRequest("GET", "/api/reservations").then((r) => r.json()),
  });

  const { data: itemsData } = useQuery<{ success: boolean; data: IItem[] }>({
    queryKey: ["/api/items/all"],
  });
  const allItems = itemsData?.data || [];

  const reservations = data?.data || [];
  const upcomingCount = reservations.filter((r) => r.scheduledDate && isFuture(new Date(r.scheduledDate)) &&
    r.fulfillmentStatus !== "completed" && r.fulfillmentStatus !== "cancelled").length;
  const pendingCount = reservations.filter((r) => r.fulfillmentStatus === "pending").length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <CreateReservationDialog open={createResOpen} onClose={() => setCreateResOpen(false)} allItems={allItems} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-reservations-title">
              <CalendarCheck className="h-6 w-6 text-primary" />Reservations
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Manage all scheduled reservations</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => setCreateResOpen(true)} data-testid="button-new-reservation">
              <Plus className="h-4 w-4 mr-2" />New Reservation
            </Button>
            {pendingCount > 0 && (
              <div className="flex items-center gap-1.5 text-sm bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-3 py-1.5">
                <AlertCircle className="h-4 w-4" />
                {pendingCount} pending confirmation
              </div>
            )}
            <div className="flex items-center gap-1.5 text-sm bg-blue-50 text-blue-800 border border-blue-200 rounded-lg px-3 py-1.5">
              <CalendarDays className="h-4 w-4" />
              {upcomingCount} upcoming
            </div>
          </div>
        </div>

        <Tabs defaultValue={defaultTab}>
          <TabsList>
            <TabsTrigger value="calendar" data-testid="tab-calendar">
              <CalendarDays className="h-4 w-4 mr-2" />Calendar View
            </TabsTrigger>
            <TabsTrigger value="list" data-testid="tab-list">
              <Filter className="h-4 w-4 mr-2" />List View
            </TabsTrigger>
          </TabsList>

          <TabsContent value="calendar" className="mt-4">
            <CalendarView reservations={reservations} isLoading={isLoading} />
          </TabsContent>

          <TabsContent value="list" className="mt-4">
            <div className="flex gap-4">
              <div className="flex-1 min-w-0">
                <ListView reservations={reservations} isLoading={isLoading} />
              </div>
              <div className="hidden lg:block w-[220px] shrink-0">
                <StatsSidebar reservations={reservations} />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
