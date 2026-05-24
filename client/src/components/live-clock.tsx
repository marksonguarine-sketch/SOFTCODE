import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * LiveClock — live Philippine Time clock for the global header.
 * Updates every second. Format: "Sun, May 24 · 14:38:22 PHT"
 */
export function LiveClock({ className }: { className?: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Manila",
  };
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Manila",
  };

  return (
    <div
      className={cn(
        "hidden md:flex items-center gap-2 pl-3 ml-1 border-l border-border",
        "font-mono text-[12px] text-muted-foreground tabular-nums",
        className
      )}
      data-testid="live-clock"
    >
      <span
        className="w-[6px] h-[6px] rounded-full bg-emerald-500"
        style={{ boxShadow: "0 0 0 3px hsl(152 56% 41% / 0.18)" }}
      />
      <span>{now.toLocaleDateString("en-PH", dateOpts)}</span>
      <span className="opacity-50">·</span>
      <span>{now.toLocaleTimeString("en-PH", timeOpts)} PHT</span>
    </div>
  );
}
