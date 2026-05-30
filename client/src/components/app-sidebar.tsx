import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  CreditCard,
  BookOpen,
  BarChart3,
  TrendingUp,
  Users,
  Settings,
  Wrench,
  ScrollText,
  HelpCircle,
  Info,
  Tag,
  CalendarCheck,
  Clock,
  UserCircle,
  Inbox,
  UserSquare2,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";
import { useSettings, GRADIENT_OPTIONS } from "@/lib/settings-context";
import { useQuery } from "@tanstack/react-query";
import type { DashboardStats } from "@shared/schema";
import { cn } from "@/lib/utils";
import { JoapLogo } from "@/components/joap-logo";

/* ============================================================================
 * Sidebar — matches the JOAP prototype design:
 *   ┌─ Brand: amber tile (hammer) + "JOAP Hardware / Trading · Antipolo"
 *   ├─ OPERATIONS section (Dashboard, Inventory, Orders, Reservations, …)
 *   ├─ ADMIN section (Offers, Requests, Employees) — admin only
 *   ├─ SYSTEM section (Users, Settings, Maintenance, System Logs) — admin only
 *   └─ Footer: Help, About → user profile card (initials + name + role/shift)
 *
 * All existing data-testid attributes preserved.
 * Pending payment / requests / messages query logic untouched.
 * ============================================================================ */

const operationsNav = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Inventory", url: "/inventory", icon: Package },
  { title: "Orders", url: "/orders", icon: ShoppingCart },
  { title: "Reservations", url: "/reservations", icon: CalendarCheck },
  { title: "Billing", url: "/billing", icon: CreditCard },
  { title: "Accounting", url: "/accounting", icon: BookOpen },
  { title: "Reports", url: "/reports", icon: BarChart3 },
  { title: "Forecasting", url: "/forecasting", icon: TrendingUp },
];

const adminOpsNav = [
  { title: "Offers", url: "/offers", icon: Tag },
  { title: "Requests", url: "/requests", icon: Inbox },
  { title: "Employees", url: "/employees", icon: UserSquare2 },
];

const systemNav = [
  { title: "Users", url: "/users", icon: Users },
  { title: "Settings", url: "/settings", icon: Settings },
  { title: "Maintenance", url: "/maintenance", icon: Wrench },
  { title: "System Logs", url: "/system-logs", icon: ScrollText },
];

const footerNav = [
  { title: "Help", url: "/help", icon: HelpCircle },
  { title: "About", url: "/about", icon: Info },
];

/** Small badge used in the sidebar — circular pill, mono font. */
function NavBadge({ count, tone = "amber" }: { count: number; tone?: "amber" | "blue" | "warning" }) {
  if (count <= 0) return null;
  const toneCls =
    tone === "blue"
      ? "bg-sky-500 text-white"
      : tone === "warning"
        ? "bg-amber-500 text-amber-950"
        : "bg-primary text-primary-foreground";
  return (
    <span
      className={cn(
        "ml-auto text-[10px] font-mono font-bold leading-none rounded-full px-1.5 py-0.5 tabular-nums",
        toneCls
      )}
    >
      {count}
    </span>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const { isAdmin, isInventoryManager } = useAuth();
  const { settings } = useSettings();

  // Inventory managers only ever see the Inventory page.
  const visibleOperationsNav = isInventoryManager
    ? operationsNav.filter((i) => i.url === "/inventory")
    : operationsNav;

  // Pending payments — for the "Pending Payment" badge
  const { data: statsData } = useQuery<{ success: boolean; data: DashboardStats }>({
    queryKey: ["/api/dashboard/stats"],
    staleTime: 30_000,
  });
  const pendingPayments = statsData?.data?.pendingPayments ?? 0;

  // Open orders count — for the "Orders" badge
  const openOrders = useMemoCount(statsData?.data);

  // Pending requests (admin only)
  const { data: requestsData } = useQuery<{ success: boolean; data: any[] }>({
    queryKey: ["/api/requests?status=pending"],
    queryFn: async () => {
      const res = await fetch("/api/requests?status=pending", {
        credentials: "include",
        headers: localStorage.getItem("token")
          ? { Authorization: `Bearer ${localStorage.getItem("token")}` }
          : {},
      });
      return res.json();
    },
    enabled: isAdmin,
    staleTime: 30_000,
  });
  const pendingRequests = requestsData?.data?.length ?? 0;

  // Unread messages — for the "Help" badge
  const { data: messagesData } = useQuery<{ success: boolean; data: any[] }>({
    queryKey: ["/api/messages"],
    staleTime: 30_000,
  });
  const unreadMessages = (messagesData?.data || []).filter((m: any) => !m.isRead).length;

  const isActive = (url: string) => {
    if (url === "/") return location === "/";
    return location.startsWith(url);
  };

  // Apply sidebar gradient class based on user setting
  const gradientKey = settings?.gradient || "none";
  const gradient = GRADIENT_OPTIONS[gradientKey];
  const hasGradient = gradient && gradient.css;
  useEffect(() => {
    const sidebarInner = document.querySelector('[data-sidebar="sidebar"]');
    if (!sidebarInner) return;
    if (hasGradient) sidebarInner.classList.add("sidebar-gradient");
    else sidebarInner.classList.remove("sidebar-gradient");
    return () => {
      sidebarInner.classList.remove("sidebar-gradient");
    };
  }, [hasGradient]);

  return (
    <Sidebar>
      {/* ── Brand header ───────────────────────────────────────────────── */}
      <SidebarHeader className="px-3 pt-3.5 pb-2">
        <div className="flex items-center gap-2.5">
          <JoapLogo size={32} className="shrink-0 rounded-md shadow-sm" />
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-[13px] font-bold tracking-tight whitespace-nowrap" data-testid="text-brand-name">
              JOAP Hardware
            </span>
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              Trading · Antipolo
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarSeparator />

      {/* ── Nav body ───────────────────────────────────────────────────── */}
      <SidebarContent>
        {/* Operations */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/80 pt-3.5">
            Operations
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleOperationsNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    tooltip={item.title}
                  >
                    <Link
                      href={item.url}
                      data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                      {item.title === "Orders" && openOrders > 0 && (
                        <NavBadge count={openOrders} tone="amber" />
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              {/* Pending Payment — visible to all except inventory managers */}
              {!isInventoryManager && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive("/pending-payment")}
                    tooltip="Pending Payment"
                  >
                    <Link href="/pending-payment" data-testid="nav-pending-payment">
                      <Clock />
                      <span>Pending Payment</span>
                      <NavBadge count={pendingPayments} tone="warning" />
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Profile — employees only */}
              {!isAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive("/profile")}
                    tooltip="Profile"
                  >
                    <Link href="/profile" data-testid="nav-profile">
                      <UserCircle />
                      <span>My Profile</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Settings — for non-admins, lives here under Operations */}
              {!isAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive("/settings")}
                    tooltip="Settings"
                  >
                    <Link href="/settings" data-testid="nav-settings">
                      <Settings />
                      <span>Settings</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Admin */}
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/80 pt-3">
              Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminOpsNav.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item.url)}
                      tooltip={item.title}
                    >
                      <Link
                        href={item.url}
                        data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                        {item.title === "Requests" && (
                          <NavBadge count={pendingRequests} tone="warning" />
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* System */}
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/80 pt-3">
              System
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {systemNav.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item.url)}
                      tooltip={item.title}
                    >
                      <Link
                        href={item.url}
                        data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarSeparator />

      {/* ── Footer: help / about only — user-profile card moved to header ── */}
      <SidebarFooter className="px-2 pb-3">
        <SidebarMenu>
          {footerNav.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                isActive={isActive(item.url)}
                tooltip={item.title}
              >
                <Link
                  href={item.url}
                  data-testid={`nav-${item.title.toLowerCase()}`}
                >
                  <item.icon />
                  <span>{item.title}</span>
                  {item.title === "Help" && (
                    <NavBadge count={unreadMessages} tone="blue" />
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * Open-orders count for the sidebar badge.
 * Derived from DashboardStats payment-status buckets — uses `pending_payment`
 * + `partial` as a proxy for "open orders that need attention".
 */
function useMemoCount(stats?: DashboardStats): number {
  if (!stats) return 0;
  const buckets = stats.paymentStatusCounts || {};
  return (buckets.pending_payment || 0) + (buckets.partial || 0);
}
