import { useId, useState } from "react";
import { cn } from "@/lib/utils";

/* ============================================================================
 * Charts — lightweight TypeScript chart components matching the JOAP prototype.
 * Built with raw SVG for maximum control + tiny bundle size. All hoverable.
 * Use these where Recharts is overkill or you need a specific design treatment.
 * ============================================================================ */

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

/** Tiny inline sparkline (no axes, no tooltip). Use inside KPI cards. */
export function Sparkline({
  data,
  width = 120,
  height = 36,
  color = "hsl(var(--primary))",
  className,
}: SparklineProps) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const step = width / (data.length - 1);
  const range = Math.max(1, max - min);
  const pts = data.map((v, i) => [i * step, height - ((v - min) / range) * (height - 4) - 2] as const);
  const path = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;
  const last = pts[pts.length - 1];

  return (
    <svg width={width} height={height} className={cn("block", className)}>
      <path d={area} fill={color} opacity={0.12} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );
}

interface RingProps {
  value: number;
  target: number;
  size?: number;
  label?: string;
  className?: string;
}

/** Progress ring — used for daily-goal display. */
export function Ring({ value, target, size = 120, label, className }: RingProps) {
  const pct = Math.max(0, Math.min(1, value / target));
  const strokeWidth = 10;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct);
  return (
    <div className={cn("relative inline-block", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={strokeWidth}
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
          style={{
            transition: "stroke-dashoffset 600ms cubic-bezier(.2,.8,.2,1)",
            transform: "rotate(-90deg)",
            transformOrigin: "center",
          }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-mono text-[22px] font-semibold leading-none tabular-nums">
            {Math.round(pct * 100)}%
          </div>
          {label && <div className="text-[11px] text-muted-foreground mt-1">{label}</div>}
        </div>
      </div>
    </div>
  );
}

interface AgingProps {
  /** 'fresh' (<1d) | 'warm' (1–3d) | 'overdue' (>3d) */
  age: "fresh" | "warm" | "overdue";
  label?: string;
}

/** Aging dot — for order-list rows. Color codes how old the order is. */
export function Aging({ age, label }: AgingProps) {
  const defaultLabel = age === "fresh" ? "< 1 day" : age === "warm" ? "1–3 days" : "> 3 days";
  const color =
    age === "fresh"
      ? "bg-emerald-500"
      : age === "warm"
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground font-mono tabular-nums">
      <span className={cn("w-[7px] h-[7px] rounded-full shrink-0", color)} />
      {label ?? defaultLabel}
    </span>
  );
}

interface AreaChartProps {
  data: number[];
  labels: string[];
  height?: number;
  format?: (v: number) => string;
  color?: string;
  gridY?: number;
  className?: string;
}

/** Hand-rolled area chart with hover tooltip. Replaces Recharts when you want
 *  a tighter, more designerly look. */
export function AreaChart({
  data,
  labels,
  height = 220,
  format = (v) => String(v),
  color = "hsl(var(--primary))",
  gridY = 4,
  className,
}: AreaChartProps) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const [bbox, setBbox] = useState({ width: 640, height });

  const padL = 44, padR = 18, padT = 12, padB = 28;
  const W = bbox.width, H = height;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(...data) * 1.15;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;
  const points = data.map((v, i) => [padL + i * stepX, padT + innerH - (v / max) * innerH] as const);

  const pathLine = points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const pathArea = `${pathLine} L${padL + innerW},${padT + innerH} L${padL},${padT + innerH} Z`;

  const yTicks: { v: number; y: number }[] = [];
  for (let i = 0; i <= gridY; i++) {
    const t = i / gridY;
    yTicks.push({ v: Math.round(max - t * max), y: padT + t * innerH });
  }

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (stepX === 0) return;
    const i = Math.max(0, Math.min(data.length - 1, Math.round((x - padL) / stepX)));
    setHover(i);
  }

  return (
    <div
      className={cn("relative w-full", className)}
      ref={(el) => {
        if (!el) return;
        const ro = new ResizeObserver((entries) =>
          setBbox({ width: entries[0].contentRect.width, height })
        );
        ro.observe(el);
        return () => ro.disconnect();
      }}
    >
      <svg width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block">
        <defs>
          <linearGradient id={`grad-${uid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={t.y}
              y2={t.y}
              stroke="hsl(var(--border))"
              strokeDasharray={i === yTicks.length - 1 ? "0" : "2 4"}
            />
            <text
              x={padL - 8}
              y={t.y + 3}
              textAnchor="end"
              fontSize="10"
              fontFamily="var(--font-mono)"
              fill="hsl(var(--muted-foreground))"
            >
              {format(t.v)}
            </text>
          </g>
        ))}
        {labels.map((l, i) => {
          if (data.length > 14 && i % 2 !== 0 && i !== data.length - 1) return null;
          return (
            <text
              key={i}
              x={padL + i * stepX}
              y={H - 10}
              textAnchor="middle"
              fontSize="10"
              fontFamily="var(--font-mono)"
              fill="hsl(var(--muted-foreground))"
            >
              {l}
            </text>
          );
        })}
        <path d={pathArea} fill={`url(#grad-${uid})`} />
        <path d={pathLine} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && (
          <g pointerEvents="none">
            <line
              x1={points[hover][0]}
              x2={points[hover][0]}
              y1={padT}
              y2={padT + innerH}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <circle cx={points[hover][0]} cy={points[hover][1]} r={4} fill="hsl(var(--card))" stroke={color} strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div
          className="absolute pointer-events-none rounded-md px-2.5 py-1.5 text-[11.5px] font-mono font-semibold whitespace-nowrap shadow-md bg-foreground text-background"
          style={{
            left: Math.min(W - 120, Math.max(0, points[hover][0] - 50)),
            top: points[hover][1] - 42,
          }}
        >
          <div className="font-sans font-semibold text-[11px] opacity-70">{labels[hover]}</div>
          <div>{format(data[hover])}</div>
        </div>
      )}
    </div>
  );
}
