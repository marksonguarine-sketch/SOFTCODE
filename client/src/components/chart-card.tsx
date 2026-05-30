/**
 * Reusable chart container with a real-fullscreen maximize button.
 *
 * REQUEST.pdf round 5 + 6 follow-up: "the graphs when click maximize its not
 * maximize, make sure it fills the div and there nodes that i can click/hover
 * my mouse into, theres also a filter: set date: from - to to change the
 * graph make sure its accurate".
 *
 * • Card mode (default) renders the child chart at its normal size with a
 *   small maximize icon top-right.
 * • Maximize mode opens a near-fullscreen dialog (inset 2px on mobile, 24px
 *   on desktop) — gives the child as much room as possible while keeping
 *   the rounded card aesthetic.
 * • Date-range picker in the dialog header lets the user pick `from` / `to`.
 *   Pages pass `renderFullscreen({from, to})` and refilter / refetch with
 *   that range. The Recharts tooltip stays alive in either mode, so hover
 *   interactivity works as the user expects.
 */
import { useState } from "react";
import { Maximize2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  className?: string;
  /** Optional right-side controls rendered inside the card header. */
  headerExtras?: React.ReactNode;
  /** Chart contents — rendered as-is in the card. */
  children: React.ReactNode;
  /** If provided, the fullscreen view renders this instead of `children`.
   *  Receives the selected date range so the page can filter its data. */
  renderFullscreen?: (range: { from: string; to: string }) => React.ReactNode;
  /** Default date range for the fullscreen view. Falls back to "last 30 days". */
  defaultRange?: { from: string; to: string };
  /** Disable the maximize button (e.g. for non-data widgets). */
  disableMaximize?: boolean;
  "data-testid"?: string;
}

function isoDays(daysAgo: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const QUICK_RANGES: Array<{ label: string; days: number }> = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export function ChartCard({
  title,
  subtitle,
  className,
  headerExtras,
  children,
  renderFullscreen,
  defaultRange,
  disableMaximize,
  "data-testid": dataTestId,
}: ChartCardProps) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState(defaultRange ?? { from: isoDays(30), to: isoDays(0) });

  function applyQuick(days: number) {
    setRange({ from: isoDays(days), to: isoDays(0) });
  }

  return (
    <>
      <Card className={cn("overflow-hidden", className)} data-testid={dataTestId}>
        <CardHeader className="py-3.5 px-5 border-b flex flex-row items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-[13.5px] font-semibold tracking-tight">{title}</CardTitle>
            {subtitle && <div className="text-[12px] text-muted-foreground mt-0.5">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {headerExtras}
            {!disableMaximize && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setOpen(true)}
                title="Maximize"
                data-testid={dataTestId ? `${dataTestId}-maximize` : undefined}
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-5 py-4">{children}</CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            "p-0 gap-0 flex flex-col overflow-hidden",
            // Near-fullscreen: inset 8px on mobile, 24px on tablet+. Maxes
            // out at 1600px wide so the chart isn't absurdly wide on big
            // monitors. `!h-auto` + flex-col ensures the content fills.
            "fixed !left-2 !right-2 !top-2 !bottom-2 sm:!left-6 sm:!right-6 sm:!top-6 sm:!bottom-6",
            "!translate-x-0 !translate-y-0",
            "max-w-none w-auto h-auto rounded-xl"
          )}
        >
          <div className="border-b px-5 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="min-w-0">
              <h2 className="text-base font-semibold truncate">{title}</h2>
              {subtitle && <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              {/* Quick range chips */}
              <div className="inline-flex bg-muted border border-border rounded-md p-0.5 gap-0.5">
                {QUICK_RANGES.map((q) => {
                  const active = (() => {
                    const f = new Date(range.from);
                    const t = new Date(range.to);
                    const diff = Math.round((t.getTime() - f.getTime()) / 86_400_000);
                    return diff === q.days;
                  })();
                  return (
                    <button
                      key={q.label}
                      onClick={() => applyQuick(q.days)}
                      className={cn(
                        "text-[12px] font-medium px-2.5 py-1 rounded transition",
                        active
                          ? "bg-card text-foreground font-semibold shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      data-testid={`chartcard-range-${q.label}`}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>
              {/* Manual from/to */}
              <label className="text-xs text-muted-foreground hidden sm:inline">From</label>
              <Input
                type="date"
                value={range.from}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                max={range.to}
                className="h-8 w-[150px] text-xs"
                data-testid="chartcard-range-from"
              />
              <label className="text-xs text-muted-foreground hidden sm:inline">To</label>
              <Input
                type="date"
                value={range.to}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                min={range.from}
                max={isoDays(0)}
                className="h-8 w-[150px] text-xs"
                data-testid="chartcard-range-to"
              />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)} title="Close">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {/* Chart area — fills the dialog. Wrapping in min-h-0 lets
              ResponsiveContainer compute height correctly inside a flex col. */}
          <div className="flex-1 min-h-0 overflow-auto p-5">
            <div className="h-full w-full min-h-[420px]">
              {renderFullscreen ? renderFullscreen(range) : children}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
