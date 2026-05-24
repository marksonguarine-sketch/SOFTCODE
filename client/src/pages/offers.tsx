import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format, differenceInDays } from "date-fns";
import {
  Tag, Plus, Pencil, Eye, Copy, Trash2, ToggleLeft, ToggleRight,
  Search, Loader2, AlertCircle, TrendingUp, Zap, Clock, ChevronDown,
} from "lucide-react";
import { createOfferSchema, type CreateOfferInput, type IOffer, type IItem, OFFER_TYPE_LABELS, type OfferType } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch as SwitchUI } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";

const OFFER_TYPE_COLORS: Record<OfferType, string> = {
  percentage_discount: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  b1t1: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  buy1_take_percentage: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  flat_discount: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

const OFFER_TYPE_DESCRIPTIONS: Record<OfferType, string> = {
  percentage_discount: "Set a % discount per item (each item can have a different %)",
  b1t1: "Customer pays for 1, gets the second of the same item free",
  buy1_take_percentage: "Second item in each pair costs less by your chosen %",
  flat_discount: "Fixed ₱ amount off per unit of each selected item",
};

function formatPHP(v: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v);
}

function getDaysRemaining(endDate: string) {
  const diff = differenceInDays(new Date(endDate), new Date());
  if (diff < 0) return "Expired";
  if (diff === 0) return "Ends today!";
  return `${diff} day${diff !== 1 ? "s" : ""} left`;
}

function OfferTypeBadge({ type }: { type: string }) {
  const label = OFFER_TYPE_LABELS[type as OfferType] || type;
  const cls = OFFER_TYPE_COLORS[type as OfferType] || "";
  return <Badge className={`text-xs font-medium border-0 ${cls}`}>{label}</Badge>;
}

interface ItemRow {
  itemId: string;
  itemName: string;
  unitPrice: number;
  discountValue: number;
}

function OfferFormDialog({
  open,
  onClose,
  initialData,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  initialData?: IOffer | null;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [itemSearch, setItemSearch] = useState("");
  const [selectedItems, setSelectedItems] = useState<ItemRow[]>(() =>
    initialData ? initialData.items.map((it) => ({ ...it, unitPrice: 0, discountValue: it.discountValue })) : []
  );

  const { data: allItemsData } = useQuery<{ success: boolean; data: IItem[] }>({
    queryKey: ["/api/items/all"],
  });
  const allItems = allItemsData?.data || [];

  const form = useForm<CreateOfferInput>({
    resolver: zodResolver(createOfferSchema),
    defaultValues: initialData
      ? {
          name: initialData.name,
          description: initialData.description || "",
          isActive: initialData.isActive,
          startDate: initialData.startDate.slice(0, 10),
          endDate: initialData.endDate.slice(0, 10),
          offerType: initialData.offerType,
          items: initialData.items.map((it) => ({ itemId: it.itemId, itemName: it.itemName, discountValue: it.discountValue })),
        }
      : {
          name: "",
          description: "",
          isActive: true,
          startDate: new Date().toISOString().slice(0, 10),
          endDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
          offerType: "percentage_discount",
          items: [],
        },
  });

  const offerType = form.watch("offerType");

  const saveMutation = useMutation({
    mutationFn: (data: CreateOfferInput) => {
      const payload = { ...data, items: selectedItems.map((it) => ({ itemId: it.itemId, itemName: it.itemName, discountValue: it.discountValue })) };
      if (initialData) return apiRequest("PUT", `/api/offers/${initialData._id}`, payload);
      return apiRequest("POST", "/api/offers", payload);
    },
    onSuccess: () => {
      toast({ title: initialData ? "Offer updated" : "Offer created" });
      queryClient.invalidateQueries({ queryKey: ["/api/offers"] });
      onSuccess();
      onClose();
    },
    onError: (err: any) => {
      toast({ title: err.message || "Failed to save offer", variant: "destructive" });
    },
  });

  const filteredItems = (allItems || []).filter((it) =>
    !selectedItems.find((s) => s.itemId === it._id) &&
    it.itemName.toLowerCase().includes(itemSearch.toLowerCase())
  );

  function addItem(item: IItem) {
    setSelectedItems((prev) => [...prev, { itemId: item._id, itemName: item.itemName, unitPrice: item.unitPrice, discountValue: 0 }]);
    setItemSearch("");
  }

  function removeItem(itemId: string) {
    setSelectedItems((prev) => prev.filter((it) => it.itemId !== itemId));
  }

  function updateDiscount(itemId: string, discountValue: number) {
    setSelectedItems((prev) => prev.map((it) => it.itemId === itemId ? { ...it, discountValue } : it));
  }

  function getPreviewPrice(item: ItemRow) {
    if (offerType === "percentage_discount") return item.unitPrice * (1 - item.discountValue / 100);
    if (offerType === "flat_discount") return Math.max(0, item.unitPrice - item.discountValue);
    if (offerType === "buy1_take_percentage") return item.unitPrice * (1 - item.discountValue / 100);
    return item.unitPrice;
  }

  function onSubmit(data: CreateOfferInput) {
    if (selectedItems.length === 0) {
      toast({ title: "Add at least one item to the offer", variant: "destructive" });
      return;
    }
    saveMutation.mutate(data);
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialData ? "Edit Offer" : "Create Offer"}</DialogTitle>
          <DialogDescription>Configure the offer details and select items.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Section 1 — Basic Info</h3>
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Offer Name *</FormLabel>
                  <FormControl><Input placeholder="e.g. Summer Sale 20%" {...field} data-testid="input-offer-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Textarea placeholder="Optional description" {...field} rows={2} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="offerType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Offer Type *</FormLabel>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(["percentage_discount", "b1t1", "buy1_take_percentage", "flat_discount"] as OfferType[]).map((type) => (
                      <button
                        key={type}
                        type="button"
                        className={`flex items-start gap-2 border rounded-lg p-3 cursor-pointer transition-colors text-left w-full ${field.value === type ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
                        onClick={() => field.onChange(type)}
                        data-testid={`option-offer-type-${type}`}
                      >
                        <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${field.value === type ? "border-primary" : "border-muted-foreground/40"}`}>
                          {field.value === type && <div className="w-2 h-2 rounded-full bg-primary" />}
                        </div>
                        <div>
                          <Label className="font-medium cursor-pointer text-sm pointer-events-none">{OFFER_TYPE_LABELS[type]}</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">{OFFER_TYPE_DESCRIPTIONS[type]}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="startDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date *</FormLabel>
                    <FormControl><Input type="date" {...field} data-testid="input-offer-start-date" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="endDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date *</FormLabel>
                    <FormControl><Input type="date" {...field} data-testid="input-offer-end-date" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="isActive" render={({ field }) => (
                <FormItem className="flex items-center gap-3">
                  <FormLabel className="mt-0">Active</FormLabel>
                  <FormControl><SwitchUI checked={field.value} onCheckedChange={field.onChange} data-testid="switch-offer-active" /></FormControl>
                </FormItem>
              )} />
            </div>

            <Separator />
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Section 2 — Items & Discounts</h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search items to add..." value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} data-testid="input-offer-item-search" />
                {itemSearch && filteredItems.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto mt-1">
                    {filteredItems.slice(0, 8).map((it) => (
                      <button key={it._id} type="button" className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent text-left"
                        onClick={() => addItem(it)} data-testid={`option-offer-item-${it._id}`}>
                        <span className="font-medium">{it.itemName}</span>
                        <span className="text-muted-foreground">{formatPHP(it.unitPrice)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedItems.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                  Search and add items above
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedItems.map((it) => (
                    <div key={it.itemId} className="flex items-center gap-3 border rounded-lg p-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{it.itemName}</p>
                        {offerType !== "b1t1" && it.unitPrice > 0 && it.discountValue > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatPHP(it.unitPrice)} → <span className="text-green-600 font-medium">{formatPHP(getPreviewPrice(it))}</span>
                          </p>
                        )}
                      </div>
                      {offerType === "b1t1" ? (
                        <span className="text-xs text-muted-foreground bg-purple-50 dark:bg-purple-900/20 border border-purple-200 rounded px-2 py-1">Buy 1 Get 1 Free</span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Input type="number" min={0} max={offerType === "flat_discount" ? undefined : 100}
                            value={it.discountValue || ""} onChange={(e) => updateDiscount(it.itemId, parseFloat(e.target.value) || 0)}
                            className="w-20 h-8 text-sm" placeholder="0" data-testid={`input-discount-${it.itemId}`} />
                          <span className="text-xs text-muted-foreground">{offerType === "flat_discount" ? "₱ off" : "% off"}</span>
                        </div>
                      )}
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeItem(it.itemId)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selectedItems.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Section 3 — Preview Summary</h3>
                  <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                    {selectedItems.map((it) => (
                      <div key={it.itemId} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{it.itemName}</span>
                        {offerType === "b1t1" ? (
                          <span className="text-purple-600 font-medium">Buy 1 Get 1 Free</span>
                        ) : it.unitPrice > 0 && it.discountValue > 0 ? (
                          <span>
                            <span className="line-through text-muted-foreground mr-1.5">{formatPHP(it.unitPrice)}</span>
                            <span className="text-green-600 font-medium">{formatPHP(getPreviewPrice(it))}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-offer">
                {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {initialData ? "Update Offer" : "Create Offer"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function OfferDetailModal({ offer, onClose }: { offer: IOffer; onClose: () => void }) {
  const now = new Date();
  const isActive = offer.isActive && new Date(offer.startDate) <= now && new Date(offer.endDate) >= now;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {offer.name}
            <OfferTypeBadge type={offer.offerType} />
          </DialogTitle>
          <DialogDescription>{offer.description || "No description"}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-muted-foreground">Status:</span> <Badge variant={isActive ? "default" : "secondary"} className="ml-1">{isActive ? "Active" : "Inactive"}</Badge></div>
            <div><span className="text-muted-foreground">Date Range:</span> <span className="ml-1 font-medium">{format(new Date(offer.startDate), "MMM d")} → {format(new Date(offer.endDate), "MMM d, yyyy")}</span></div>
            <div><span className="text-muted-foreground">Usage Count:</span> <span className="ml-1 font-semibold">{offer.usageCount}</span></div>
            <div><span className="text-muted-foreground">Total Savings:</span> <span className="ml-1 font-semibold text-green-600">{formatPHP(offer.totalSavingsGenerated)}</span></div>
          </div>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Items ({offer.items.length})</p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {offer.items.map((it) => (
                <div key={it.itemId} className="flex items-center justify-between text-sm bg-muted/40 rounded px-3 py-1.5">
                  <span>{it.itemName}</span>
                  <span className="text-muted-foreground">
                    {offer.offerType === "b1t1" ? "Buy 1 Get 1" :
                      offer.offerType === "flat_discount" ? `₱${it.discountValue} off` :
                        `${it.discountValue}% off`}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Created {format(new Date(offer.createdAt), "PPP")} · Expires {format(new Date(offer.endDate), "PPP")}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function OffersPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOffer, setEditOffer] = useState<IOffer | null>(null);
  const [viewOffer, setViewOffer] = useState<IOffer | null>(null);
  const [deleteOffer, setDeleteOffer] = useState<IOffer | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const { data, isLoading } = useQuery<{ offers: IOffer[]; total: number }>({
    queryKey: ["/api/offers", tab, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "10" });
      if (tab !== "all") params.set("status", tab);
      const res = await fetch(`/api/offers?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const json = await res.json();
      // Ensure we never return undefined — TanStack Query throws on undefined.
      return json?.data ?? { offers: [], total: 0 };
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/offers/${id}/toggle`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/offers"] }); },
    onError: (err: any) => toast({ title: err.message, variant: "destructive" }),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/offers/${id}/duplicate`),
    onSuccess: () => {
      toast({ title: "Offer duplicated" });
      queryClient.invalidateQueries({ queryKey: ["/api/offers"] });
    },
    onError: (err: any) => toast({ title: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/offers/${id}`),
    onSuccess: (data: any) => {
      const msg = data?.data?.archived ? "Offer archived (has usage history)" : "Offer deleted";
      toast({ title: msg });
      queryClient.invalidateQueries({ queryKey: ["/api/offers"] });
      setDeleteOffer(null);
      setDeleteConfirmText("");
    },
    onError: (err: any) => toast({ title: err.message, variant: "destructive" }),
  });

  const now = new Date();
  const offers = data?.offers || [];
  const total = data?.total || 0;
  const activeOffers = offers.filter((o) => o.isActive && new Date(o.startDate) <= now && new Date(o.endDate) >= now);
  const totalSavings = offers.reduce((s, o) => s + o.totalSavingsGenerated, 0);
  const mostUsed = offers.reduce((best, o) => (!best || o.usageCount > best.usageCount) ? o : best, null as IOffer | null);
  const expiringSoon = offers.filter((o) => {
    const diff = differenceInDays(new Date(o.endDate), now);
    return o.isActive && diff >= 0 && diff <= 7;
  }).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Tag className="h-6 w-6 text-primary" />Offers & Promotions</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Manage promotional offers and discounts</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-create-offer">
            <Plus className="h-4 w-4 mr-2" />Create Offer
          </Button>
        </div>

        {activeOffers.length > 0 && (
          <div className="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded-xl p-4">
            <p className="text-sm font-semibold text-green-800 dark:text-green-300 mb-2">
              🎉 {activeOffers.length} Active Promotion{activeOffers.length !== 1 ? "s" : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              {activeOffers.map((o) => (
                <div key={o._id} className="flex items-center gap-2 bg-white dark:bg-green-900/30 rounded-lg border border-green-200 dark:border-green-700 px-3 py-1.5 text-sm">
                  <span className="font-medium text-green-800 dark:text-green-300">{o.name}</span>
                  <Badge variant="outline" className="text-[10px] border-green-300 text-green-700">{getDaysRemaining(o.endDate)}</Badge>
                  <SwitchUI checked={o.isActive} onCheckedChange={() => toggleMutation.mutate(o._id)} className="scale-75" data-testid={`switch-offer-active-banner-${o._id}`} />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1"><Tag className="h-4 w-4 text-green-600" /><span className="text-xs text-muted-foreground">Total Active</span></div>
              <p className="text-2xl font-bold text-green-600" data-testid="stat-active-offers">{activeOffers.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1"><TrendingUp className="h-4 w-4 text-blue-600" /><span className="text-xs text-muted-foreground">Total Savings</span></div>
              <p className="text-2xl font-bold text-blue-600 truncate" data-testid="stat-total-savings">{formatPHP(totalSavings)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1"><Zap className="h-4 w-4 text-purple-600" /><span className="text-xs text-muted-foreground">Most Used</span></div>
              <p className="text-sm font-bold text-purple-600 truncate" data-testid="stat-most-used">{mostUsed?.name || "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1"><Clock className="h-4 w-4 text-amber-600" /><span className="text-xs text-muted-foreground">Expiring Soon</span></div>
              <p className="text-2xl font-bold text-amber-600" data-testid="stat-expiring-soon">{expiringSoon}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base">All Offers</CardTitle>
              <Tabs value={tab} onValueChange={(v) => { setTab(v); setPage(1); }}>
                <TabsList className="h-8">
                  <TabsTrigger value="all" className="text-xs h-7">All</TabsTrigger>
                  <TabsTrigger value="active" className="text-xs h-7">Active</TabsTrigger>
                  <TabsTrigger value="inactive" className="text-xs h-7">Inactive</TabsTrigger>
                  <TabsTrigger value="expired" className="text-xs h-7">Expired</TabsTrigger>
                  <TabsTrigger value="upcoming" className="text-xs h-7">Upcoming</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : offers.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Tag className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No offers found</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setCreateOpen(true)}>Create your first offer</Button>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Date Range</TableHead>
                        <TableHead className="text-center">Items</TableHead>
                        <TableHead className="text-center">Used</TableHead>
                        <TableHead>Savings</TableHead>
                        <TableHead className="text-center">Active</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {offers.map((offer) => {
                        const isCurrentlyActive = offer.isActive && new Date(offer.startDate) <= now && new Date(offer.endDate) >= now;
                        const isExpired = new Date(offer.endDate) < now;
                        const isScheduled = new Date(offer.startDate) > now;
                        const daysLeft = differenceInDays(new Date(offer.endDate), now);
                        const isExpiringSoon = offer.isActive && !isExpired && daysLeft >= 0 && daysLeft <= 7;
                        return (
                          <TableRow
                            key={offer._id}
                            className="cursor-pointer hover:bg-muted/30 transition-colors"
                            onClick={() => setViewOffer(offer)}
                            data-testid={`row-offer-${offer._id}`}
                          >
                            <TableCell>
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className="font-medium text-sm">{offer.name}</p>
                                  {isExpired && <Badge className="text-[9px] px-1.5 py-0 h-4 bg-gray-100 text-gray-600 border-gray-200 font-medium">Expired</Badge>}
                                  {isScheduled && !isExpired && <Badge className="text-[9px] px-1.5 py-0 h-4 bg-blue-100 text-blue-700 border-blue-200 font-medium">Scheduled</Badge>}
                                  {isExpiringSoon && <Badge className="text-[9px] px-1.5 py-0 h-4 bg-amber-100 text-amber-700 border-amber-200 font-medium">Expiring Soon</Badge>}
                                </div>
                                {offer.description && <p className="text-xs text-muted-foreground truncate max-w-[180px]">{offer.description}</p>}
                              </div>
                            </TableCell>
                            <TableCell><OfferTypeBadge type={offer.offerType} /></TableCell>
                            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                              {format(new Date(offer.startDate), "MMM d")} → {format(new Date(offer.endDate), "MMM d, yy")}
                              <div className="text-xs mt-0.5">
                                <span className={new Date(offer.endDate) < now ? "text-red-500" : "text-green-600"}>
                                  {getDaysRemaining(offer.endDate)}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-center text-sm">{offer.items.length}</TableCell>
                            <TableCell className="text-center text-sm">{offer.usageCount}</TableCell>
                            <TableCell className="text-sm text-green-600 font-medium">{formatPHP(offer.totalSavingsGenerated)}</TableCell>
                            <TableCell className="text-center">
                              <SwitchUI
                                checked={isCurrentlyActive}
                                onCheckedChange={() => toggleMutation.mutate(offer._id)}
                                disabled={toggleMutation.isPending}
                                data-testid={`switch-offer-toggle-${offer._id}`}
                              />
                            </TableCell>
                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setEditOffer(offer); }} data-testid={`button-edit-offer-${offer._id}`}><Pencil className="h-3.5 w-3.5" /></Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Edit</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); duplicateMutation.mutate(offer._id); }} disabled={duplicateMutation.isPending} data-testid={`button-duplicate-offer-${offer._id}`}><Copy className="h-3.5 w-3.5" /></Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Duplicate</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteOffer(offer); setDeleteConfirmText(""); }} data-testid={`button-delete-offer-${offer._id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Delete</TooltipContent>
                                </Tooltip>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {total > 10 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t">
                    <p className="text-sm text-muted-foreground">Showing {((page - 1) * 10) + 1}–{Math.min(page * 10, total)} of {total}</p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
                      <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page * 10 >= total}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {createOpen && <OfferFormDialog key="create-offer" open onClose={() => setCreateOpen(false)} onSuccess={() => setCreateOpen(false)} />}
      {editOffer && <OfferFormDialog key={editOffer._id} open onClose={() => setEditOffer(null)} initialData={editOffer} onSuccess={() => setEditOffer(null)} />}
      {viewOffer && <OfferDetailModal key={viewOffer._id} offer={viewOffer} onClose={() => setViewOffer(null)} />}

      <AlertDialog open={!!deleteOffer} onOpenChange={() => { setDeleteOffer(null); setDeleteConfirmText(""); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Offer</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteOffer && deleteOffer.usageCount > 0
                ? `This offer has been used ${deleteOffer.usageCount} time${deleteOffer.usageCount !== 1 ? "s" : ""} and generated ${formatPHP(deleteOffer.totalSavingsGenerated)} in savings. Deleting it will NOT affect past orders. Type "DELETE" to confirm.`
                : "Are you sure you want to delete this offer? This action cannot be undone."
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteOffer && deleteOffer.usageCount > 0 && (
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder='Type "DELETE" to confirm'
              className="mt-2"
              data-testid="input-delete-confirm"
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteOffer?.usageCount ? deleteConfirmText !== "DELETE" : false}
              onClick={() => deleteOffer && deleteMutation.mutate(deleteOffer._id)}
              data-testid="button-confirm-delete-offer"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
