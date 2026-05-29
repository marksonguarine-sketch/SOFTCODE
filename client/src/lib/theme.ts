// Single source of truth for the per-device appearance tweaks (dark mode,
// interface density, accent hue). Used by the boot script (main.tsx), the
// Settings → Appearance Tweaks panel, and the header light/dark toggle so they
// all stay in sync. Defaults to LIGHT mode.

export const TWEAKS_KEY = "joap-tweaks-v1";
export const THEME_EVENT = "joap-theme-change";

export type Tweaks = { dark: boolean; density: string; accentHue: number };
export const TWEAKS_DEFAULTS: Tweaks = { dark: false, density: "balanced", accentHue: 220 };

export function getTweaks(): Tweaks {
  try {
    const raw = localStorage.getItem(TWEAKS_KEY);
    if (raw) return { ...TWEAKS_DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...TWEAKS_DEFAULTS };
}

export function saveTweaks(t: Tweaks) {
  try { localStorage.setItem(TWEAKS_KEY, JSON.stringify(t)); } catch { /* ignore */ }
}

export function applyTweaks(t: Tweaks) {
  const root = document.documentElement;
  root.classList.toggle("dark", !!t.dark);
  const densityMap: Record<string, string> = { compact: "13px", balanced: "14px", comfortable: "15px" };
  root.style.fontSize = densityMap[t.density] || "14px";
  const hue = t.accentHue;
  if (t.dark) {
    root.style.setProperty("--primary", `${hue} 95% 58%`);
    root.style.setProperty("--ring", `${hue} 95% 58%`);
    root.style.setProperty("--sidebar-primary", `${hue} 95% 60%`);
    root.style.setProperty("--chart-1", `${hue} 95% 60%`);
    root.style.setProperty("--accent", `${hue} 40% 22%`);
    root.style.setProperty("--accent-foreground", `${hue} 90% 75%`);
  } else {
    root.style.setProperty("--primary", `${hue} 92% 50%`);
    root.style.setProperty("--ring", `${hue} 92% 50%`);
    root.style.setProperty("--sidebar-primary", `${hue} 92% 50%`);
    root.style.setProperty("--chart-1", `${hue} 92% 50%`);
    root.style.setProperty("--accent", `${hue} 85% 94%`);
    root.style.setProperty("--accent-foreground", `${hue} 70% 30%`);
  }
}

/** Flip dark mode, persist, apply, and notify any listeners (header ↔ settings). */
export function setDark(dark: boolean) {
  const t = getTweaks();
  t.dark = dark;
  saveTweaks(t);
  applyTweaks(t);
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: t }));
}

export function isDark(): boolean {
  return getTweaks().dark;
}
