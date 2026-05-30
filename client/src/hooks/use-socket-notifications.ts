import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { speakTTS, buildAssignmentTTSScript, buildUnassignmentTTSScript, buildReassignmentRemovedTTSScript } from "@/lib/tts";
import { useToast } from "@/hooks/use-toast";
import type { IOrderAssignedEvent, IOrderUnassignedEvent } from "@shared/schema";
import { queryClient } from "@/lib/queryClient";

interface UseSocketNotificationsOptions {
  username: string;
  enabled: boolean;
}

function isTtsEnabled(username: string): boolean {
  return localStorage.getItem(`joap_tts_${username}`) !== "false";
}

function invalidateOrderQueries() {
  queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
  queryClient.invalidateQueries({ queryKey: ["/api/orders?assignedToMe=true"] });
  queryClient.invalidateQueries({ queryKey: ["/api/orders?pool=true"] });
  queryClient.invalidateQueries({ queryKey: ["/api/orders/my-active"] });
  queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
}

export function useSocketNotifications({ username, enabled }: UseSocketNotificationsOptions) {
  const { toast } = useToast();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enabled || !username) return;

    const socket = io({ transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[socket] connected:", socket.id);
    });

    socket.on("disconnect", () => {
      console.log("[socket] disconnected");
    });

    socket.on("reconnect", () => {
      console.log("[socket] reconnected");
    });

    // ── Order assigned / claimed ──────────────────────────────────────────────
    socket.on("order:assigned", (data: IOrderAssignedEvent) => {
      invalidateOrderQueries();

      if (data.assignedTo === username) {
        // This user is the new assignee
        if (isTtsEnabled(username)) {
          speakTTS(buildAssignmentTTSScript(data));
        }
        toast({
          title: `Order ${data.trackingNumber} assigned to you`,
          description: `By ${data.assignedBy}. Customer: ${data.customerName}`,
        });
      } else if (data.isReassignment && data.previousAssignedTo === username) {
        // This user had the order but it was taken and given to someone else
        if (isTtsEnabled(username)) {
          speakTTS(buildReassignmentRemovedTTSScript(data));
        }
        toast({
          title: `Order ${data.trackingNumber} reassigned`,
          description: `${data.assignedBy} moved this order to ${data.assignedTo}`,
          variant: "destructive",
        });
      }
    });

    // ── Order unassigned ──────────────────────────────────────────────────────
    socket.on("order:unassigned", (data: IOrderUnassignedEvent) => {
      invalidateOrderQueries();

      if (data.previousAssignedTo === username) {
        if (isTtsEnabled(username)) {
          const script = buildUnassignmentTTSScript(data);
          speakTTS(script);
        }
        toast({
          title: `Order ${data.trackingNumber} unassigned`,
          description: `Returned to pool by ${data.actor}`,
          variant: "destructive",
        });
      }
    });

    // ── Status changed ────────────────────────────────────────────────────────
    socket.on("order:status-changed", () => {
      invalidateOrderQueries();
    });

    // ── Order created ─────────────────────────────────────────────────────────
    socket.on("order:created", () => {
      invalidateOrderQueries();
    });

    // ── Billing payment ───────────────────────────────────────────────────────
    socket.on("billing:payment", () => {
      invalidateOrderQueries();
      queryClient.invalidateQueries({ queryKey: ["/api/billing"] });
    });

    // ── Payment logged (from /api/billing/pay) ────────────────────────────────
    socket.on("PAYMENT_LOGGED", () => {
      invalidateOrderQueries();
      queryClient.invalidateQueries({ queryKey: ["/api/billing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/advanced"] });
    });

    // ── Order released (revenue finalized) ────────────────────────────────────
    socket.on("ORDER_RELEASED", () => {
      invalidateOrderQueries();
      queryClient.invalidateQueries({ queryKey: ["/api/billing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/advanced"] });
    });

    // ── Ledger posted ─────────────────────────────────────────────────────────
    socket.on("LEDGER_POSTED", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/accounts"] });
    });

    // ── Dashboard stats updated (generic trigger) ─────────────────────────────
    socket.on("DASHBOARD_STATS_UPDATED", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/advanced"] });
    });

    // ── Inventory log created ─────────────────────────────────────────────────
    socket.on("INVENTORY_LOG_CREATED", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    });

    // ── Items collection changed (add/edit/delete) — push to every session ──
    socket.on("ITEMS_CHANGED", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    });

    // ── Item-request lifecycle ────────────────────────────────────────────────
    socket.on("ITEM_REQUEST_CREATED", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/item-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    });
    socket.on("ITEM_REQUEST_UPDATED", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/item-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    });

    // ── Notifications — refetch bell + counts ─────────────────────────────────
    socket.on("NOTIFICATION_NEW", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [username, enabled]);

  return socketRef;
}
