import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

/**
 * Live PHT (Philippine Time, UTC+8) clock that updates every second.
 * Used in the header to give the app a "command center" feel.
 */
export function LiveClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const date = now.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground font-mono tabular-nums">
      <Clock className="h-3 w-3 text-primary" />
      <span className="font-medium text-foreground">{time}</span>
      <span className="text-muted-foreground/70">·</span>
      <span>{date}</span>
      <span className="text-muted-foreground/50 ml-0.5">PHT</span>
    </div>
  );
}
