import type { IOrderAssignedEvent, IOrderUnassignedEvent } from "@shared/schema";
import { PAYMENT_METHOD_LABELS, ORDER_TYPE_LABELS } from "@shared/schema";

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
}

export function unlockAudio() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {}
}

// ── Audio queue — prevents simultaneous playback ──────────────────────────────
const ttsQueue: string[] = [];
let ttsPlaying = false;

async function playNextInQueue(): Promise<void> {
  if (ttsPlaying || ttsQueue.length === 0) return;
  ttsPlaying = true;
  const text = ttsQueue.shift()!;
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();

    const token = localStorage.getItem("token");
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
      body: JSON.stringify({ text }),
    });
    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength) {
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        await new Promise<void>((resolve) => {
          const src = ctx.createBufferSource();
          src.buffer = decoded;
          src.connect(ctx.destination);
          src.onended = () => resolve();
          src.start(0);
        });
      }
    }
  } catch {
    // Silent fail — TTS is non-critical
  } finally {
    ttsPlaying = false;
    playNextInQueue();
  }
}

export function speakTTS(text: string): void {
  ttsQueue.push(text);
  playNextInQueue();
}

export function formatAmountForTTS(v: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

// ─── Assignment TTS scripts ───────────────────────────────────────────────────

function buildItemsSummary(items: Array<{ itemName: string; qty: number }>): string {
  if (items.length === 0) return "no items";
  if (items.length === 1) return `${items[0].qty} ${items[0].itemName}`;
  const shown = items.slice(0, 3);
  const rest = items.length - 3;
  const listed = shown.map((i) => `${i.qty} ${i.itemName}`).join(", ");
  return rest > 0 ? `${listed}, and ${rest} more item${rest > 1 ? "s" : ""}` : listed;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildAssignmentTTSScript(event: IOrderAssignedEvent): string {
  const payLabel =
    PAYMENT_METHOD_LABELS[event.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] ||
    event.paymentMethod;
  const typeLabel =
    ORDER_TYPE_LABELS[event.orderType as keyof typeof ORDER_TYPE_LABELS] || event.orderType;
  const itemsSummary = buildItemsSummary(event.items);
  const amountText = formatAmountForTTS(event.totalAmount);
  const assigneeName = capitalize(event.assignedTo);
  const assignerName = capitalize(event.assignedBy);

  if (event.isReassignment && event.previousAssignedTo) {
    const prevName = capitalize(event.previousAssignedTo);
    return (
      `Attention, ${assigneeName}. ${assignerName} has reassigned order ${event.trackingNumber} to you. ` +
      `This order was previously assigned to ${prevName}. ` +
      `Customer: ${event.customerName}. ` +
      `${event.items.length} item${event.items.length !== 1 ? "s" : ""}: ${itemsSummary}. ` +
      `Total amount: ${amountText} pesos. ` +
      `Payment method: ${payLabel}. ` +
      `Order type: ${typeLabel}. ` +
      `Please review and start processing this order.`
    );
  }

  // Self-claim
  if (event.assignedBy === event.assignedTo) {
    return (
      `You have claimed order ${event.trackingNumber}. ` +
      `Customer: ${event.customerName}. ` +
      `${event.items.length} item${event.items.length !== 1 ? "s" : ""} totaling ${amountText} pesos. ` +
      `${payLabel} payment. ` +
      `You may now start processing.`
    );
  }

  // Normal assignment
  return (
    `Attention, ${assigneeName}. ${assignerName} has assigned you a new order. ` +
    `Tracking number: ${event.trackingNumber}. ` +
    `Customer: ${event.customerName}. ` +
    `${event.items.length} item${event.items.length !== 1 ? "s" : ""}: ${itemsSummary}. ` +
    `Total amount: ${amountText} pesos. ` +
    `Payment method: ${payLabel}. ` +
    `Please start processing this order.`
  );
}

export function buildUnassignmentTTSScript(event: IOrderUnassignedEvent): string {
  const actorName = capitalize(event.actor);
  return (
    `Notice. ${actorName} has removed your assignment on order ${event.trackingNumber}. ` +
    `This order has been returned to the pending pool.`
  );
}

export function buildReassignmentRemovedTTSScript(event: IOrderAssignedEvent): string {
  const actorName = capitalize(event.assignedBy);
  const newAssigneeName = capitalize(event.assignedTo);
  return (
    `Notice. ${actorName} has reassigned order ${event.trackingNumber}, which was previously assigned to you, to ${newAssigneeName}. ` +
    `The order is no longer in your queue.`
  );
}
