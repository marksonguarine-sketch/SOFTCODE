import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Apply saved appearance tweaks (dark mode / density / accent) before the app
// renders so the user's choice persists across reloads. Defaults to LIGHT mode
// when nothing is saved.
(function applyBootTweaks() {
  try {
    const TWEAKS_KEY = "joap-tweaks-v1";
    const defaults = { dark: false, density: "balanced", accentHue: 220 };
    const raw = localStorage.getItem(TWEAKS_KEY);
    const t = raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
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
  } catch {
    /* ignore — fall back to light defaults from CSS */
  }
})();

createRoot(document.getElementById("root")!).render(<App />);
