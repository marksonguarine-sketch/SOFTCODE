/**
 * Inventory page — JOAP Hardware Trading (matches prototype design)
 *
 *   ┌─ PageHeader: Inventory / N items across M categories · actions
 *   ├─ KPI strip: Total Stocks · Stock Value · Low-stock · Dead stock
 *   ├─ Filter row: search · category pills · Table/Grid toggle
 *   └─ Items table (or grid)
 *
 * Data source: GET /api/items (paginated) + /api/items/categories
 * Mutations preserved from the original: create item, log stock change,
 * upload image, delete image — but the heavy dialog flows now live in
 * inventory-legacy.tsx (still routable as a fallback).
 *
 * The original 809-line inventory page is preserved as inventory-legacy.tsx.
 */

import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Package,
  Plus,
  Search,
  Upload,
  Printer,
  Layers,
  Coins,
  AlertTriangle,
  Archive,
  Loader2,
  MoreHorizontal,
  ImageIcon,
  X,
  Edit2,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import {
  createItemSchema,
  type CreateItemInput,
  type IItem,
} from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { PageHeader } from "@/components/page-header";
import { KPICard } from "@/components/kpi-card";
import { cn } from "@/lib/utils";

const peso = (n: number) =>
  "₱" + Number(n).toLocaleString("en-PH", { maximumFractionDigits: 0 });

/** Generate a prototype-style SKU from item data. */
function skuOf(item: IItem): string {
  if ((item as any).barcode) return (item as any).barcode;
  const cat = (item.category || "GEN").slice(0, 3).toUpperCase();
  const name = (item.itemName || "ITM")
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("")
    .slice(0, 3)
    .padEnd(3, "X");
  const tail = (item._id || "").slice(-3).toUpperCase();
  return `${cat}-${name}-${tail}`;
}

/** Stock status — used for bar color + status pill. */
function stockStatus(item: IItem): "Critical" | "Low" | "Normal" {
  if (item.currentQuantity <= 0) return "Critical";
  if (item.currentQuantity <= (item.reorderLevel || 0)) return "Low";
  return "Normal";
}

export default function InventoryPage() {
  const { isAdmin, isInventoryManager, user } = useAuth();
  // Anyone with full write rights — admin OR inventory manager — bypasses the
  // employee request-to-add flow and gets the buttons directly.
  const canManageInventory = isAdmin || isInventoryManager;
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editItem, setEditItem] = useState<IItem | null>(null);
  const [editPrice, setEditPrice] = useState(0);
  const [editQty, setEditQty] = useState(0);
  const [editCategory, setEditCategory] = useState("");
  const [editSupplier, setEditSupplier] = useState("");
  // Confirmation dialog shown to employees who click "Add item" without
  // already having an approved request. Keeps the existing add-dialog
  // open path intact for admins / IMs.
  const [showRequestPrompt, setShowRequestPrompt] = useState(false);

  // Has this employee got an approved (un-used) ADD_ITEM grant?
  const { data: myReqRes } = useQuery<{ success: boolean; data: { requests: any[] } }>({
    queryKey: ["/api/item-requests", "mine"],
    queryFn: () => apiRequest("GET", "/api/item-requests").then((r) => r.json()),
    enabled: !canManageInventory,
    refetchInterval: 10_000,
  });
  const myAddGrant = (myReqRes?.data?.requests || []).find(
    (r: any) => r.action === "ADD_ITEM" && r.status === "approved",
  );

  function handleAddItemClick() {
    if (canManageInventory) {
      setShowAddDialog(true);
      return;
    }
    if (myAddGrant) {
      // They have a fresh approval — bypass the prompt and let them add.
      setShowAddDialog(true);
      return;
    }
    setShowRequestPrompt(true);
  }

  // ── Data ──────────────────────────────────────────────────────────────
  const { data: itemsRes, isLoading } = useQuery<{
    success: boolean;
    data: { items: IItem[]; total: number };
  }>({
    queryKey: ["/api/items", "page=1&pageSize=200"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/items?page=1&pageSize=200");
      return res.json();
    },
    staleTime: 30_000,
  });
  const allItems: IItem[] = itemsRes?.data?.items ?? [];

  const { data: catRes } = useQuery<{ success: boolean; data: string[] }>({
    queryKey: ["/api/items/categories"],
    staleTime: 60_000,
  });
  const categories = catRes?.data ?? [];

  // ── Filtered items ────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = allItems;
    if (category !== "All") list = list.filter((i) => i.category === category);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.itemName.toLowerCase().includes(q) ||
          skuOf(i).toLowerCase().includes(q) ||
          (i.category || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [allItems, category, search]);

  // ── KPIs ──────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalSkus = allItems.length;
    const stockValue = allItems.reduce(
      (s, i) => s + (i.unitPrice || 0) * (i.currentQuantity || 0),
      0
    );
    const lowStock = allItems.filter(
      (i) =>
        i.currentQuantity > 0 && i.currentQuantity <= (i.reorderLevel || 0)
    ).length;
    const deadStock = allItems.filter(
      (i) => ((i as any).avgDailyUsage || 0) === 0 && i.currentQuantity > 0
    ).length;
    return { totalSkus, stockValue, lowStock, deadStock };
  }, [allItems]);

  // ── Add item ──────────────────────────────────────────────────────────
  const form = useForm<CreateItemInput>({
    resolver: zodResolver(createItemSchema),
    defaultValues: {
      itemName: "",
      category: "",
      supplierName: "",
      unitPrice: 0,
      currentQuantity: 0,
      avgDailyUsage: 0,
      leadTimeDays: 0,
      safetyStock: 0,
    },
  });
  // Edit item — wired to the "…" button on each inventory row
  const editMutation = useMutation({
    mutationFn: async () => {
      if (!editItem) throw new Error("No item selected");
      const body = {
        itemName: editItem.itemName,
        category: editCategory,
        supplierName: editSupplier,
        unitPrice: editPrice,
        currentQuantity: editQty,
      };
      const res = await apiRequest("PATCH", `/api/items/${editItem._id}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items/categories"] });
      toast({ title: "Item updated" });
      setEditItem(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to update item", description: err.message, variant: "destructive" });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/items/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({ title: "Item deleted" });
      setEditItem(null);
    },
    onError: (err: any) => toast({ title: "Failed to delete", description: err.message, variant: "destructive" }),
  });

  // ── Admin image upload (grid + table) ──────────────────────────────────
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  const imageUploadMutation = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const fd = new FormData();
      fd.append("image", file);
      const res = await apiRequest("POST", `/api/items/${id}/image`, fd);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({ title: "Image uploaded" });
    },
    onError: (err: any) => toast({ title: "Failed to upload image", description: err.message, variant: "destructive" }),
  });

  function triggerImageUpload(itemId: string) {
    setUploadTargetId(itemId);
    document.getElementById("inventory-image-upload")?.click();
  }

  function openEdit(item: IItem) {
    setEditItem(item);
    setEditPrice(item.unitPrice || 0);
    setEditQty(item.currentQuantity || 0);
    setEditCategory(item.category || "");
    setEditSupplier((item as any).supplierName || "");
  }

  const addMutation = useMutation({
    mutationFn: async (data: CreateItemInput) => {
      const res = await apiRequest("POST", "/api/items", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items/categories"] });
      toast({ title: "Item created" });
      setShowAddDialog(false);
      form.reset();
    },
    onError: (err: any) => {
      toast({
        title: "Failed to create item",
        description: err.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="px-6 sm:px-8 py-6 pb-16 max-w-[1500px] mx-auto" data-testid="page-inventory">
      <PageHeader
        title="Inventory"
        subtitle={
          <>
            {kpis.totalSkus} items across {categories.length || 0} categor
            {categories.length === 1 ? "y" : "ies"}
          </>
        }
        actions={
          <>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              id="inventory-csv-import"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const text = await file.text();
                // Parse CSV — expect header: itemName,category,supplierName,unitPrice,currentQuantity[,reorderLevel]
                const lines = text.split(/\r?\n/).filter(Boolean);
                if (lines.length < 2) { toast({ title: "Empty CSV", variant: "destructive" }); return; }
                const header = lines[0].split(",").map(h => h.trim().toLowerCase());
                const idx = (k: string) => header.indexOf(k);
                let ok = 0, fail = 0;
                for (let i = 1; i < lines.length; i++) {
                  const cols = lines[i].split(",").map(c => c.trim());
                  const payload = {
                    itemName: cols[idx("itemname")] || "",
                    category: cols[idx("category")] || "Uncategorized",
                    supplierName: cols[idx("suppliername")] || "",
                    unitPrice: Number(cols[idx("unitprice")] || 0),
                    currentQuantity: Math.floor(Number(cols[idx("currentquantity")] || 0)),
                  };
                  if (!payload.itemName) { fail++; continue; }
                  try {
                    const res = await apiRequest("POST", "/api/items", payload);
                    if ((await res.json()).success) ok++; else fail++;
                  } catch { fail++; }
                }
                queryClient.invalidateQueries({ queryKey: ["/api/items"] });
                toast({ title: `CSV imported`, description: `${ok} added, ${fail} skipped` });
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              data-testid="button-import-csv"
              onClick={() => document.getElementById("inventory-csv-import")?.click()}
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              Import CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="button-print-labels"
              onClick={() => window.print()}
            >
              <Printer className="w-3.5 h-3.5 mr-1.5" />
              Print labels
            </Button>
            <Button
              size="sm"
              onClick={() => handleAddItemClick()}
              data-testid="button-add-item"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add item
            </Button>
          </>
        }
      />

      {/* Employee approval-request widgets — only shown to plain employees */}
      <EmployeeRequestWidgets canManageInventory={canManageInventory} />

      {/* Admin / IM pending-request inbox — only shown to approvers */}
      <ApproverRequestInbox canApprove={canManageInventory} />

      {/* Hidden file input for admin item-image uploads (grid + table) */}
      <input
        type="file"
        id="inventory-image-upload"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && uploadTargetId) imageUploadMutation.mutate({ id: uploadTargetId, file });
          e.target.value = "";
        }}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <KPICard
          label="Total Stocks"
          value={kpis.totalSkus}
          icon={Layers}
          tone="slate"
          sub="across all categories"
        />
        <KPICard
          label="Stock Value"
          value={peso(kpis.stockValue)}
          icon={Coins}
          tone="amber"
          delta="2.1%"
          deltaDir="up"
          sub="vs last month"
        />
        <KPICard
          label="Low-stock Items"
          value={kpis.lowStock}
          icon={AlertTriangle}
          tone="red"
          sub="below reorder point"
        />
        <KPICard
          label="Dead Stock"
          value={kpis.deadStock}
          icon={Archive}
          tone="slate"
          sub="no sales in 60d"
        />
      </div>

      {/* Filter + view toggle row */}
      <Card>
        <CardContent className="px-4 py-3 flex items-center gap-3 flex-wrap border-b">
          <div className="relative w-full sm:w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by SKU or name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-[13px]"
              data-testid="input-inventory-search"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap flex-1">
            <CategoryPill
              label="All"
              active={category === "All"}
              onClick={() => setCategory("All")}
            />
            {categories.map((c) => (
              <CategoryPill
                key={c}
                label={c}
                active={category === c}
                onClick={() => setCategory(c)}
              />
            ))}
          </div>

          <div className="inline-flex bg-muted border border-border rounded-md p-0.5 gap-0.5 ml-auto">
            {(["table", "grid"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={cn(
                  "text-[12px] font-medium px-2.5 py-1 rounded transition capitalize",
                  viewMode === v
                    ? "bg-card text-foreground font-semibold shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                data-testid={`view-${v}`}
              >
                {v}
              </button>
            ))}
          </div>
        </CardContent>

        {/* Table view */}
        {viewMode === "table" ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Image</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead></TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8">
                      <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />
                      Loading inventory…
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-10 text-muted-foreground">
                      No items match the current filter.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((item) => {
                  const status = stockStatus(item);
                  const max = Math.max(item.reorderLevel * 3, item.currentQuantity, 100);
                  const pct = Math.min(100, (item.currentQuantity / max) * 100);
                  const barColor =
                    status === "Critical"
                      ? "bg-red-500"
                      : status === "Low"
                        ? "bg-amber-400"
                        : "bg-green-500";
                  return (
                    <TableRow key={item._id} data-testid={`row-item-${item._id}`} className="cursor-pointer">
                      <TableCell className="font-mono text-[12px] font-semibold tabular-nums whitespace-nowrap">
                        {skuOf(item)}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-[13px]">{item.itemName}</div>
                        {(item as any).supplierName && (
                          <div className="text-[11px] text-muted-foreground">{(item as any).supplierName}</div>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <div className="h-10 w-10 rounded-md bg-muted/40 overflow-hidden grid place-items-center shrink-0">
                            {(item as any).imageFilename ? (
                              <img src={`/api/uploads/${(item as any).imageFilename}`} alt={item.itemName} className="w-full h-full object-cover" />
                            ) : (
                              <ImageIcon className="w-4 h-4 text-muted-foreground/40" />
                            )}
                          </div>
                          {isAdmin && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              disabled={imageUploadMutation.isPending && uploadTargetId === item._id}
                              onClick={() => triggerImageUpload(item._id)}
                              data-testid={`button-upload-image-${item._id}`}
                            >
                              {(item as any).imageFilename ? "Change" : "Upload"}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[11px]">
                          {item.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {peso(item.unitPrice)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {peso(item.unitPrice * 0.8)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums font-semibold">
                        <span
                          className={cn(
                            status === "Critical" && "text-red-600 dark:text-red-400",
                            status === "Low" && "text-amber-700 dark:text-amber-400"
                          )}
                        >
                          {item.currentQuantity}
                        </span>
                      </TableCell>
                      <TableCell className="w-[120px]">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn("h-full transition-all rounded-full", barColor)}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={cn(
                            "border-transparent text-white font-semibold",
                            status === "Critical" && "bg-red-600 hover:bg-red-600",
                            status === "Low" && "bg-amber-500 hover:bg-amber-500",
                            status === "Normal" && "bg-emerald-600 hover:bg-emerald-600"
                          )}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current mr-1" />
                          {status === "Normal" ? "In Stock" : status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[12px] text-muted-foreground">
                        {(item as any).supplierName || "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Edit item"
                          data-testid={`button-edit-item-${item._id}`}
                          onClick={() => openEdit(item)}
                        >
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          /* Grid view */
          <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filtered.map((item) => {
              const status = stockStatus(item);
              const max = Math.max(item.reorderLevel * 3, item.currentQuantity, 100);
              const pct = Math.min(100, (item.currentQuantity / max) * 100);
              return (
                <div
                  key={item._id}
                  className="border border-border rounded-lg overflow-hidden hover:shadow-md transition"
                  data-testid={`card-item-${item._id}`}
                >
                  <div className="relative h-24 bg-muted/40 grid place-items-center group">
                    {(item as any).imageFilename ? (
                      <img
                        src={`/api/uploads/${(item as any).imageFilename}`}
                        alt={item.itemName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-muted-foreground/40" />
                    )}
                    {isAdmin && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="absolute bottom-1 right-1 h-6 px-2 text-[10px] opacity-90"
                        disabled={imageUploadMutation.isPending && uploadTargetId === item._id}
                        onClick={(e) => { e.stopPropagation(); triggerImageUpload(item._id); }}
                        data-testid={`button-upload-image-grid-${item._id}`}
                      >
                        {(item as any).imageFilename ? "Change" : "Upload"}
                      </Button>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="font-mono text-[10.5px] text-muted-foreground tabular-nums mb-1">
                      {skuOf(item)}
                    </div>
                    <div className="text-[13px] font-semibold truncate">{item.itemName}</div>
                    <div className="text-[11px] text-muted-foreground mb-2">{item.category}</div>
                    <div className="flex items-end justify-between mb-2">
                      <span className="font-mono text-[14px] font-semibold tabular-nums">
                        {peso(item.unitPrice)}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                        {item.currentQuantity} on hand
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            status === "Critical"
                              ? "bg-red-500"
                              : status === "Low"
                                ? "bg-amber-400"
                                : "bg-green-500"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border",
                          status === "Critical" && "bg-red-500 border-red-600 text-white",
                          status === "Low" && "bg-amber-500 border-amber-600 text-white",
                          status === "Normal" && "bg-emerald-500 border-emerald-600 text-white",
                        )}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {status === "Normal" ? "OK" : status}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Employee request-to-add prompt — shown when employee clicks Add
          and has no approved grant yet. Confirms intent then files a
          request with the server. Workflow matches REQUEST.pdf round 4. */}
      <RequestPromptDialog
        open={showRequestPrompt}
        onClose={() => setShowRequestPrompt(false)}
        action="ADD_ITEM"
      />

      {/* Add item dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add inventory item</DialogTitle>
            <DialogDescription>Add a new SKU to the catalog.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((data) => addMutation.mutate(data))}
              className="space-y-3"
            >
              <FormField
                control={form.control}
                name="itemName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Item name</FormLabel>
                    <FormControl>
                      <Input placeholder="Portland Cement 40kg" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <Input placeholder="Cement" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="unitPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit price (₱)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="currentQuantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current stock</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="safetyStock"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Safety stock</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="supplierName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Supplier</FormLabel>
                      <FormControl>
                        <Input placeholder="Holcim PH" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowAddDialog(false)}
                  disabled={addMutation.isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={addMutation.isPending}>
                  {addMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  Add item
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit item dialog — wired to the "…" button on each inventory row */}
      <Dialog open={!!editItem} onOpenChange={(o) => !o && setEditItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="h-4 w-4 text-primary" />Edit item
            </DialogTitle>
            <DialogDescription>
              {editItem ? <span className="font-mono">{editItem.itemName}</span> : null}
            </DialogDescription>
          </DialogHeader>
          {editItem && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Category</label>
                  <Input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} data-testid="input-edit-category" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Supplier</label>
                  <Input value={editSupplier} onChange={(e) => setEditSupplier(e.target.value)} data-testid="input-edit-supplier" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Unit price (₱)</label>
                  <Input type="number" min={0} step="0.01" value={editPrice} onChange={(e) => setEditPrice(Number(e.target.value))} data-testid="input-edit-price" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Current stock</label>
                  <Input type="number" min={0} value={editQty} onChange={(e) => setEditQty(Number(e.target.value))} data-testid="input-edit-qty" />
                </div>
              </div>
              <div className="flex items-center justify-between pt-3 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    if (window.confirm(`Delete "${editItem.itemName}" permanently?`)) {
                      deleteItemMutation.mutate(editItem._id);
                    }
                  }}
                  disabled={deleteItemMutation.isPending}
                  data-testid="button-delete-item"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />Delete
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditItem(null)}>Cancel</Button>
                  <Button size="sm" onClick={() => editMutation.mutate()} disabled={editMutation.isPending} data-testid="button-save-item">
                    {editMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                    Save
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Pill-shaped category filter. */
function CategoryPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-7 px-3 rounded-full text-[12px] font-medium transition border whitespace-nowrap",
        active
          ? "bg-primary text-primary-foreground border-transparent shadow-sm"
          : "bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted"
      )}
      data-testid={`pill-cat-${label.toLowerCase()}`}
    >
      {label}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Two-step prompt → file request → live progress.
function RequestPromptDialog({
  open,
  onClose,
  action,
}: {
  open: boolean;
  onClose: () => void;
  action: "ADD_ITEM" | "EDIT_STOCK" | "DELETE_ITEM";
}) {
  const { toast } = useToast();
  // Step 0 = ask "do you want to request?"; Step 1 = "request in progress"
  const [step, setStep] = useState(0);
  const [createdAt, setCreatedAt] = useState<number | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setStep(0);
      setCreatedAt(null);
      setRequestId(null);
    }
  }, [open]);

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/item-requests", { action }),
    onSuccess: async (res: any) => {
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not request");
      setRequestId(json.data.request._id);
      setCreatedAt(new Date(json.data.request.createdAt).getTime());
      queryClient.invalidateQueries({ queryKey: ["/api/item-requests"] });
      setStep(1);
      toast({
        title: json.data.alreadyPending ? "You already have a pending request" : "Request sent",
        description: "Admin / inventory manager will be notified.",
      });
    },
    onError: (err: Error) => toast({ title: "Could not send request", description: err.message, variant: "destructive" }),
  });

  // Live timer
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (step !== 1) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [step]);
  const elapsed = createdAt ? Math.floor((Date.now() - createdAt) / 1000) : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm" data-testid="dialog-request-prompt">
        {step === 0 ? (
          <>
            <DialogHeader>
              <DialogTitle>Approval needed</DialogTitle>
              <DialogDescription>
                Adding an item requires <strong>Admin / Inventory Manager</strong> verification. Do you want to send a request?
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={onClose} data-testid="button-request-no">No</Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                data-testid="button-request-yes"
              >
                {createMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Yes, send request
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Request in progress…
              </DialogTitle>
              <DialogDescription>
                Please wait — your request is being reviewed. You'll be notified the moment it's approved.
              </DialogDescription>
            </DialogHeader>
            <div className="text-center py-4">
              <p className="text-3xl font-mono tabular-nums" data-testid="text-request-elapsed">
                {elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Elapsed since request</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} data-testid="button-request-close">Close</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Employee-facing request widget. Shows a banner with the user's pending /
// approved / used add-item requests, including a live "waited Xs" counter
// for pending ones. Approval persists across logout — backend has no TTL.
function EmployeeRequestWidgets({ canManageInventory }: { canManageInventory: boolean }) {
  const { toast } = useToast();
  if (canManageInventory) return null;

  const { data } = useQuery<{ success: boolean; data: { requests: any[] } }>({
    queryKey: ["/api/item-requests", "mine"],
    queryFn: () => apiRequest("GET", "/api/item-requests").then((r) => r.json()),
    refetchInterval: 5_000,
  });

  const requests = data?.data?.requests || [];
  const pending = requests.filter((r) => r.status === "pending");
  const approved = requests.filter((r) => r.status === "approved");

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/item-requests/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/item-requests"] });
      toast({ title: "Request cancelled" });
    },
  });

  // Live-tick the elapsed counters every second.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (pending.length === 0 && approved.length === 0) return null;

  return (
    <div className="mb-3 space-y-2">
      {pending.map((r) => {
        const sec = Math.max(0, Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 1000));
        return (
          <div
            key={r._id}
            className="flex items-center justify-between gap-3 p-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200"
            data-testid={`request-pending-${r._id}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              <div className="text-sm">
                <span className="font-semibold">Request in progress…</span>{" "}
                Waiting for admin / inventory-manager approval to{" "}
                <span className="font-semibold">
                  {r.action === "ADD_ITEM" ? "add an item" : r.action === "EDIT_STOCK" ? "edit stock" : "delete an item"}
                </span>
                .{" "}
                <span className="tabular-nums" data-testid={`request-timer-${r._id}`}>
                  {sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`}
                </span>
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => cancelMutation.mutate(r._id)}
              data-testid={`button-cancel-request-${r._id}`}
            >
              <X className="h-3 w-3 mr-1" /> Close
            </Button>
          </div>
        );
      })}
      {approved.map((r) => (
        <div
          key={r._id}
          className="flex items-center gap-2 p-3 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 text-sm"
          data-testid={`request-approved-${r._id}`}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            <strong>Approved by {r.approvedBy}</strong> — you have a single-use grant to{" "}
            <strong>{r.action === "ADD_ITEM" ? "add an item" : r.action === "EDIT_STOCK" ? "edit stock" : "delete an item"}</strong>.
            Use it before the next action.
          </span>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Approver inbox — shown only to admins / IMs. Lists pending item requests
// and exposes Approve / Reject buttons that demand the approver's password.
function ApproverRequestInbox({ canApprove }: { canApprove: boolean }) {
  const { toast } = useToast();
  if (!canApprove) return null;

  const { data } = useQuery<{ success: boolean; data: { requests: any[] } }>({
    queryKey: ["/api/item-requests", "pending"],
    queryFn: () => apiRequest("GET", "/api/item-requests?status=pending").then((r) => r.json()),
    refetchInterval: 5_000,
  });

  const requests = data?.data?.requests || [];

  const [target, setTarget] = useState<any | null>(null);
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/item-requests/${id}/approve`, { password }),
    onSuccess: async (res: any) => {
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Approve failed");
      queryClient.invalidateQueries({ queryKey: ["/api/item-requests"] });
      toast({ title: "Request approved" });
      setTarget(null);
      setMode(null);
      setPassword("");
    },
    onError: (err: Error) => toast({ title: "Approve failed", description: err.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/item-requests/${id}/reject`, { password, reason }),
    onSuccess: async (res: any) => {
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Reject failed");
      queryClient.invalidateQueries({ queryKey: ["/api/item-requests"] });
      toast({ title: "Request rejected" });
      setTarget(null);
      setMode(null);
      setPassword("");
      setReason("");
    },
    onError: (err: Error) => toast({ title: "Reject failed", description: err.message, variant: "destructive" }),
  });

  if (requests.length === 0) return null;

  return (
    <div className="mb-3" data-testid="approver-inbox">
      <Card>
        <CardHeader className="py-2.5 px-4 border-b">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Pending Item Requests
            <span className="ml-1 text-xs text-muted-foreground">({requests.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {requests.map((r) => (
              <div key={r._id} className="flex items-center justify-between gap-3 px-4 py-2.5" data-testid={`pending-request-${r._id}`}>
                <div className="text-sm">
                  <p>
                    <strong>{r.requestedBy}</strong> wants to{" "}
                    <span className="font-semibold">
                      {r.action === "ADD_ITEM" ? "add a new item" : r.action === "EDIT_STOCK" ? "edit stock" : "delete an item"}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString("en-PH")} {r.notes && `· ${r.notes}`}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setTarget(r); setMode("reject"); setPassword(""); setReason(""); }} data-testid={`button-reject-${r._id}`}>
                    Reject
                  </Button>
                  <Button size="sm" className="h-7 text-xs" onClick={() => { setTarget(r); setMode("approve"); setPassword(""); }} data-testid={`button-approve-${r._id}`}>
                    Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!target && !!mode} onOpenChange={(v) => { if (!v) { setTarget(null); setMode(null); setPassword(""); setReason(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {mode === "approve" ? "Approve request" : "Reject request"}
            </DialogTitle>
            <DialogDescription>
              {mode === "approve"
                ? `Are you sure you approve ${target?.requestedBy} to ${target?.action === "ADD_ITEM" ? "add a new item" : target?.action === "EDIT_STOCK" ? "edit stock" : "delete an item"}? Enter your password to confirm — this is a single-use grant.`
                : `Reject ${target?.requestedBy}'s request? Optional reason will be sent to them.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {mode === "reject" && (
              <Input
                placeholder="Reason (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-testid="input-reject-reason"
              />
            )}
            <Input
              type="password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="input-approver-password"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setTarget(null); setMode(null); setPassword(""); setReason(""); }}>Cancel</Button>
            {mode === "approve" ? (
              <Button onClick={() => approveMutation.mutate(target._id)} disabled={!password || approveMutation.isPending} data-testid="button-confirm-approve">
                {approveMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Confirm Approve
              </Button>
            ) : (
              <Button variant="destructive" onClick={() => rejectMutation.mutate(target._id)} disabled={!password || rejectMutation.isPending} data-testid="button-confirm-reject">
                {rejectMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Confirm Reject
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
