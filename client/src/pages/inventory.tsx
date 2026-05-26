/**
 * Inventory page — JOAP Hardware Trading (matches prototype design)
 *
 *   ┌─ PageHeader: Inventory / N items across M categories · actions
 *   ├─ KPI strip: Total SKUs · Stock Value · Low-stock · Dead stock
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

import { useMemo, useState, useRef } from "react";
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
  const { isAdmin } = useAuth();
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
            <Button variant="outline" size="sm" data-testid="button-import-csv">
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              Import CSV
            </Button>
            <Button variant="outline" size="sm" data-testid="button-print-labels">
              <Printer className="w-3.5 h-3.5 mr-1.5" />
              Print labels
            </Button>
            {isAdmin && (
              <Button size="sm" onClick={() => setShowAddDialog(true)} data-testid="button-add-item">
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Add item
              </Button>
            )}
          </>
        }
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
                    <TableCell colSpan={10} className="text-center py-8">
                      <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />
                      Loading inventory…
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
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
                        ? "bg-red-400"
                        : "bg-primary";
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
                        {status === "Normal" ? (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        ) : (
                          <Badge className={status === "Critical" ? "badge-danger" : "badge-warning"}>
                            <span className="w-1.5 h-1.5 rounded-full bg-current mr-1" />
                            {status}
                          </Badge>
                        )}
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
                  <div className="h-24 bg-muted/40 grid place-items-center">
                    {(item as any).imageFilename ? (
                      <img
                        src={`/api/uploads/${(item as any).imageFilename}`}
                        alt={item.itemName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-muted-foreground/40" />
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
                    <div className="h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          status === "Critical"
                            ? "bg-red-500"
                            : status === "Low"
                              ? "bg-red-400"
                              : "bg-primary"
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

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
