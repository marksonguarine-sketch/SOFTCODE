import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { speakTTS, buildAssignmentTTSScript, buildUnassignmentTTSScript } from "@/lib/tts";
import { useToast } from "@/hooks/use-toast";
import type { IOrderAssignedEvent, IOrderUnassignedEvent } from "@shared/schema";
import { queryClient } from "@/lib/queryClient";

interface UseSocketNotificationsOptions {
  username: string;
  enabled: boolean;
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
      // Invalidate caches so pages auto-refresh
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });

      if (data.assignedTo === username) {
        const script = buildAssignmentTTSScript(data);
        speakTTS(script);
        toast({
          title: `Order ${data.trackingNumber} assigned to you`,
          description: `By ${data.assignedBy}. Customer: ${data.customerName}`,
        });
      }
    });

    // ── Order unassigned ──────────────────────────────────────────────────────
    socket.on("order:unassigned", (data: IOrderUnassignedEvent) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });

      if (data.previousAssignedTo === username) {
        const script = buildUnassignmentTTSScript(data);
        speakTTS(script);
        toast({
          title: `Order ${data.trackingNumber} unassigned`,
          description: `Returned to pool by ${data.actor}`,
          variant: "destructive",
        });
      }
    });

    // ── Status changed ────────────────────────────────────────────────────────
    socket.on("order:status-changed", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    });

    // ── Order created ─────────────────────────────────────────────────────────
    socket.on("order:created", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    });

    // ── Billing payment ───────────────────────────────────────────────────────
    socket.on("billing:payment", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [username, enabled]);

  return socketRef;
}
