import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, AlertTriangle, ArrowRight, MonitorSmartphone } from "lucide-react";
import { JoapLogo } from "@/components/joap-logo";
import { loginSchema, type LoginInput } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/**
 * Login page — split-screen layout matching the JOAP prototype.
 *
 *   ┌─────────────────────┬───────────────────────────┐
 *   │  branded dark side  │   form on neutral side    │
 *   │  (dot-matrix bg)    │                           │
 *   └─────────────────────┴───────────────────────────┘
 *
 * On <960px the dark side hides and the form goes full-width.
 */
export default function LoginPage() {
  const { login } = useAuth();
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [activeSessionBlocked, setActiveSessionBlocked] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [liveStats, setLiveStats] = useState<{
    ordersToday: number;
    totalItems: number;
    totalStaff: number;
  }>({
    ordersToday: 0,
    totalItems: 0,
    totalStaff: 0,
  });
  useEffect(() => {
    const expiredFlag = localStorage.getItem("session_expired");
    if (expiredFlag === "1" || expiredFlag === "idle" || expiredFlag === "kicked") {
      setSessionExpired(true);
      localStorage.removeItem("session_expired");
    }

    async function fetchStats() {
      try {
        const res = await fetch("/api/public/stats");
        if (!res.ok) return;
        const json = await res.json();
        if (json?.data) {
          setLiveStats({
            ordersToday: Number(json.data.ordersToday) || 0,
            totalItems: Number(json.data.totalItems) || 0,
            totalStaff: Number(json.data.totalStaff) || 0,
          });
        }
      } catch {
        /* ignore */
      }
    }
    fetchStats();
    const iv = setInterval(fetchStats, 20000);
    return () => clearInterval(iv);
  }, []);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = async (values: LoginInput) => {
    setError("");
    setActiveSessionBlocked(false);
    setIsLoading(true);
    try {
      await login(values.username, values.password);
    } catch (err: any) {
      if (err.message === "ALREADY_ACTIVE_SESSION") {
        setActiveSessionBlocked(true);
      } else {
        setError(err.message || "Invalid credentials");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2">
      {/* Left — branded side */}
      <div
        className="hidden md:flex flex-col justify-between p-10 relative overflow-hidden text-slate-100"
        style={{
          background:
            "linear-gradient(160deg, hsl(220 20% 13%) 0%, hsl(220 18% 9%) 100%)",
        }}
      >
        {/* Dot-matrix pattern */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />

        {/* Brand */}
        <div className="relative flex items-center gap-3">
          <JoapLogo size={44} className="rounded-lg shadow-md" />
          <div>
            <div className="text-[15px] font-bold tracking-tight">
              JOAP Hardware
            </div>
            <div className="text-[12px] text-slate-400">Trading · Antipolo</div>
          </div>
        </div>

        {/* Headline */}
        <div className="relative max-w-md">
          <h2 className="text-[34px] font-bold leading-tight tracking-tight mb-3">
            One system for every
            <br />
            order, item, and peso.
          </h2>


          {/* Mini metrics — live from server */}
          <div className="grid grid-cols-3 gap-4 mt-8">
            {[
              {
                label: "Orders today",
                value: (liveStats?.ordersToday ?? 0).toLocaleString(),
              },
              {
                label: "Items tracked",
                value: (liveStats?.totalItems ?? 0).toLocaleString(),
              },
              {
                label: "Total staff",
                value: (liveStats?.totalStaff ?? 0).toLocaleString(),
              },
            ].map((m) => (
              <div key={m.label}>
                <div className="font-mono text-[22px] font-semibold tracking-tight text-amber-300 tabular-nums">
                  {m.value}
                </div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500 mt-1">
                  {m.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="relative text-[11px] text-slate-500">
          © 2026 JOAP Hardware Trading · v3.2
        </div>
      </div>

      {/* Right — form side */}
      <div className="grid place-items-center p-6 sm:p-10 bg-background">
        <div className="w-full max-w-sm">
          {/* Mobile brand */}
          <div className="md:hidden flex items-center gap-3 mb-8">
            <JoapLogo size={40} className="rounded-lg" />
            <div>
              <div className="text-[14px] font-bold tracking-tight">
                JOAP Hardware
              </div>
              <div className="text-[11px] text-muted-foreground">
                Trading · Antipolo
              </div>
            </div>
          </div>

          <h1
            className="text-[24px] font-bold tracking-tight mb-1.5"
            data-testid="text-login-title"
          >
            Welcome back
          </h1>
          <p className="text-[13px] text-muted-foreground mb-7">
            Sign in to continue to the ERP dashboard.
          </p>

          {sessionExpired && (
            <div
              className="mb-5 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/40 px-3 py-2.5 text-[12.5px] text-amber-900 dark:text-amber-200"
              data-testid="alert-session-expired"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Your session was ended because the account was logged in
                elsewhere. Please log in again.
              </span>
            </div>
          )}

          {activeSessionBlocked && (
            <div
              className="mb-5 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800/60 dark:bg-blue-950/40 px-3 py-2.5 text-[12.5px] text-blue-900 dark:text-blue-200"
              data-testid="alert-active-session"
            >
              <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
              <span>
                You are currently logged in on another device. Please log out
                from that device before signing in here.
              </span>
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Username
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="andre.cabilao"
                        className="h-10"
                        data-testid="input-username"
                        autoComplete="username"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Password
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        className="h-10"
                        data-testid="input-password"
                        autoComplete="current-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {error && (
                <div
                  className="text-[12.5px] text-destructive flex items-center gap-1.5"
                  data-testid="text-login-error"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-10 font-semibold"
                disabled={isLoading}
                data-testid="button-login"
              >
                {isLoading && (
                  <Loader2 className="animate-spin mr-1.5 h-4 w-4" />
                )}
                {isLoading ? (
                  "Signing in…"
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </>
                )}
              </Button>

              <div className="text-center text-[11.5px] text-muted-foreground pt-2 flex items-center justify-center gap-2">
                <span>Trouble signing in?</span>
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground transition-colors"
                  onClick={() => setForgotOpen(true)}
                  data-testid="link-forgot-password"
                >
                  Forgot password?
                </button>
              </div>
            </form>
          </Form>
        </div>
      </div>

      {/* Forgot-password dialog (REQUEST.pdf R11 §6) */}
      <ForgotPasswordDialog open={forgotOpen} onClose={() => setForgotOpen(false)} />
    </div>
  );
}

/**
 * Forgot-password dialog — files a PASSWORD_RESET Request that admins
 * (including super-admin) see in Requests → Others. They click Reset
 * Password from there and jump to the Users page to set a new password.
 *
 * Race-safe on the server: only the first admin to claim the request
 * succeeds; concurrent admins get a 409 with the winner's name.
 */
function ForgotPasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  function reset() {
    setUsername("");
    setSubmitting(false);
    setSubmitted(false);
    setErrMsg("");
  }

  async function submit() {
    setErrMsg("");
    if (!username.trim()) { setErrMsg("Enter your username"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });
      const j = await res.json();
      if (!j?.success) {
        setErrMsg(j?.error || "Could not file your request");
      } else {
        setSubmitted(true);
      }
    } catch (e: any) {
      setErrMsg(e?.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); reset(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Forgot password</DialogTitle>
          <DialogDescription>
            Enter your username and we'll notify the administrators to reset it.
            For your security, the system never reveals whether a username exists.
          </DialogDescription>
        </DialogHeader>
        {submitted ? (
          <div className="space-y-3">
            <p className="text-sm">
              ✓ If <strong>{username}</strong> exists, the admin team has been notified.
              Watch for a temporary password from your administrator.
            </p>
            <div className="flex justify-end">
              <Button onClick={() => { onClose(); reset(); }}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              placeholder="Your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && username.trim()) submit(); }}
              autoFocus
              data-testid="input-forgot-username"
            />
            {errMsg && <p className="text-xs text-destructive">{errMsg}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { onClose(); reset(); }}>Cancel</Button>
              <Button onClick={submit} disabled={submitting || !username.trim()} data-testid="button-forgot-notify">
                {submitting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Notify Admin
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
