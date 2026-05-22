import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation } from "wouter";
import {
  Plus, Search, Loader2, ShoppingCart, Trash2, MapPin, UserCheck, Package,
  AlertCircle, ChevronRight, Sun, Moon, Sunset, Filter, ChevronLeft,
  CheckSquare, Tag, Info,
} from "lucide-react";
import {
  createOrderSchema, type CreateOrderInput, type IOrder, type IItem, type IOrderItem,
  ALLOWED_PAYMENT_METHODS, ORDER_TYPE_LABELS, ORDER_CHANNEL_LABELS,
  PAYMENT_STATUS_LABELS, PAYMENT_METHOD_LABELS, FULFILLMENT_STATUS_LABELS,
  ORDER_TYPES, ORDER_CHANNELS, PAYMENT_STATUSES, PAYMENT_METHODS, FULFILLMENT_STATUSES,
  type OrderType, type PaymentMethod,
} from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type OrderItemLocal = { itemId: string; itemName: string; qty: number; originalUnitPrice: number; discountedUnitPrice: number; discountApplied: boolean; offerName: string; lineTotal: number };

function OrderTableRow({ order, selected, onSelect, onNavigate, allUsers, onAssign }: {
  order: IOrder; selected: boolean; onSelect: () => void; onNavigate: () => void;
  allUsers: SimpleUser[]; onAssign: (username: string) => void;
}) {
  const [assignVal, setAssignVal] = useState(order.assignedTo || "");
  return (
    <TableRow className="group" data-testid={`row-order-${order._id}`}>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={onSelect} data-testid={`checkbox-order-${order._id}`} />
      </TableCell>
      <TableCell className="font-medium font-mono text-sm cursor-pointer" onClick={onNavigate}>{order.trackingNumber}</TableCell>
      <TableCell className="cursor-pointer" onClick={onNavigate}>{order.customerName}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{ORDER_TYPE_LABELS[order.orderType] || order.orderType}</TableCell>
      <TableCell><PaymentBadge status={order.paymentStatus} /></TableCell>
      <TableCell><FulfillmentBadge status={order.fulfillmentStatus} /></TableCell>
      <TableCell className="text-right cursor-pointer" onClick={onNavigate}>{formatCurrency(order.totalAmount)}</TableCell>
      <TableCell className="text-muted-foreground text-sm">{formatDate(order.createdAt)}</TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Select value={assignVal} onValueChange={(v) => { setAssignVal(v); onAssign(v); }}>
          <SelectTrigger className="h-7 text-xs w-[130px]" data-testid={`select-assign-order-${order._id}`}><SelectValue placeholder="Assign..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__unassign__">— Unassign —</SelectItem>
            {allUsers.map((u) => <SelectItem key={u.username} value={u.username}>{u.username}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>
    </TableRow>
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
  return <Badge className={colorMap[status] || "bg-gray-400 text-white border-transparent"}>{status}</Badge>;
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
    refunded: "bg-red-400 text-white border-transparent",
  };
  return <Badge className={`text-xs ${map[status] || "bg-gray-400 text-white border-transparent"}`}>{PAYMENT_STATUS_LABELS[status as keyof typeof PAYMENT_STATUS_LABELS] || status}</Badge>;
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

function CreateOrderDialog({ open, onClose, allItems }: { open: boolean; onClose: () => void; allItems: IItem[] }) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [orderItems, setOrderItems] = useState<OrderItemLocal[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [itemQty, setItemQty] = useState(1);
  const [showAddress, setShowAddress] = useState(false);
  const [itemSearch, setItemSearch] = useState("");

  const form = useForm<CreateOrderInput>({
    resolver: zodResolver(createOrderSchema),
    defaultValues: {
      customerId: "",
      customerName: "",
      orderType: "walkin_pickup",
      orderChannel: "walkin",
      paymentStatus: "pending_payment",
      paymentMethod: "cash",
      fulfillmentStatus: "pending",
      deliveryFee: 0,
      items: [],
      notes: "",
      scheduledDate: "",
    },
  });

  const orderType = form.watch("orderType") as OrderType;
  const allowedMethods = ALLOWED_PAYMENT_METHODS[orderType] || [];

  const createMutation = useMutation({
    mutationFn: async (data: CreateOrderInput) => {
      const res = await apiRequest("POST", "/api/orders", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      onClose();
      form.reset();
      setOrderItems([]);
      setStep(0);
      toast({ title: "Order created successfully" });
    },
    onError: (err: Error) => toast({ title: "Failed to create order", description: err.message, variant: "destructive" }),
  });

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

  function handleNext() {
    if (step === 0) {
      const fields = ["customerName", "orderType", "orderChannel"] as const;
      form.trigger(fields).then((ok) => { if (ok) setStep(1); });
    } else if (step === 1) {
      if (orderItems.length === 0) { toast({ title: "Add at least one item", variant: "destructive" }); return; }
      setStep(2);
    } else if (step === 2) {
      const fields = ["paymentMethod", "paymentStatus"] as const;
      form.trigger(fields).then((ok) => { if (ok) setStep(3); });
    } else if (step === 3) {
      setStep(4);
    }
  }

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
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setStep(0); setOrderItems([]); form.reset(); } }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5" />Create New Order</DialogTitle>
          <DialogDescription>Step {step + 1} of 5 — {STEP_LABELS[step]}</DialogDescription>
        </DialogHeader>

        {/* Progress bar */}
        <div className="flex gap-1 mb-1">
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
                            const allowed = ALLOWED_PAYMENT_METHODS[type];
                            const current = form.getValues("paymentMethod") as PaymentMethod;
                            if (!allowed.includes(current)) form.setValue("paymentMethod", allowed[0]);
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
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-order-channel"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {ORDER_CHANNELS.map((ch) => <SelectItem key={ch} value={ch}>{ORDER_CHANNEL_LABELS[ch]}</SelectItem>)}
                      </SelectContent>
                    </Select>
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
                    <div className="absolute top-full left-0 right-0 z-50 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto mt-1">
                      {filteredItems.slice(0, 8).map((it) => (
                        <button key={it._id} type="button" className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent text-left"
                          onClick={() => { setSelectedItemId(it._id); setItemSearch(it.itemName); }}
                          data-testid={`option-order-item-${it._id}`}>
                          <span>{it.itemName}</span>
                          <span className="text-muted-foreground text-xs">{formatCurrency(it.unitPrice)} · {it.currentQuantity} avail</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input type="number" min={1} value={itemQty} onChange={(e) => setItemQty(parseInt(e.target.value) || 1)} className="w-24" placeholder="Qty" data-testid="input-order-item-qty" />
                  <Button type="button" variant="secondary" onClick={addItem} disabled={!selectedItemId} data-testid="button-add-order-item">
                    Add Item
                  </Button>
                </div>
                {orderItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm border-2 border-dashed rounded-lg">Search and add items above</div>
                ) : (
                  <div className="space-y-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-center w-16">Qty</TableHead>
                          <TableHead className="text-right">Unit Price</TableHead>
                          <TableHead className="text-right">Subtotal</TableHead>
                          <TableHead className="w-8" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orderItems.map((oi) => (
                          <TableRow key={oi.itemId}>
                            <TableCell className="text-sm">{oi.itemName}</TableCell>
                            <TableCell className="text-center">
                              <Input type="number" min={1} value={oi.qty} className="w-16 h-7 text-sm text-center"
                                onChange={(e) => {
                                  const newQty = parseInt(e.target.value) || 1;
                                  setOrderItems((prev) => prev.map((item) => item.itemId === oi.itemId ? { ...item, qty: newQty, lineTotal: newQty * item.discountedUnitPrice } : item));
                                }} />
                            </TableCell>
                            <TableCell className="text-right text-sm">{formatCurrency(oi.originalUnitPrice)}</TableCell>
                            <TableCell className="text-right text-sm font-medium">{formatCurrency(oi.lineTotal)}</TableCell>
                            <TableCell>
                              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeItem(oi.itemId)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
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
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-payment-status"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {PAYMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{PAYMENT_STATUS_LABELS[s]}</SelectItem>)}
                      </SelectContent>
                    </Select>
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
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-fulfillment-status"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {FULFILLMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{FULFILLMENT_STATUS_LABELS[s]}</SelectItem>)}
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

        <DialogFooter className="gap-2 flex-wrap">
          <div className="flex gap-2 w-full sm:w-auto">
            {step > 0 && <Button type="button" variant="outline" onClick={handleBack} className="flex-1 sm:flex-none" data-testid="button-order-back"><ChevronLeft className="h-4 w-4 mr-1" />Back</Button>}
            {step < 4 ? (
              <Button type="button" onClick={handleNext} className="flex-1 sm:flex-none" data-testid="button-order-next">
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button type="button" onClick={handleSubmit} disabled={createMutation.isPending} className="flex-1 sm:flex-none" data-testid="button-submit-order">
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <ShoppingCart className="h-4 w-4 mr-2" />Create Order
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function OrdersPage() {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [viewUser, setViewUser] = useState("");
  const [filterPaymentStatus, setFilterPaymentStatus] = useState("all");
  const [filterFulfillment, setFilterFulfillment] = useState("all");
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<string>("");

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

  const { data: allItemsData } = useQuery<{ success: boolean; data: IItem[] }>({ queryKey: ["/api/items/all"] });
  const { data: usersData } = useQuery<{ success: boolean; data: SimpleUser[] }>({ queryKey: ["/api/users/simple"], enabled: isAdmin });

  const assignMutation = useMutation({
    mutationFn: async ({ orderId, username, displayName }: { orderId: string; username: string; displayName: string }) => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/assign`, { username, displayName });
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/orders"] }); toast({ title: "Order assigned" }); },
    onError: (err: Error) => toast({ title: "Assignment failed", description: err.message, variant: "destructive" }),
  });

  const bulkMutation = useMutation({
    mutationFn: async ({ orderIds, fulfillmentStatus }: { orderIds: string[]; fulfillmentStatus: string }) => {
      const res = await apiRequest("POST", "/api/orders/bulk-status", { orderIds, fulfillmentStatus, reason: "Bulk update" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setSelectedOrderIds([]);
      setBulkOpen(false);
      toast({ title: `${selectedOrderIds.length} orders updated` });
    },
    onError: (err: Error) => toast({ title: "Bulk update failed", description: err.message, variant: "destructive" }),
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

  const filteredOrders = useMemo(() => {
    let res = orders;
    if (filterPaymentStatus !== "all") res = res.filter((o) => o.paymentStatus === filterPaymentStatus);
    if (filterFulfillment !== "all") res = res.filter((o) => o.fulfillmentStatus === filterFulfillment);
    if (search) res = res.filter((o) => o.trackingNumber.toLowerCase().includes(search.toLowerCase()) || o.customerName.toLowerCase().includes(search.toLowerCase()));
    return res;
  }, [orders, filterPaymentStatus, filterFulfillment, search]);

  const allSelected = filteredOrders.length > 0 && filteredOrders.every((o) => selectedOrderIds.includes(o._id));
  function toggleAll() {
    if (allSelected) setSelectedOrderIds([]);
    else setSelectedOrderIds(filteredOrders.map((o) => o._id));
  }
  function toggleOne(id: string) {
    setSelectedOrderIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 space-y-4 overflow-auto h-full">
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
              {myPendingAssigned.map((order) => (
                <Card key={order._id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate(`/orders/${order._id}`)}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5 flex-1">
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
                        </div>
                        {order.notes && <p className="text-xs text-muted-foreground">Note: {order.notes}</p>}
                        <div className="flex flex-wrap gap-1">
                          {order.items.slice(0, 3).map((item, i) => (
                            <Badge key={i} variant="outline" className="text-xs">{item.itemName} ×{item.qty}</Badge>
                          ))}
                          {order.items.length > 3 && <Badge variant="outline" className="text-xs">+{order.items.length - 3} more</Badge>}
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1" />
                    </div>
                  </CardContent>
                </Card>
              ))}
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
          )}
        </div>

        <Separator />

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
            <Input placeholder="Search orders..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-orders" />
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
                  {filteredOrders.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No orders found</TableCell></TableRow>
                  ) : filteredOrders.map((order) => (
                    <TableRow key={order._id} className="cursor-pointer" onClick={() => !hasPendingAssigned && navigate(`/orders/${order._id}`)} data-testid={`row-pool-order-${order._id}`}>
                      <TableCell className="font-medium font-mono text-sm">{order.trackingNumber}</TableCell>
                      <TableCell>{order.customerName}</TableCell>
                      <TableCell className="text-right">{formatCurrency(order.totalAmount)}</TableCell>
                      <TableCell><StatusBadge status={order.currentStatus} /></TableCell>
                      <TableCell className="text-muted-foreground text-sm">{formatDate(order.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ─── ADMIN VIEW ──────────────────────────────────────────────────
  return (
    <div className="p-3 sm:p-6 space-y-4 overflow-auto h-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-orders-title">Orders</h1>
        <div className="flex gap-2">
          {selectedOrderIds.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)} data-testid="button-bulk-update">
              <CheckSquare className="h-4 w-4 mr-1" />{selectedOrderIds.length} selected
            </Button>
          )}
          <Button onClick={() => setCreateOpen(true)} data-testid="button-create-order">
            <Plus className="mr-1 h-4 w-4" />Create Order
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search orders..." className="pl-9 h-8" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-orders" />
        </div>
        <Select value={filterPaymentStatus} onValueChange={setFilterPaymentStatus}>
          <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-filter-payment-status">
            <SelectValue placeholder="Payment Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Payment</SelectItem>
            {PAYMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{PAYMENT_STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterFulfillment} onValueChange={setFilterFulfillment}>
          <SelectTrigger className="w-[165px] h-8 text-xs" data-testid="select-filter-fulfillment">
            <SelectValue placeholder="Fulfillment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Fulfillment</SelectItem>
            {FULFILLMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{FULFILLMENT_STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        {(filterPaymentStatus !== "all" || filterFulfillment !== "all" || search) && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFilterPaymentStatus("all"); setFilterFulfillment("all"); setSearch(""); }}>
            Clear
          </Button>
        )}
      </div>

      {/* Orders Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} data-testid="checkbox-select-all-orders" />
                  </TableHead>
                  <TableHead>Tracking #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Fulfillment</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Assign To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No orders found</TableCell></TableRow>
                ) : filteredOrders.map((order) => (
                  <OrderTableRow
                    key={order._id}
                    order={order}
                    selected={selectedOrderIds.includes(order._id)}
                    onSelect={() => toggleOne(order._id)}
                    onNavigate={() => navigate(`/orders/${order._id}`)}
                    allUsers={allUsers}
                    onAssign={(username) => { const found = allUsers.find((u) => u.username === username); assignMutation.mutate({ orderId: order._id, username: username === "__unassign__" ? "" : username, displayName: found?.username || "" }); }}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="px-4 py-2 border-t text-xs text-muted-foreground">
            Showing {filteredOrders.length} of {orders.length} orders
          </div>
        </CardContent>
      </Card>

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
            <Select value={viewUser && employees.find((u) => u.username === viewUser) ? viewUser : ""} onValueChange={setViewUser}>
              <SelectTrigger className="w-[180px]" data-testid="select-view-employee"><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {employees.length === 0 ? <div className="px-2 py-1.5 text-xs text-muted-foreground">No employees</div> : employees.map((u) => <SelectItem key={u.username} value={u.username}>{u.username}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">Admin</p>
            <Select value={viewUser && admins.find((u) => u.username === viewUser) ? viewUser : ""} onValueChange={setViewUser}>
              <SelectTrigger className="w-[180px]" data-testid="select-view-admin"><SelectValue placeholder="Select admin" /></SelectTrigger>
              <SelectContent>
                {admins.map((u) => <SelectItem key={u.username} value={u.username}>{u.username} {u.username === user?.username ? "(you)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {viewUser && <div className="flex items-end"><Button variant="ghost" size="sm" onClick={() => setViewUser("")}>Clear</Button></div>}
        </div>
        {viewUser && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Assigned — Not Completed</span>
                {viewUserAssigned.length > 0 && <Badge variant="outline">{viewUserAssigned.length}</Badge>}
              </div>
              {viewUserAssigned.length === 0 ? <p className="text-sm text-muted-foreground pl-1">No pending assigned orders.</p> : (
                <div className="space-y-2">
                  {viewUserAssigned.map((order) => (
                    <Card key={order._id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate(`/orders/${order._id}`)}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1.5 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-semibold text-sm">{order.trackingNumber}</span>
                              <PaymentBadge status={order.paymentStatus} />
                              <FulfillmentBadge status={order.fulfillmentStatus} />
                            </div>
                            <p className="font-medium">{order.customerName}</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span>Total: <strong className="text-foreground">{formatCurrency(order.totalAmount)}</strong></span>
                              <span>Type: <strong className="text-foreground">{ORDER_TYPE_LABELS[order.orderType] || order.orderType}</strong></span>
                              <span>Created: <strong className="text-foreground">{fmt12(order.createdAt)}</strong></span>
                              {order.assignedAt && <span>Assigned: <strong className="text-foreground">{fmt12(order.assignedAt)}</strong></span>}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {order.items.slice(0, 3).map((item, i) => (
                                <Badge key={i} variant="outline" className="text-xs">{item.itemName} ×{item.qty}</Badge>
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
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Completed</span>
                {viewUserCompleted.length > 0 && <Badge variant="outline">{viewUserCompleted.length}</Badge>}
              </div>
              {viewUserCompleted.length === 0 ? <p className="text-sm text-muted-foreground pl-1">No completed orders yet.</p> : (
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

      {/* Dialogs */}
      <CreateOrderDialog open={createOpen} onClose={() => setCreateOpen(false)} allItems={allItems} />

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Bulk Update — {selectedOrderIds.length} Orders</DialogTitle>
            <DialogDescription>Update fulfillment status for selected orders.</DialogDescription>
          </DialogHeader>
          <Select value={bulkStatus} onValueChange={setBulkStatus}>
            <SelectTrigger data-testid="select-bulk-status"><SelectValue placeholder="Choose new fulfillment status" /></SelectTrigger>
            <SelectContent>
              {FULFILLMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{FULFILLMENT_STATUS_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button disabled={!bulkStatus || bulkMutation.isPending} onClick={() => bulkMutation.mutate({ orderIds: selectedOrderIds, fulfillmentStatus: bulkStatus })} data-testid="button-confirm-bulk-update">
              {bulkMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
