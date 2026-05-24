/**
 * Floating Tweaks panel — visible site-wide.
 *
 * Renders a small "Tweaks" pill at the bottom-right of every page.
 * Clicking opens a panel with: dark mode, sidebar gradient, font, density,
 * accent hue. Values are persisted in localStorage and applied to the
 * <html> root so every page picks them up.
 *
 * This is the TypeScript port of prototype/tweaks-panel.jsx.
 */
import { useEffect, useState, useCallback, type ReactNode } from "react";
import { X, Sliders } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "joap-tweaks-v1";

interface Tweaks {
  dark: boolean;
  font: string;
  density: "compact" | "balanced" | "comfortable";
  accentHue: number;
}

const DEFAULTS: Tweaks = {
  dark: false,
  font: "Manrope",
  density: "balanced",
  accentHue: 38, // amber
};

const FONT_OPTIONS = [
  { value: "Manrope", stack: "'Manrope', ui-sans-serif, system-ui, sans-serif" },
  { value: "Inter", stack: "'Inter', ui-sans-serif, system-ui, sans-serif" },
  { value: "Plus Jakarta Sans", stack: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif" },
  { value: "DM Sans", stack: "'DM Sans', ui-sans-serif, system-ui, sans-serif" },
  { value: "Geist", stack: "'Geist', ui-sans-serif, system-ui, sans-serif" },
] as const;

const DENSITY_FONT_SIZE: Record<Tweaks["density"], string> = {
  compact: "13px",
  balanced: "14px",
  comfortable: "15px",
};

const ACCENT_PRESETS = [
  { hue: 38, label: "Amber" },
  { hue: 220, label: "Blue" },
  { hue: 152, label: "Green" },
  { hue: 0, label: "Red" },
  { hue: 280, label: "Purple" },
];

function loadTweaks(): Tweaks {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { ...DEFAULTS };
}

function saveTweaks(t: Tweaks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch {
    // ignore
  }
}

function applyTweaks(t: Tweaks) {
  const root = document.documentElement;
  // Dark mode
  root.classList.toggle("dark", t.dark);
  // Font
  const stack =
    FONT_OPTIONS.find((f) => f.value === t.font)?.stack || FONT_OPTIONS[0].stack;
  root.style.setProperty("--font-sans", stack);
  // Density (root font size)
  root.style.fontSize = DENSITY_FONT_SIZE[t.density];
  // Accent — rewrite primary HSL custom properties
  const hue = t.accentHue;
  if (t.dark) {
    root.style.setProperty("--primary", `${hue} 95% 58%`);
    root.style.setProperty("--ring", `${hue} 95% 58%`);
    root.style.setProperty("--sidebar-primary", `${hue} 95% 60%`);
    root.style.setProperty("--sidebar-ring", `${hue} 95% 60%`);
    root.style.setProperty("--chart-1", `${hue} 95% 60%`);
    root.style.setProperty("--accent", `${hue} 40% 22%`);
    root.style.setProperty("--accent-foreground", `${hue} 90% 75%`);
  } else {
    root.style.setProperty("--primary", `${hue} 92% 50%`);
    root.style.setProperty("--ring", `${hue} 92% 50%`);
    root.style.setProperty("--sidebar-primary", `${hue} 92% 50%`);
    root.style.setProperty("--sidebar-ring", `${hue} 92% 50%`);
    root.style.setProperty("--chart-1", `${hue} 92% 50%`);
    root.style.setProperty("--accent", `${hue} 85% 94%`);
    root.style.setProperty("--accent-foreground", `${hue} 70% 30%`);
  }
}

export function TweaksPanel() {
  const [open, setOpen] = useState(false);
  const [tweaks, setTweaks] = useState<Tweaks>(loadTweaks);

  // Apply on mount + every change
  useEffect(() => {
    applyTweaks(tweaks);
    saveTweaks(tweaks);
  }, [tweaks]);

  const update = useCallback(
    <K extends keyof Tweaks>(key: K, value: Tweaks[K]) =>
      setTweaks((prev) => ({ ...prev, [key]: value })),
    []
  );

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 inline-flex items-center gap-1.5 px-3 h-9 rounded-full bg-card border border-border shadow-md hover:bg-accent text-foreground text-[12px] font-semibold transition"
        data-testid="tweaks-launcher"
      >
        <span className="w-2 h-2 rounded-full bg-primary" />
        Tweaks
      </button>
    );
  }

  return (
    <div
      className="fixed right-4 bottom-4 z-50 w-[300px] max-h-[calc(100vh-32px)] flex flex-col bg-card border border-border rounded-xl shadow-xl overflow-hidden"
      data-testid="tweaks-panel"
    >
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <Sliders className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[13px] font-bold tracking-tight">Tweaks</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="w-6 h-6 grid place-items-center rounded-md text-muted-foreground hover:bg-accent transition"
          aria-label="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="overflow-y-auto py-1.5 flex-1">
        <Section label="Theme" />
        <Toggle label="Dark mode" value={tweaks.dark} onChange={(v) => update("dark", v)} />

        <Section label="Density" />
        <Radio
          label="Density"
          value={tweaks.density}
          options={["compact", "balanced", "comfortable"]}
          onChange={(v) => update("density", v as Tweaks["density"])}
        />

        <Section label="Typography" />
        <Select
          label="Font family"
          value={tweaks.font}
          options={FONT_OPTIONS.map((f) => f.value)}
          onChange={(v) => update("font", v)}
        />

        <Section label="Accent color" />
        <SwatchRow value={tweaks.accentHue} onChange={(v) => update("accentHue", v)} />
        <Slider
          label="Hue"
          value={tweaks.accentHue}
          min={0}
          max={360}
          step={5}
          unit="°"
          onChange={(v) => update("accentHue", v)}
        />

        <div className="px-3.5 py-3">
          <button
            onClick={() => setTweaks({ ...DEFAULTS })}
            className="w-full text-[12px] font-semibold px-2.5 py-2 rounded-md border border-border bg-muted hover:bg-accent transition"
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── small helper controls ───────────────────────────────────────────────── */

function Section({ label }: { label: string }) {
  return (
    <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground px-3.5 pt-2.5 pb-1">
      {label}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-1.5">
      <label className="text-[12.5px] font-medium">{label}</label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Row label={label}>
      <button
        onClick={() => onChange(!value)}
        className={cn(
          "w-[30px] h-[18px] rounded-full relative transition-colors shrink-0",
          value ? "bg-primary" : "bg-muted"
        )}
        role="switch"
        aria-checked={value}
      >
        <span
          className={cn(
            "absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform",
            value && "translate-x-[12px]"
          )}
        />
      </button>
    </Row>
  );
}

function Radio({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label}>
      <div className="inline-flex p-0.5 gap-0.5 bg-muted border border-border rounded-md">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={cn(
              "text-[11px] font-medium px-2 py-1 rounded transition",
              value === o
                ? "bg-card text-foreground font-semibold shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o}
          </button>
        ))}
      </div>
    </Row>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-3.5 py-1.5">
      <label className="text-[12.5px] font-medium">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 px-2 rounded-md border border-border bg-card text-[12px] outline-none focus:ring-2 focus:ring-primary/30"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-3.5 py-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[12.5px] font-medium">{label}</label>
        <span className="font-mono text-[11px] font-semibold text-muted-foreground tabular-nums">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

function SwatchRow({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1.5 px-3.5 pt-1 pb-2 flex-wrap">
      {ACCENT_PRESETS.map((p) => (
        <button
          key={p.hue}
          onClick={() => onChange(p.hue)}
          title={p.label}
          className={cn(
            "w-[22px] h-[22px] rounded-full border border-black/10 cursor-pointer transition",
            value === p.hue && "ring-2 ring-offset-2 ring-foreground"
          )}
          style={{ background: `hsl(${p.hue} 92% 50%)` }}
          aria-label={p.label}
        />
      ))}
    </div>
  );
}
