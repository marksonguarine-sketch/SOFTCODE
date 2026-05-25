import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Polished empty-state card used across the app for tables/lists with no rows.
 * SaaS pattern: icon in a tinted square, title, subtle subtitle, optional action.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  tone = "neutral",
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  tone?: "neutral" | "primary" | "success" | "warning";
}) {
  const toneMap = {
    neutral: { bg: "bg-muted/40", text: "text-muted-foreground" },
    primary: { bg: "bg-primary/10", text: "text-primary" },
    success: { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400" },
    warning: { bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400" },
  }[tone];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-14 px-6 gap-3",
        className
      )}
      data-testid="empty-state"
    >
      <div className={cn("w-14 h-14 rounded-2xl grid place-items-center", toneMap.bg)}>
        <Icon className={cn("w-6 h-6", toneMap.text)} />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
