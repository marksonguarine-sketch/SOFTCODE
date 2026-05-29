import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTweaks, getTweaks } from "@/lib/theme";

// Apply saved appearance tweaks (dark mode / density / accent) before the app
// renders so the user's choice persists across reloads. Defaults to LIGHT mode.
applyTweaks(getTweaks());

createRoot(document.getElementById("root")!).render(<App />);
