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
 */
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { apiRequest } from "@/lib/queryClient";
import { LogIn, LogOut } from "lucide-react";
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

  if (toasts.length === 0) return null;

  return (
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
  );
}
