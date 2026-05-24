/**
 * Heatmap — peak hours grid (7 days × 24 hours).
 * Colors cells by value, hover for count tooltip.
 *
 * Sample data shape:
 *   [{ day: 'Mon', values: [0,0,0,...,2,4,6,...,0] }, ...]
 */
import { useState } from "react";
import { cn } from "@/lib/utils";

interface HeatmapRow {
  day: string;
  values: number[];
}

interface HeatmapProps {
  grid: HeatmapRow[];
  format?: (v: number) => string;
  className?: string;
}

export function Heatmap({ grid, format = (v) => `${v} orders`, className }: HeatmapProps) {
  const [hover, setHover] = useState<{ r: number; c: number; v: number; day: string } | null>(null);

  const max = Math.max(1, ...grid.flatMap((r) => r.values));
  const cellW = 22, cellH = 18, gap = 2, labelW = 38;
  const W = labelW + 24 * (cellW + gap);
  const H = 16 + 7 * (cellH + gap);

  const colorFor = (v: number) => {
    if (v === 0) return "hsl(var(--muted))";
    const t = v / max;
    // Amber ramp — light to deep
    return `oklch(${0.96 - t * 0.32} ${0.05 + t * 0.13} 75)`;
  };

  return (
    <div className={cn("relative overflow-x-auto", className)}>
      <svg width={W} height={H} className="block">
        {/* Column headers — every 3 hours */}
        {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
          <text
            key={h}
            x={labelW + h * (cellW + gap) + cellW / 2}
            y={12}
            textAnchor="middle"
            fontSize="9.5"
            fontFamily="var(--font-mono)"
            fill="hsl(var(--muted-foreground))"
          >
            {h.toString().padStart(2, "0")}
          </text>
        ))}

        {/* Rows */}
        {grid.map((row, ri) => (
          <g key={ri}>
            <text
              x={labelW - 6}
              y={20 + ri * (cellH + gap) + cellH * 0.7}
              textAnchor="end"
              fontSize="10.5"
              fontFamily="var(--font-sans)"
              fontWeight="600"
              fill="hsl(var(--muted-foreground))"
            >
              {row.day}
            </text>
            {row.values.map((v, ci) => (
              <rect
                key={ci}
                x={labelW + ci * (cellW + gap)}
                y={20 + ri * (cellH + gap)}
                width={cellW}
                height={cellH}
                rx="2.5"
                fill={colorFor(v)}
                stroke={hover && hover.r === ri && hover.c === ci ? "hsl(var(--primary))" : "transparent"}
                strokeWidth={1.5}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHover({ r: ri, c: ci, v, day: row.day })}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </g>
        ))}
      </svg>

      {hover && (
        <div
          className="absolute pointer-events-none rounded-md px-2.5 py-1.5 text-[11.5px] font-mono font-semibold whitespace-nowrap shadow-md bg-foreground text-background"
          style={{
            left: labelW + hover.c * (cellW + gap) - 40,
            top: 20 + hover.r * (cellH + gap) - 38,
            minWidth: 110,
          }}
        >
          <div className="font-sans font-semibold text-[11px] opacity-70">
            {hover.day} · {hover.c.toString().padStart(2, "0")}:00
          </div>
          <div>{format(hover.v)}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Generate a synthetic peak-hours grid for stores that don't yet record
 * hourly metrics. Shape: morning + afternoon peak, low at night.
 *
 * Replace with real API data when /api/dashboard/peak-hours is available.
 */
export function generateSyntheticPeakHours(seed = 1): HeatmapRow[] {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const rng = mulberry32(seed);
  return days.map((day, d) => {
    const values: number[] = [];
    for (let h = 0; h < 24; h++) {
      let v = 0;
      if (h >= 7 && h <= 11) v = 3 + Math.sin((h - 7) * 0.6) * 3 + (d === 5 ? 2 : 0);
      else if (h >= 13 && h <= 17)
        v = 4 + Math.sin((h - 13) * 0.5) * 3 + (d === 5 ? 2 : 0) + (d === 6 ? 1 : 0);
      else if (h >= 6 && h < 7) v = 1.5;
      else if (h >= 18 && h <= 19) v = 2;
      v = Math.max(0, v + (rng() * 0.6 - 0.3));
      values.push(Math.round(v));
    }
    return { day, values };
  });
}

/** Deterministic small PRNG for the synthetic data above. */
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
