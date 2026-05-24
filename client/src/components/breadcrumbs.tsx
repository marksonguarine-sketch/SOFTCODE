import { useLocation } from "wouter";
import { ChevronRight, Home } from "lucide-react";
import { Link } from "wouter";

const LABELS: Record<string, string> = {
  "": "Dashboard",
  "inventory": "Inventory",
  "orders": "Orders",
  "billing": "Billing",
  "offers": "Offers",
  "users": "Users",
  "accounting": "Accounting",
  "reports": "Reports",
  "settings": "Settings",
  "about": "About",
  "help": "Help",
  "system-logs": "System Logs",
  "maintenance": "Maintenance",
  "reservations": "Reservations",
  "pending-payment": "Pending Payment",
  "requests": "Requests",
  "employees": "Employees",
  "profile": "Profile",
};

function prettify(seg: string): string {
  return LABELS[seg] || seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Breadcrumb trail derived from the current route. Shows Home › Section › [Subsection].
 * Renders nothing on the root dashboard route.
 */
export function Breadcrumbs() {
  const [location] = useLocation();
  const segments = location.split("/").filter(Boolean);

  if (segments.length === 0) return null;

  return (
    <nav className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground" aria-label="Breadcrumb">
      <Link href="/" className="flex items-center gap-1 hover:text-foreground transition-colors">
        <Home className="h-3 w-3" />
      </Link>
      {segments.map((seg, idx) => {
        const isLast = idx === segments.length - 1;
        const href = "/" + segments.slice(0, idx + 1).join("/");
        return (
          <span key={href} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            {isLast ? (
              <span className="text-foreground font-medium">{prettify(seg)}</span>
            ) : (
              <Link href={href} className="hover:text-foreground transition-colors">
                {prettify(seg)}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
