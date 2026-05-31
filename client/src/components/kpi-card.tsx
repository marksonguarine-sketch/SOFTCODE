import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, Maximize2, Printer } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface KPICardProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: "amber" | "green" | "blue" | "red" | "slate" | "purple";
  delta?: string;
  deltaDir?: "up" | "down";
  sub?: ReactNode;
  spark?: ReactNode;
  className?: string;
  /** Optional bigger renderer for the maximized view. Falls back to value+spark. */
  expanded?: ReactNode;
  /** Hide the maximize affordance (e.g. for purely-textual KPIs). */
  disableMaximize?: boolean;
}

const TONE: Record<NonNullable<KPICardProps["tone"]>, { chip: string; grad: string; accent: string }> = {
  amber: {
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
    grad: "from-amber-500/15 via-amber-500/[0.04] to-transparent",
    accent: "text-amber-600 dark:text-amber-400",
  },
  green: {
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    grad: "from-emerald-500/15 via-emerald-500/[0.04] to-transparent",
    accent: "text-emerald-600 dark:text-emerald-400",
  },
  blue: {
    chip: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
    grad: "from-sky-500/15 via-sky-500/[0.04] to-transparent",
    accent: "text-sky-600 dark:text-sky-400",
  },
  red: {
    chip: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
    grad: "from-red-500/15 via-red-500/[0.04] to-transparent",
    accent: "text-red-600 dark:text-red-400",
  },
  purple: {
    chip: "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300",
    grad: "from-purple-500/15 via-purple-500/[0.04] to-transparent",
    accent: "text-purple-600 dark:text-purple-400",
  },
  slate: {
    chip: "bg-muted text-muted-foreground",
    grad: "from-slate-500/10 via-transparent to-transparent",
    accent: "text-foreground",
  },
};

/**
 * KPICard — single metric card used in dashboard / page KPI strips.
 *
 * Round-5 overhaul: tinted gradient backplate, larger icon medallion, colored
 * value when there's a delta, hover-only maximize button in the top-right
 * that opens a dialog showing the sparkline blown up (or whatever the page
 * supplies via `expanded`).
 */
export function KPICard({
  label,
  value,
  icon: Icon,
  tone = "slate",
  delta,
  deltaDir = "up",
  sub,
  spark,
  className,
  expanded,
  disableMaximize,
}: KPICardProps) {
  const [open, setOpen] = useState(false);
  const t = TONE[tone];

  return (
    <>
      <div
        className={cn(
          "relative group flex flex-col gap-2 p-4 rounded-xl border bg-card overflow-hidden",
          "border-card-border hover:shadow-md transition-shadow",
          className,
        )}
        data-testid="kpi-card"
      >
        {/* Subtle gradient backplate matching the tone */}
        <div className={cn("absolute inset-0 pointer-events-none bg-gradient-to-br opacity-90", t.grad)} />
        <div className="relative z-[1]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {label}
            </span>
            <div className="flex items-center gap-1">
              {!disableMaximize && (
                <button
                  onClick={() => setOpen(true)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                  title="Maximize"
                  data-testid="kpi-card-maximize"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              )}
              {Icon && (
                <span className={cn("w-8 h-8 rounded-lg grid place-items-center shrink-0", t.chip)}>
                  <Icon className="w-4 h-4" />
                </span>
              )}
            </div>
          </div>
          <div className={cn("font-mono text-[28px] font-bold tracking-tight leading-none tabular-nums mt-2.5", t.accent)}>
            {value}
          </div>
          {(delta || sub) && (
            <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground mt-2">
              {delta && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 font-mono font-semibold px-1.5 py-0.5 rounded-full text-[11px]",
                    deltaDir === "up"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                      : "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300"
                  )}
                >
                  {deltaDir === "up" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                  {delta}
                </span>
              )}
              {sub && <span>{sub}</span>}
            </div>
          )}
          {spark && <div className="mt-2 -mx-1">{spark}</div>}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            "p-0 gap-0 flex flex-col overflow-hidden",
            // Near-fullscreen like ChartCard so the metric + sparkline get
            // room to breathe; close stays one click away.
            "fixed !left-2 !right-2 !top-2 !bottom-2 sm:!left-6 sm:!right-6 sm:!top-6 sm:!bottom-6",
            "!translate-x-0 !translate-y-0",
            "max-w-none w-auto h-auto rounded-xl",
          )}
        >
          <DialogHeader className="border-b px-5 py-3 flex-row items-center justify-between gap-3 shrink-0">
            <DialogTitle className="text-base font-semibold">{label}</DialogTitle>
            <div className="flex items-center gap-2 pr-8">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={async () => {
                  const node = document.getElementById("kpicard-fs-content");
                  if (!node) return;
                  try {
                    const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
                      import("html2canvas"),
                      import("jspdf"),
                    ]);
                    const canvas = await html2canvas(node, {
                      backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
                      scale: 2,
                      useCORS: true,
                      logging: false,
                    });
                    const img = canvas.toDataURL("image/png");
                    const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
                    const pageW = pdf.internal.pageSize.getWidth();
                    const pageH = pdf.internal.pageSize.getHeight();
                    const ratio = Math.min(pageW / canvas.width, pageH / canvas.height);
                    const w = canvas.width * ratio;
                    const h = canvas.height * ratio;
                    pdf.text(label, 24, 28);
                    pdf.addImage(img, "PNG", (pageW - w) / 2, 48, w, h - 48);
                    pdf.save(`${label.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`);
                  } catch (err) {
                    console.error("Print failed", err);
                  }
                }}
                title="Print this view"
                data-testid="kpicard-print"
              >
                <Printer className="w-3.5 h-3.5" /> Print
              </Button>
            </div>
          </DialogHeader>
          <div
            id="kpicard-fs-content"
            className="flex-1 min-h-0 overflow-auto p-6 space-y-5 bg-background"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <div className={cn("font-mono text-[64px] sm:text-[88px] font-bold tracking-tight leading-none tabular-nums", t.accent)}>
                {value}
              </div>
              {(delta || sub) && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground flex-wrap">
                  {delta && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-0.5 font-mono font-semibold px-2 py-1 rounded-full text-xs",
                        deltaDir === "up"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-red-100 text-red-700"
                      )}
                    >
                      {deltaDir === "up" ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
                      {delta}
                    </span>
                  )}
                  {sub}
                </div>
              )}
            </div>
            <div className="w-full">{expanded ?? spark}</div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
