import { Switch, Route, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { queryClient, startGlobalRealtimeSync } from "./lib/queryClient";
import { unlockAudio } from "@/lib/tts";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SettingsProvider } from "@/lib/settings-context";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { LiveClock } from "@/components/live-clock";
import { TweaksPanel } from "@/components/tweaks-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState, useEffect, useRef, useCallback } from "react";
import { Tutorial } from "@/components/tutorial";
import { Checkbox } from "@/components/ui/checkbox";
import { GraduationCap } from "lucide-react";
import { useSocketNotifications } from "@/hooks/use-socket-notifications";
import { FloatingCalculator } from "@/components/floating-calculator";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import InventoryPage from "@/pages/inventory";
import OrdersPage from "@/pages/orders";
import OrderDetailPage from "@/pages/order-detail";
import BillingPage from "@/pages/billing";
import UsersPage from "@/pages/users";
import AccountingPage from "@/pages/accounting";
import ReportsPage from "@/pages/reports";
import SettingsPage from "@/pages/settings";
import AboutPage from "@/pages/about";
import HelpPage from "@/pages/help";
import SystemLogsPage from "@/pages/system-logs";
import MaintenancePage from "@/pages/maintenance";
import OffersPage from "@/pages/offers";
import ReservationsPage from "@/pages/reservations";
import PendingPaymentPage from "@/pages/pending-payment";
import RequestsPage from "@/pages/requests";
import EmployeesPage from "@/pages/employees";
import ProfilePage from "@/pages/profile";

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAdmin } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    if (!isAdmin) {
      toast({ title: "Access restricted to administrators.", variant: "destructive" });
      navigate("/");
    }
  }, [isAdmin]);

  if (!isAdmin) return null;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/inventory" component={InventoryPage} />
      <Route path="/orders" component={OrdersPage} />
      <Route path="/orders/:id" component={OrderDetailPage} />
      <Route path="/billing" component={BillingPage} />
      <Route path="/offers">{() => <AdminRoute component={OffersPage} />}</Route>
      <Route path="/users" component={UsersPage} />
      <Route path="/accounting" component={AccountingPage} />
      <Route path="/reports" component={ReportsPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/about" component={AboutPage} />
      <Route path="/help" component={HelpPage} />
      <Route path="/system-logs" component={SystemLogsPage} />
      <Route path="/maintenance" component={MaintenancePage} />
      <Route path="/reservations" component={ReservationsPage} />
      <Route path="/pending-payment" component={PendingPaymentPage} />
      <Route path="/requests">{() => <AdminRoute component={RequestsPage} />}</Route>
      <Route path="/employees">{() => <AdminRoute component={EmployeesPage} />}</Route>
      <Route path="/profile" component={ProfilePage} />
      <Route component={NotFound} />
    </Switch>
  );
}


function AuthenticatedLayout() {
  const { logout, user, isAdmin } = useAuth();
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);

  // Global Socket.io listeners — TTS + toast for assignment events
  useSocketNotifications({ username: user?.username || "", enabled: !!user });
  const calcUsername = user?.username || "";
  const [showTutorialPrompt, setShowTutorialPrompt] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    const handler = () => { unlockAudio(); document.removeEventListener("click", handler, true); };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);

  // Start global 1-second real-time sync (in addition to per-query refetchInterval)
  useEffect(() => {
    startGlobalRealtimeSync();
  }, []);

  useEffect(() => {
    if (user) {
      const skipKey = `skipTutorial_${user.username}`;
      if (localStorage.getItem(skipKey) !== "true") {
        const timer = setTimeout(() => setShowTutorialPrompt(true), 800);
        return () => clearTimeout(timer);
      }
    }
  }, [user]);

  const handleTutorialNo = useCallback(() => {
    if (dontShowAgain && user) {
      localStorage.setItem(`skipTutorial_${user.username}`, "true");
    }
    setShowTutorialPrompt(false);
  }, [dontShowAgain, user]);

  const handleTutorialYes = useCallback(() => {
    if (dontShowAgain && user) {
      localStorage.setItem(`skipTutorial_${user.username}`, "true");
    }
    setShowTutorialPrompt(false);
    setShowTutorial(true);
  }, [dontShowAgain, user]);

  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center gap-3 px-4 sm:px-6 h-14 border-b sticky top-0 z-50 bg-background/85 backdrop-blur-md backdrop-saturate-150">
            <SidebarTrigger data-testid="button-sidebar-toggle" className="shrink-0" />
            <Breadcrumbs />
            <div className="flex-1" />
            <LiveClock />
            <span className="text-sm text-muted-foreground hidden md:inline pl-2 border-l border-border" data-testid="text-header-user">
              {user?.username}
            </span>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setShowLogoutDialog(true)} data-testid="button-logout" title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </header>
          <main className="flex-1 overflow-auto">
            <Router />
          </main>
        </div>
      </div>

      {/* Floating Calculator */}
      {calcUsername && <FloatingCalculator username={calcUsername} />}

      {/* Tweaks panel — floating, persists in localStorage */}
      <TweaksPanel />

      {/* TUTORIAL OVERHAUL: The Tutorial component needs to be overhauled.
          See task.txt for full instructions. Key changes:
          1. Replace Gemini TTS API with local MP3 files (tut1.mp3-tut17.mp3 in /tutorial_mp3/)
          2. Add "alive cursor" choreography system — cursor moves, clicks, types, hovers
             based on timed actions synced to MP3 narration
          3. For tut14 (Settings): save current settings before tutorial, apply random theme
             preview during narration, RESTORE original settings when tutorial completes
             (revert in the onComplete callback below)
          4. All cursor actions are non-destructive — they simulate UI interaction visually
             but don't persist any data changes */}
      {showTutorial && (
        <Tutorial isAdmin={isAdmin} onComplete={() => setShowTutorial(false)} />
      )}

      <AlertDialog open={showTutorialPrompt} onOpenChange={setShowTutorialPrompt}>
        <AlertDialogContent className="max-w-sm" data-testid="dialog-tutorial-prompt">
          <AlertDialogHeader>
            <div className="flex justify-center mb-2">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <GraduationCap className="h-6 w-6 text-primary" />
              </div>
            </div>
            <AlertDialogTitle className="text-center">Do you want to try the tutorial?</AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              A guided walkthrough of all system features with voice narration. Takes about 3 minutes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 px-1 py-2">
            <Checkbox
              id="dontShowAgain"
              checked={dontShowAgain}
              onCheckedChange={(v) => setDontShowAgain(!!v)}
              data-testid="checkbox-dont-show-tutorial"
            />
            <label htmlFor="dontShowAgain" className="text-sm text-muted-foreground cursor-pointer">
              Don't show again
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleTutorialNo} data-testid="button-tutorial-no">
              No
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleTutorialYes} data-testid="button-tutorial-yes">
              Yes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              You will be redirected to the login page and will need to sign in again to access the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-logout-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setShowLogoutDialog(false); logout(); }}
              data-testid="button-logout-confirm"
            >
              Sign Out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}

function AppContent() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <SettingsProvider>
      <AuthenticatedLayout />
    </SettingsProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
