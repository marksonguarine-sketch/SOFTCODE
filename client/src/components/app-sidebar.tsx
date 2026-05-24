import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  CreditCard,
  BookOpen,
  BarChart3,
  Users,
  Settings,
  Wrench,
  ScrollText,
  HelpCircle,
  Info,
  Hammer,
  Tag,
  CalendarCheck,
  Clock,
  UserCircle,
  Inbox,
  UserSquare2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

const mainNavItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Inventory", url: "/inventory", icon: Package },
  { title: "Orders", url: "/orders", icon: ShoppingCart },
  { title: "Reservations", url: "/reservations", icon: CalendarCheck },
  { title: "Billing", url: "/billing", icon: CreditCard },
  { title: "Accounting", url: "/accounting", icon: BookOpen },
  { title: "Reports", url: "/reports", icon: BarChart3 },
];

const adminOnlyNavItems = [
  { title: "Offers", url: "/offers", icon: Tag },
  { title: "Requests", url: "/requests", icon: Inbox },
  { title: "Employees", url: "/employees", icon: UserSquare2 },
];

const adminNavItems = [
  { title: "Users", url: "/users", icon: Users },
  { title: "Settings", url: "/settings", icon: Settings },
  { title: "Maintenance", url: "/maintenance", icon: Wrench },
  { title: "System Logs", url: "/system-logs", icon: ScrollText },
];

const bottomNavItems = [
  { title: "Help", url: "/help", icon: HelpCircle },
  { title: "About", url: "/about", icon: Info },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { isAdmin, user } = useAuth();
  const { settings } = useSettings();

  const { data: statsData } = useQuery<{ success: boolean; data: DashboardStats }>({
    queryKey: ["/api/dashboard/stats"],
    staleTime: 30000,
  });
  const pendingPayments = statsData?.data?.pendingPayments ?? 0;

  // Pending requests count (admin only)
  const { data: requestsData } = useQuery<{ success: boolean; data: any[] }>({
    queryKey: ["/api/requests?status=pending"],
    queryFn: async () => {
      const res = await fetch("/api/requests?status=pending", {
        credentials: "include",
        headers: localStorage.getItem("token") ? { Authorization: `Bearer ${localStorage.getItem("token")}` } : {},
      });
      return res.json();
    },
    enabled: isAdmin,
    staleTime: 30000,
  });
  const pendingRequests = requestsData?.data?.length ?? 0;

  // Unread messages count
  const { data: messagesData } = useQuery<{ success: boolean; data: any[] }>({
    queryKey: ["/api/messages"],
    staleTime: 30000,
  });
  const unreadMessages = (messagesData?.data || []).filter((m: any) => !m.isRead).length;

  const isActive = (url: string) => {
    if (url === "/") return location === "/";
    return location.startsWith(url);
  };

  const gradientKey = settings?.gradient || "none";
  const gradient = GRADIENT_OPTIONS[gradientKey];
  const hasGradient = gradient && gradient.css;

  useEffect(() => {
    const sidebarInner = document.querySelector('[data-sidebar="sidebar"]');
    if (!sidebarInner) return;
    if (hasGradient) {
      sidebarInner.classList.add("sidebar-gradient");
    } else {
      sidebarInner.classList.remove("sidebar-gradient");
    }
    return () => {
      sidebarInner.classList.remove("sidebar-gradient");
    };
  }, [hasGradient]);

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-3">
          <div className="flex items-center justify-center rounded-lg bg-primary p-2 shadow-sm ring-1 ring-primary/20">
            <Hammer className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-bold tracking-tight" data-testid="text-brand-name">JOAP Hardware</span>
            <span className="text-[11px] text-muted-foreground font-medium">Trading · Tarlac</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              {/* Pending Payment — visible to all */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/pending-payment")} tooltip="Pending Payment">
                  <Link href="/pending-payment" data-testid="nav-pending-payment">
                    <Clock />
                    <span>Pending Payment</span>
                    {pendingPayments > 0 && (
                      <Badge className="ml-auto text-[10px] h-4 px-1.5 bg-yellow-500 text-white border-transparent">
                        {pendingPayments}
                      </Badge>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {isAdmin && adminOnlyNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                      <item.icon />
                      <span>{item.title}</span>
                      {item.title === "Requests" && pendingRequests > 0 && (
                        <Badge className="ml-auto text-[10px] h-4 px-1.5 bg-amber-500 text-white border-transparent">
                          {pendingRequests}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              {/* Profile — employees only */}
              {!isAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/profile")} tooltip="Profile">
                    <Link href="/profile" data-testid="nav-profile">
                      <UserCircle />
                      <span>My Profile</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Settings — visible to employees too */}
              {!isAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/settings")} tooltip="Settings">
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

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminNavItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                      <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
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
      <SidebarFooter>
        <SidebarMenu>
          {bottomNavItems.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                <Link href={item.url} data-testid={`nav-${item.title.toLowerCase()}`}>
                  <item.icon />
                  <span>{item.title}</span>
                  {item.title === "Help" && unreadMessages > 0 && (
                    <Badge className="ml-auto text-[10px] h-4 px-1.5 bg-blue-500 text-white border-transparent">
                      {unreadMessages}
                    </Badge>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        {user && (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            Logged in as <span className="font-medium text-foreground" data-testid="text-current-user">{user.username}</span>
            <Badge variant="outline" className="ml-1 text-[10px]">{user.role}</Badge>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
