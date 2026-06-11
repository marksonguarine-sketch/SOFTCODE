/**
 * Presence toaster + notification audio router (REQUEST.pdf round 11).
 *
 *   • Right-middle slide-in: "X has logged in / logged out".
 *     - Audience: ADMIN only by default (Inventory Manager + Employee never
 *       see these; they're noisy and not actionable for non-admins).
 *     - Audio: /mp3/notif_login.mp3 plays alongside the toast.
 *     - Each user can mute these via Settings → "Show login/logout alerts".
 *   • Bell-notification audio: any NEW notification fires a sound:
 *     - Chat-message notifications (title contains "message") → message_main.mp3
 *     - Everything else → notif_player.mp3
 *     - Inventory Managers only hear INVENTORY-category notifs (the bell
 *       already filters their inbox; this just gates the sound too).
 *   • Login-attempt banner: shows a security alert to the active user when
 *     someone else tries to log in with their credentials on another device.
 */
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { apiRequest } from "@/lib/queryClient";
import { LogIn, LogOut, ShieldAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

const PRESENCE_AUDIO = "/mp3/notif_login.mp3";
const NOTIF_AUDIO    = "/mp3/notif_player.mp3";
const MESSAGE_AUDIO  = "/mp3/message_main.mp3";
const TOAST_TTL_MS = 5000;

type ToastRow = { id: string; username: string; kind: "login" | "logout"; ts: number };

// localStorage flag toggled from Settings → "Show login/logout alerts"
function presenceMutedFor(currentUsername: string): boolean {
  try { return localStorage.getItem(`joap_presence_muted_${currentUsername}`) === "true"; } catch { return false; }
}

function play(src: string) {
  try {
    const a = new Audio(src);
    a.volume = 0.65;
    a.play().catch(() => { /* browser autoplay block — ignore */ });
  } catch { /* ignore */ }
}

export function PresenceToaster({ currentUser }: { currentUser: { username: string; role: string } }) {
  const [toasts, setToasts] = useState<ToastRow[]>([]);
  const [loginAttemptWarning, setLoginAttemptWarning] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const seenNotifIds = useRef<Set<string>>(new Set());

  const isAdmin = currentUser.role === "ADMIN";
  const isIM = currentUser.role === "INVENTORY_MANAGER";

  useEffect(() => {
    if (!currentUser.username) return;
    const socket = io({ transports: ["websocket", "polling"] });
    socketRef.current = socket;

    // ── Presence (admins only, opt-out via settings) ────────────────────
    if (isAdmin && !presenceMutedFor(currentUser.username)) {
      socket.on("presence:login", (data: { username: string }) => {
        if (!data?.username || data.username === currentUser.username) return;
        const row: ToastRow = { id: `${data.username}-${Date.now()}-in`, username: data.username, kind: "login", ts: Date.now() };
        setToasts((cur) => [...cur, row]);
        play(PRESENCE_AUDIO);
        setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== row.id)), TOAST_TTL_MS);
      });
      socket.on("presence:logout", (data: { username: string }) => {
        if (!data?.username || data.username === currentUser.username) return;
        const row: ToastRow = { id: `${data.username}-${Date.now()}-out`, username: data.username, kind: "logout", ts: Date.now() };
        setToasts((cur) => [...cur, row]);
        play(PRESENCE_AUDIO);
        setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== row.id)), TOAST_TTL_MS);
      });
    }

    // ── Login-attempt security alert (socket — primary path) ────────────
    // Server emits auth:login_attempt when someone tries to log in with this
    // user's credentials while this session is still active.
    socket.on("auth:login_attempt", (data: { username: string }) => {
      if (data?.username === currentUser.username) {
        setLoginAttemptWarning(true);
        play(PRESENCE_AUDIO);
      }
    });

    // ── Force-kick (admin/superadmin accounts) ───────────────────────────
    // Server emits auth:session_kicked when an admin logs in from a new
    // device, displacing any existing session. The displaced session must
    // log itself out immediately.
    socket.on("auth:session_kicked", (data: { username: string }) => {
      if (data?.username === currentUser.username) {
        localStorage.setItem("session_expired", "kicked");
        localStorage.removeItem("token");
        window.location.href = "/";
      }
    });

    // ── Notification audio routing ──────────────────────────────────────
    // Server emits NOTIFICATION_NEW with { _id, category, title, recipientUsername, recipientRole }
    // We peek the title to decide whether this is a chat message or a general
    // notification, then play the matching sound. We DO NOT play if the user
    // already heard it (de-duplicated by _id within this session).
    socket.on("NOTIFICATION_NEW", (data: any) => {
      const id = String(data?._id || "");
      if (!id || seenNotifIds.current.has(id)) return;
      seenNotifIds.current.add(id);

      // Audience filter (mirrors server delivery):
      const targetsMe = data.recipientUsername === currentUser.username
        || data.recipientRole === currentUser.role
        || (!data.recipientUsername && !data.recipientRole);
      if (!targetsMe) return;
      // IM only hears INVENTORY-class audio
      if (isIM && data.category !== "INVENTORY") return;

      const titleLower = String(data?.title || "").toLowerCase();
      const isMessage = data?.category === "MESSAGE" || titleLower.includes("message") || titleLower.includes("messaged");
      play(isMessage ? MESSAGE_AUDIO : NOTIF_AUDIO);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.username, currentUser.role]);

  // ── Polling fallback for login-attempt alert ─────────────────────────
  // Fires every 20 s so the banner appears even if the socket missed the
  // real-time event (e.g. brief reconnect window). The server stores a
  // 2-minute window for each blocked attempt and clears it on first read.
  useEffect(() => {
    if (!currentUser.username) return;
    const interval = setInterval(async () => {
      try {
        const res = await apiRequest("GET", "/api/auth/security-alert");
        const json = await res.json();
        if (json?.data?.alert) {
          setLoginAttemptWarning(true);
          play(PRESENCE_AUDIO);
        }
      } catch {
        // ignore — user might be logged out
      }
    }, 20_000);
    return () => clearInterval(interval);
  }, [currentUser.username]);

  // Best-effort logout broadcast — sent right before the tab closes so other
  // sessions get a "logged out" toast without waiting for the session-timeout
  // sweep.
  useEffect(() => {
    function fire() {
      try {
        navigator.sendBeacon?.("/api/auth/presence-ping", new Blob([JSON.stringify({ kind: "logout" })], { type: "application/json" }));
      } catch { /* ignore */ }
    }
    window.addEventListener("beforeunload", fire);
    return () => window.removeEventListener("beforeunload", fire);
  }, []);

  if (toasts.length === 0 && !loginAttemptWarning) return null;

  return (
    <>
      {/* Login-attempt security banner — persistent until dismissed */}
      {loginAttemptWarning && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] w-full max-w-md px-4"
          data-testid="login-attempt-warning"
        >
          <div className="rounded-lg border border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950/60 shadow-xl px-4 py-3 flex items-start gap-3">
            <span className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/60 grid place-items-center shrink-0 mt-0.5">
              <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-900 dark:text-red-200">
                New device sign-in attempt
              </p>
              <p className="text-[12px] text-red-800 dark:text-red-300 mt-0.5 leading-relaxed">
                A new device is trying to sign in with your credentials. If this
                is not you, <strong>change your password immediately</strong>. If
                this is you and you want to switch devices, log out first before
                proceeding.
              </p>
            </div>
            <button
              onClick={() => setLoginAttemptWarning(false)}
              className="shrink-0 mt-0.5 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-200 transition-colors"
              aria-label="Close"
              data-testid="login-attempt-close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Presence toasts */}
      {toasts.length > 0 && (
        <div className="fixed top-1/2 right-4 -translate-y-1/2 z-[60] flex flex-col gap-2 pointer-events-none" data-testid="presence-toaster">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                "pointer-events-auto min-w-[240px] rounded-lg border shadow-lg px-4 py-2.5 flex items-center gap-3 bg-card",
                "animate-in slide-in-from-right-4 fade-in-0 duration-200",
                t.kind === "login" ? "border-emerald-500/30" : "border-slate-500/30",
              )}
            >
              <span className={cn(
                "w-8 h-8 rounded-full grid place-items-center shrink-0",
                t.kind === "login"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                  : "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
              )}>
                {t.kind === "login" ? <LogIn className="w-4 h-4" /> : <LogOut className="w-4 h-4" />}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate" data-testid={`presence-${t.username}-${t.kind}`}>
                  {t.username}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t.kind === "login" ? "has logged in" : "has logged out"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
