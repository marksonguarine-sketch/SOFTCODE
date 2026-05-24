import { useLocation } from "wouter";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

/**
 * Maps a wouter location path to a breadcrumb trail.
 * E.g. "/orders/JH-2418" → ["Orders", "JH-2418"]
 */
const PATH_LABELS: Record<string, string[]> = {
  "/": ["Dashboard"],
  "/inventory": ["Inventory"],
  "/orders": ["Orders"],
  "/billing": ["Billing"],
  "/accounting": ["Accounting"],
  "/reports": ["Reports"],
  "/reservations": ["Reservations"],
  "/pending-payment": ["Billing", "Pending Payment"],
  "/users": ["Admin", "Users"],
  "/settings": ["Settings"],
  "/maintenance": ["Admin", "Maintenance"],
  "/system-logs": ["Admin", "System Logs"],
  "/offers": ["Admin", "Offers"],
  "/requests": ["Admin", "Requests"],
  "/employees": ["Admin", "Employees"],
  "/profile": ["My Profile"],
  "/help": ["Help"],
  "/about": ["About"],
};

export function Breadcrumbs({ className }: { className?: string }) {
  const [location] = useLocation();

  const crumbs = useMemo(() => {
    // Order detail route: /orders/:id
    if (location.startsWith("/orders/") && location.length > 8) {
      const id = location.slice(8);
      return ["Orders", id];
    }
    return PATH_LABELS[location] ?? ["—"];
  }, [location]);

  return (
    <nav
      className={cn(
        "hidden sm:flex items-center gap-1.5 text-[13px] text-muted-foreground min-w-0",
        className
      )}
      aria-label="Breadcrumb"
      data-testid="breadcrumbs"
    >
      <span className="whitespace-nowrap">JOAP</span>
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5 min-w-0">
          <ChevronRight className="w-3 h-3 opacity-55 shrink-0" />
          <span
            className={cn(
              "whitespace-nowrap max-w-[220px] overflow-hidden text-ellipsis",
              i === crumbs.length - 1 && "text-foreground font-semibold"
            )}
          >
            {c}
          </span>
        </span>
      ))}
    </nav>
  );
}
