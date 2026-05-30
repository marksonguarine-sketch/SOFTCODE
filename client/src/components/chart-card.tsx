/**
 * Reusable chart container with a maximize button.
 *
 * REQUEST.pdf round 5: "GRAPHS, ON THE RIGHT CORNER OF EACH DIV, ADD A
 * MAXIMIZE BUTTON WHEN CLICK IT WILL MAXIMIZE THE GRAPH … USER CAN SET DATE
 * RANGE, ETC TO SEE THE GRAPH, USER CAN HOVER THE MOUSE TO THE GRAPH SEE DATA"
 *
 * Usage:
 *   <ChartCard title="Revenue trend" subtitle="Last 14 days" >
 *     <YourActualChart />
 *   </ChartCard>
 *
 * The maximize button renders top-right; clicking it opens a full-screen
 * dialog with a date-range picker, and re-renders the chart at fullscreen
 * dimensions. The hosting page can pass `renderFullscreen` to render a
 * different version (e.g. with date-range applied); otherwise the same
 * children are scaled up.
 */
import { useState } from "react";
import { Maximize2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
        <DialogContent className="fixed inset-2 sm:inset-6 max-w-none !w-auto !h-auto !translate-x-0 !translate-y-0 !left-2 sm:!left-6 !top-2 sm:!top-6 right-2 sm:right-6 bottom-2 sm:bottom-6 flex flex-col p-0 gap-0 rounded-lg">
          <DialogHeader className="flex-row items-center justify-between gap-3 border-b px-5 py-3">
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold truncate">{title}</DialogTitle>
              {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <label className="text-xs text-muted-foreground hidden sm:inline">From</label>
              <Input
                type="date"
                value={range.from}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                className="h-8 w-[140px] text-xs"
                data-testid="chartcard-range-from"
              />
              <label className="text-xs text-muted-foreground hidden sm:inline">To</label>
              <Input
                type="date"
                value={range.to}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                className="h-8 w-[140px] text-xs"
                data-testid="chartcard-range-to"
              />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-auto p-5 min-h-0">
            {renderFullscreen ? renderFullscreen(range) : <div className="h-full min-h-[400px]">{children}</div>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
