import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ISettings } from "@shared/schema";

const FONT_MAP: Record<string, string> = {
  "Inter": "'Inter', sans-serif",
  "Roboto": "'Roboto', sans-serif",
  "Open Sans": "'Open Sans', sans-serif",
  "Lato": "'Lato', sans-serif",
  "Montserrat": "'Montserrat', sans-serif",
  "Poppins": "'Poppins', sans-serif",
  "Nunito": "'Nunito', sans-serif",
  "Raleway": "'Raleway', sans-serif",
  "Source Sans 3": "'Source Sans 3', sans-serif",
  "PT Sans": "'PT Sans', sans-serif",
};

const FONT_SIZE_MAP: Record<string, string> = {
  small: "13px",
  medium: "14px",
  large: "16px",
  xl: "18px",
};

interface ColorThemeVars {
  primary: string;
  primaryForeground: string;
  ring: string;
  sidebarPrimary: string;
  sidebarRing: string;
  accent: string;
}

const COLOR_THEMES: Record<string, ColorThemeVars> = {
  blue:    { primary: "217 91% 60%", primaryForeground: "0 0% 100%", ring: "217 91% 60%", sidebarPrimary: "217 91% 60%", sidebarRing: "217 91% 60%", accent: "217 30% 94%" },
  emerald: { primary: "160 84% 39%", primaryForeground: "0 0% 100%", ring: "160 84% 39%", sidebarPrimary: "160 84% 39%", sidebarRing: "160 84% 39%", accent: "160 30% 94%" },
  purple:  { primary: "271 91% 65%", primaryForeground: "0 0% 100%", ring: "271 91% 65%", sidebarPrimary: "271 91% 65%", sidebarRing: "271 91% 65%", accent: "271 30% 94%" },
  rose:    { primary: "350 89% 60%", primaryForeground: "0 0% 100%", ring: "350 89% 60%", sidebarPrimary: "350 89% 60%", sidebarRing: "350 89% 60%", accent: "350 30% 94%" },
  orange:  { primary: "25 95% 53%",  primaryForeground: "0 0% 100%", ring: "25 95% 53%",  sidebarPrimary: "25 95% 53%",  sidebarRing: "25 95% 53%",  accent: "25 30% 94%"  },
  teal:    { primary: "173 80% 40%", primaryForeground: "0 0% 100%", ring: "173 80% 40%", sidebarPrimary: "173 80% 40%", sidebarRing: "173 80% 40%", accent: "173 30% 94%" },
  indigo:  { primary: "239 84% 67%", primaryForeground: "0 0% 100%", ring: "239 84% 67%", sidebarPrimary: "239 84% 67%", sidebarRing: "239 84% 67%", accent: "239 30% 94%" },
  amber:   { primary: "38 92% 50%",  primaryForeground: "0 0% 0%",   ring: "38 92% 50%",  sidebarPrimary: "38 92% 50%",  sidebarRing: "38 92% 50%",  accent: "38 30% 94%"  },
  cyan:    { primary: "189 94% 43%", primaryForeground: "0 0% 100%", ring: "189 94% 43%", sidebarPrimary: "189 94% 43%", sidebarRing: "189 94% 43%", accent: "189 30% 94%" },
  slate:   { primary: "215 20% 45%", primaryForeground: "0 0% 100%", ring: "215 20% 45%", sidebarPrimary: "215 20% 45%", sidebarRing: "215 20% 45%", accent: "215 15% 94%" },
};

export const GRADIENT_OPTIONS: Record<string, { label: string; css: string }> = {
  none: { label: "None", css: "" },
  "blue-purple":   { label: "Blue to Purple",    css: "linear-gradient(135deg, #2563eb, #9333ea)" },
  "emerald-teal":  { label: "Emerald to Teal",   css: "linear-gradient(135deg, #059669, #0d9488)" },
  "rose-orange":   { label: "Rose to Orange",    css: "linear-gradient(135deg, #e11d48, #ea580c)" },
  "indigo-blue":   { label: "Indigo to Blue",    css: "linear-gradient(135deg, #4f46e5, #2563eb)" },
  "purple-pink":   { label: "Purple to Pink",    css: "linear-gradient(135deg, #9333ea, #ec4899)" },
  "teal-cyan":     { label: "Teal to Cyan",      css: "linear-gradient(135deg, #0d9488, #06b6d4)" },
  "orange-amber":  { label: "Orange to Amber",   css: "linear-gradient(135deg, #ea580c, #d97706)" },
  "slate-gray":    { label: "Slate to Gray",     css: "linear-gradient(135deg, #475569, #6b7280)" },
  "green-emerald": { label: "Green to Emerald",  css: "linear-gradient(135deg, #16a34a, #059669)" },
  "red-rose":      { label: "Red to Rose",       css: "linear-gradient(135deg, #dc2626, #e11d48)" },
};

interface SettingsContextValue {
  settings: ISettings | null;
  isLoading: boolean;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: null,
  isLoading: true,
});

export function useSettings() {
  return useContext(SettingsContext);
}

function loadGoogleFont(fontName: string) {
  if (fontName === "Inter") return;
  const id = `google-font-${fontName.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@300;400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

export function applySettings(settings: ISettings) {
  const root = document.documentElement;

  // Dark / light mode is a per-device choice that DEFAULTS TO LIGHT. The DB
  // `theme` field no longer forces dark — only the local tweaks toggle does
  // (header switch + Settings → Appearance Tweaks), so the system always opens
  // in light mode until the user explicitly turns on dark.
  let isDark = false;
  try {
    const tweaksRaw = localStorage.getItem("joap-tweaks-v1");
    if (tweaksRaw) {
      const tweaks = JSON.parse(tweaksRaw);
      if (typeof tweaks.dark === "boolean") {
        isDark = tweaks.dark;
      }
    }
  } catch {}
  if (isDark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  // Color theme — set ALL primary-related CSS variables
  const colorTheme = COLOR_THEMES[settings.colorTheme] || COLOR_THEMES["blue"];
  root.style.setProperty("--primary", colorTheme.primary);
  root.style.setProperty("--primary-foreground", colorTheme.primaryForeground);
  root.style.setProperty("--ring", colorTheme.ring);
  root.style.setProperty("--sidebar-primary", colorTheme.sidebarPrimary);
  root.style.setProperty("--sidebar-primary-foreground", colorTheme.primaryForeground);
  root.style.setProperty("--sidebar-ring", colorTheme.sidebarRing);
  root.style.setProperty("--accent", colorTheme.accent);
  root.style.setProperty("--accent-foreground", "0 0% 9%");

  // Gradient
  const gradientKey = settings.gradient || "none";
  const gradient = GRADIENT_OPTIONS[gradientKey];
  if (gradient && gradient.css) {
    root.style.setProperty("--sidebar-gradient", gradient.css);
  } else {
    root.style.removeProperty("--sidebar-gradient");
  }

  // Font family
  const font = settings.font || "Inter";
  if (font !== "Inter") loadGoogleFont(font);
  const fontFamily = FONT_MAP[font] || FONT_MAP["Inter"];
  root.style.setProperty("--font-sans", fontFamily);
  document.body.style.fontFamily = fontFamily;

  // Font size
  const fontSize = settings.fontSize || "medium";
  const basePx = FONT_SIZE_MAP[fontSize] || "14px";
  root.style.setProperty("--font-size-base", basePx);
  root.style.fontSize = basePx;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data: settingsData, isLoading } = useQuery<{ success: boolean; data: ISettings }>({
    queryKey: ["/api/settings"],
    staleTime: 60000,
  });

  const settings = settingsData?.data ?? null;

  useEffect(() => {
    if (!settings) return;
    applySettings(settings);
    return () => {
      // Clean up on unmount (logout)
      const root = document.documentElement;
      document.body.style.fontFamily = "";
      root.classList.remove("dark");
      root.style.removeProperty("--primary");
      root.style.removeProperty("--primary-foreground");
      root.style.removeProperty("--ring");
      root.style.removeProperty("--sidebar-primary");
      root.style.removeProperty("--sidebar-primary-foreground");
      root.style.removeProperty("--sidebar-ring");
      root.style.removeProperty("--accent");
      root.style.removeProperty("--sidebar-gradient");
      root.style.removeProperty("--font-sans");
      root.style.removeProperty("--font-size-base");
      root.style.fontSize = "";
    };
  }, [settings]);

  return (
    <SettingsContext.Provider value={{ settings, isLoading }}>
      {children}
    </SettingsContext.Provider>
  );
}
