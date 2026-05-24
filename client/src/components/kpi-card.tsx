import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface KPICardProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: "amber" | "green" | "blue" | "red" | "slate";
  delta?: string;
  deltaDir?: "up" | "down";
  sub?: ReactNode;
  spark?: ReactNode;
  className?: string;
}

const TONE_BG: Record<NonNullable<KPICardProps["tone"]>, string> = {
  amber: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300",
  green: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400",
  blue: "bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400",
  red: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400",
  slate: "bg-muted text-muted-foreground",
};

/**
 * KPICard — single metric card used in dashboard / page KPI strips.
 * Matches the prototype's KPI design: label uppercase, large mono value,
 * delta pill, optional sparkline below.
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
}: KPICardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-4 rounded-lg border bg-card",
        "border-card-border",
        className
      )}
      data-testid="kpi-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <span
            className={cn(
              "w-7 h-7 rounded-md grid place-items-center shrink-0",
              TONE_BG[tone]
            )}
          >
            <Icon className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
      <div className="font-mono text-[26px] font-semibold tracking-tight leading-none tabular-nums">
        {value}
      </div>
      {(delta || sub) && (
        <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
          {delta && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-mono font-semibold px-1.5 py-0.5 rounded-full text-[11px]",
                deltaDir === "up"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                  : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
              )}
            >
              {deltaDir === "up" ? (
                <ArrowUp className="w-3 h-3" />
              ) : (
                <ArrowDown className="w-3 h-3" />
              )}
              {delta}
            </span>
          )}
          {sub && <span>{sub}</span>}
        </div>
      )}
      {spark && <div className="mt-1">{spark}</div>}
    </div>
  );
}
