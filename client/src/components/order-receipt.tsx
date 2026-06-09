import { useRef, useState } from "react";
import { Receipt as ReceiptIcon, Download, Loader2, Printer, CheckCircle2 } from "lucide-react";
import {
  type IOrder,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  ORDER_CHANNEL_LABELS,
} from "@shared/schema";
import { useSettings } from "@/lib/settings-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

// ─────────────────────────────────────────────────────────────────────────────
// Order receipt
//
// A self-contained, print-styled receipt that looks like a thermal till slip.
// Three exports:
//   • <OrderReceiptCard/>  — the visual receipt (the bit we rasterise to PNG)
//   • <ReceiptDialog/>     — modal wrapper with a "Save as PNG" button; auto-shown
//                            after an order is created and reused by the button
//   • <ReceiptButton/>     — drop-in "Print receipt" button for order lists/detail
//
// Colours are hard-coded paper tones (white card, ink-grey text) rather than the
// app's theme tokens, so the slip always reads like a real receipt — and so
// html2canvas captures it identically in light or dark mode.
// ─────────────────────────────────────────────────────────────────────────────

function peso(v: number): string {
  return "₱" + (v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateTime(d?: string): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-PH", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

const Rule = ({ dashed = true }: { dashed?: boolean }) => (
  <div className={`my-2 border-t ${dashed ? "border-dashed" : ""} border-zinc-300`} />
);

interface ReceiptProps {
  order: IOrder;
}

/** The visual receipt. Forwarded width is fixed so the PNG is always crisp. */
export function OrderReceiptCard({ order, innerRef }: ReceiptProps & { innerRef?: React.Ref<HTMLDivElement> }) {
  const { settings } = useSettings();

  const company = settings?.companyName || settings?.storeName || "JOAP Hardware Trading";
  const address = settings?.storeAddress?.trim();
  const tel = settings?.storeContactNumber?.trim();
  const email = settings?.storeEmail?.trim();

  const items = order.items || [];
  const originalSubtotal = items.reduce((s, i) => s + (i.originalUnitPrice || 0) * i.qty, 0);
  const itemsTotal = items.reduce((s, i) => s + (i.lineTotal || 0), 0);
  const savings = Math.max(0, originalSubtotal - itemsTotal);
  const deliveryFee = order.deliveryFee || 0;
  const grandTotal = order.totalAmount ?? itemsTotal + deliveryFee;
  const isPaid = order.paymentStatus === "paid";

  return (
    <div
      ref={innerRef}
      className="mx-auto w-[340px] bg-white px-6 py-6 font-mono text-[12px] leading-relaxed text-zinc-800"
      style={{ fontFamily: "'Courier New', ui-monospace, monospace" }}
      data-testid="receipt-card"
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="text-center">
        <div className="flex items-center justify-center gap-1.5">
          <ReceiptIcon className="h-4 w-4 text-zinc-900" />
          <span className="text-[15px] font-bold uppercase tracking-wide text-zinc-900">{company}</span>
        </div>
        {address && <p className="mt-1 whitespace-pre-line text-[11px] text-zinc-600">{address}</p>}
        {tel && <p className="text-[11px] text-zinc-600">TEL : {tel}</p>}
        {email && <p className="text-[11px] text-zinc-600">{email}</p>}
      </div>

      <div className="my-3 border-t-2 border-double border-zinc-400" />
      <p className="text-center text-[13px] font-bold tracking-[0.3em] text-zinc-900">RECEIPT</p>
      <Rule />

      {/* ── Order meta ─────────────────────────────────────── */}
      <div className="space-y-0.5">
        <Meta label="Order #" value={order.trackingNumber} mono />
        <Meta label="Date" value={fmtDateTime(order.createdAt)} />
        <Meta label="Staff" value={order.createdBy || "—"} />
        <Meta label="Customer" value={order.customerName || "Walk-in"} />
        <Meta label="Type" value={ORDER_TYPE_LABELS[order.orderType] || order.orderType} />
        <Meta label="Channel" value={ORDER_CHANNEL_LABELS[order.orderChannel] || order.orderChannel} />
      </div>

      <Rule />

      {/* ── Items ──────────────────────────────────────────── */}
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-zinc-500">
        <span>Qty · Item</span>
        <span>Amount</span>
      </div>
      <div className="mt-1 space-y-1.5">
        {items.map((it, i) => (
          <div key={i}>
            <div className="flex justify-between gap-2">
              <span className="min-w-0 flex-1 break-words">
                <span className="font-semibold text-zinc-900">{it.qty}×</span> {it.itemName}
              </span>
              <span className="whitespace-nowrap tabular-nums text-zinc-900">{peso(it.lineTotal)}</span>
            </div>
            <div className="flex justify-between text-[10px] text-zinc-500">
              <span>
                @ {peso(it.discountedUnitPrice || it.originalUnitPrice)} each
                {it.discountApplied && it.offerName ? ` · ${it.offerName}` : ""}
              </span>
              {it.discountApplied && (
                <span className="line-through">{peso(it.originalUnitPrice * it.qty)}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <Rule />

      {/* ── Totals ─────────────────────────────────────────── */}
      <div className="space-y-0.5">
        <Total label="Subtotal" value={peso(originalSubtotal)} />
        {savings > 0 && <Total label="Discount" value={"-" + peso(savings)} muted />}
        {deliveryFee > 0 && <Total label="Delivery Fee" value={peso(deliveryFee)} />}
      </div>

      <div className="my-2 border-t-2 border-double border-zinc-400" />
      <div className="flex items-center justify-between text-[14px] font-bold text-zinc-900">
        <span>GRAND TOTAL</span>
        <span className="tabular-nums">{peso(grandTotal)}</span>
      </div>
      <div className="my-2 border-t-2 border-double border-zinc-400" />

      {/* ── Payment ────────────────────────────────────────── */}
      <div className="space-y-0.5">
        <Total label="Paid By" value={PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod} />
        <Total label="Status" value={PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus} />
      </div>

      {isPaid && (
        <div className="mt-3 flex items-center justify-center gap-1.5 rounded border-2 border-emerald-500 py-1.5 text-[13px] font-bold uppercase tracking-widest text-emerald-600">
          <CheckCircle2 className="h-4 w-4" /> Paid
        </div>
      )}

      <Rule />
      <p className="text-center text-[11px] font-semibold text-zinc-700">Thank you for your business!</p>
      <p className="mt-0.5 text-center text-[10px] text-zinc-400">Printed {fmtDateTime(new Date().toISOString())}</p>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className={`text-right text-zinc-800 ${mono ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}

function Total({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className={`tabular-nums ${muted ? "text-emerald-600" : "text-zinc-900"}`}>{value}</span>
    </div>
  );
}

// ─── PNG export helper ───────────────────────────────────────────────────────
async function captureReceiptPng(node: HTMLElement, fileName: string) {
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(node, {
    backgroundColor: "#ffffff",
    scale: 3,
    useCORS: true,
    logging: false,
    windowWidth: node.scrollWidth,
  });
  await new Promise<void>((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      resolve();
    }, "image/png");
  });
}

// ─── Receipt dialog ──────────────────────────────────────────────────────────
export function ReceiptDialog({
  order,
  open,
  onClose,
  autoTitle,
}: {
  order: IOrder | null;
  open: boolean;
  onClose: () => void;
  autoTitle?: string;
}) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function handleSave() {
    if (!receiptRef.current || !order) return;
    setSaving(true);
    try {
      await captureReceiptPng(receiptRef.current, `receipt-${order.trackingNumber}.png`);
      toast({ title: "Receipt saved", description: `receipt-${order.trackingNumber}.png downloaded.` });
    } catch (err) {
      toast({ title: "Could not save receipt", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="flex items-center gap-2">
            <ReceiptIcon className="h-5 w-5" /> {autoTitle || "Order Receipt"}
          </DialogTitle>
          <DialogDescription>
            {autoTitle
              ? "The order was created. Save the receipt as a PNG or close to continue."
              : "Preview the receipt, then save it as a PNG image."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto bg-zinc-100 p-4 dark:bg-zinc-800/60">
          <div className="shadow-lg">
            {order && <OrderReceiptCard order={order} innerRef={receiptRef} />}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" onClick={onClose} data-testid="button-receipt-close">Close</Button>
          <Button onClick={handleSave} disabled={saving || !order} data-testid="button-receipt-save">
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
            Save as PNG
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Drop-in "Print receipt" button (manages its own dialog) ─────────────────
export function ReceiptButton({
  order,
  size = "sm",
  variant = "outline",
  className,
  label = "Print receipt",
}: {
  order: IOrder;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "outline" | "ghost" | "default" | "secondary";
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size={size}
        variant={variant}
        className={className}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        data-testid={`button-print-receipt-${order._id}`}
      >
        <Printer className="mr-1.5 h-3.5 w-3.5" /> {label}
      </Button>
      <ReceiptDialog order={order} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
