import { useState, useEffect } from "react";
import { Settings2, X, Moon, Sun, Sparkles, Type, Layout, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";

const ACCENT_HUES: Array<{ key: string; label: string; hsl: string; fg: string }> = [
  { key: "amber", label: "Amber", hsl: "38 92% 50%", fg: "28 50% 12%" },
  { key: "blue", label: "Blue", hsl: "217 91% 55%", fg: "0 0% 100%" },
  { key: "emerald", label: "Emerald", hsl: "152 56% 41%", fg: "0 0% 100%" },
  { key: "purple", label: "Purple", hsl: "265 84% 60%", fg: "0 0% 100%" },
  { key: "rose", label: "Rose", hsl: "350 89% 60%", fg: "0 0% 100%" },
];

const DENSITY_OPTIONS = ["compact", "regular", "spacious"] as const;
type Density = (typeof DENSITY_OPTIONS)[number];

const FONT_OPTIONS = [
  { key: "manrope", label: "Manrope", value: "'Manrope', ui-sans-serif, system-ui, sans-serif" },
  { key: "inter", label: "Inter", value: "'Inter', sans-serif" },
  { key: "geist", label: "Geist", value: "'Geist', sans-serif" },
  { key: "ibm", label: "IBM Plex Sans", value: "'IBM Plex Sans', sans-serif" },
];

const CARD_STYLES = ["flat", "shadow", "outlined"] as const;
type CardStyle = (typeof CARD_STYLES)[number];

interface Tweaks {
  darkMode: boolean;
  accent: string;
  density: Density;
  font: string;
  cardStyle: CardStyle;
}

const STORAGE_KEY = "joap_tweaks";

function readTweaks(): Tweaks {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { darkMode: false, accent: "amber", density: "regular", font: "manrope", cardStyle: "shadow" };
}

function applyTweaks(t: Tweaks) {
  const root = document.documentElement;
  // Dark mode
  if (t.darkMode) root.classList.add("dark");
  else root.classList.remove("dark");

  // Accent hue
  const hue = ACCENT_HUES.find((h) => h.key === t.accent);
  if (hue) {
    root.style.setProperty("--primary", hue.hsl);
    root.style.setProperty("--primary-foreground", hue.fg);
    root.style.setProperty("--ring", hue.hsl);
    root.style.setProperty("--sidebar-primary", hue.hsl);
    root.style.setProperty("--sidebar-ring", hue.hsl);
  }

  // Density (controls --spacing scale)
  if (t.density === "compact") root.style.setProperty("--spacing", "0.2rem");
  else if (t.density === "spacious") root.style.setProperty("--spacing", "0.3rem");
  else root.style.setProperty("--spacing", "0.25rem");

  // Font
  const font = FONT_OPTIONS.find((f) => f.key === t.font);
  if (font) {
    root.style.setProperty("--font-sans", font.value);
    document.body.style.fontFamily = font.value;
  }

  // Card style — toggle data attribute root reads via CSS
  root.setAttribute("data-card-style", t.cardStyle);
}

/**
 * Floating Tweaks panel. Hidden behind a small "Tweaks" gear button in the header.
 * Lets the user toggle dark mode, accent hue, density, font, and card style.
 * Persists to localStorage and re-applies on mount.
 */
export function TweaksPanel() {
  const [open, setOpen] = useState(false);
  const [tweaks, setTweaks] = useState<Tweaks>(() => readTweaks());

  useEffect(() => {
    applyTweaks(tweaks);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tweaks));
  }, [tweaks]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setOpen((v) => !v)}
        title="Tweaks"
        data-testid="button-tweaks"
      >
        <Settings2 className="h-4 w-4" />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-[200] bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="fixed top-16 right-4 z-[201] w-80 rounded-2xl border bg-card shadow-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h3 className="font-semibold text-sm">UI Tweaks</h3>
              </div>
              <button
                className="w-6 h-6 rounded-full bg-muted/60 hover:bg-muted flex items-center justify-center"
                onClick={() => setOpen(false)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>

            {/* Dark mode */}
            <div>
              <div className="flex items-center gap-2 mb-1.5 text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                {tweaks.darkMode ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
                Theme
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${!tweaks.darkMode ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent border-border"}`}
                  onClick={() => setTweaks({ ...tweaks, darkMode: false })}
                >
                  Light
                </button>
                <button
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${tweaks.darkMode ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent border-border"}`}
                  onClick={() => setTweaks({ ...tweaks, darkMode: true })}
                >
                  Dark
                </button>
              </div>
            </div>

            {/* Accent hue */}
            <div>
              <div className="flex items-center gap-2 mb-1.5 text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                <Palette className="h-3 w-3" />Accent
              </div>
              <div className="flex gap-1.5">
                {ACCENT_HUES.map((h) => (
                  <button
                    key={h.key}
                    className={`flex-1 h-7 rounded-lg border-2 transition-all ${tweaks.accent === h.key ? "border-foreground scale-110" : "border-transparent hover:scale-105"}`}
                    style={{ background: `hsl(${h.hsl})` }}
                    onClick={() => setTweaks({ ...tweaks, accent: h.key })}
                    title={h.label}
                  />
                ))}
              </div>
            </div>

            {/* Density */}
            <div>
              <div className="flex items-center gap-2 mb-1.5 text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                <Layout className="h-3 w-3" />Density
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {DENSITY_OPTIONS.map((d) => (
                  <button
                    key={d}
                    className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors capitalize ${tweaks.density === d ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent border-border"}`}
                    onClick={() => setTweaks({ ...tweaks, density: d })}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Font */}
            <div>
              <div className="flex items-center gap-2 mb-1.5 text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                <Type className="h-3 w-3" />Font
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {FONT_OPTIONS.map((f) => (
                  <button
                    key={f.key}
                    className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${tweaks.font === f.key ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent border-border"}`}
                    style={{ fontFamily: f.value }}
                    onClick={() => setTweaks({ ...tweaks, font: f.key })}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Card style */}
            <div>
              <div className="flex items-center gap-2 mb-1.5 text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                <Layout className="h-3 w-3" />Card Style
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {CARD_STYLES.map((c) => (
                  <button
                    key={c}
                    className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors capitalize ${tweaks.cardStyle === c ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent border-border"}`}
                    onClick={() => setTweaks({ ...tweaks, cardStyle: c })}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2 border-t">
              <button
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => {
                  const defaults: Tweaks = { darkMode: false, accent: "amber", density: "regular", font: "manrope", cardStyle: "shadow" };
                  setTweaks(defaults);
                }}
              >
                Reset to defaults
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// Apply tweaks immediately on import so they're reflected before TweaksPanel mounts
if (typeof window !== "undefined") {
  applyTweaks(readTweaks());
}
