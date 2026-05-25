import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Vite config for JOAP Hardware Trading.
 *
 * Root is `client/`, build output goes to `dist/public/`. The express
 * server (`server/index.ts`) mounts the build output in production via
 * `serveStatic`, and proxies through Vite middleware in dev.
 *
 * Aliases:
 *   @         → client/src
 *   @shared   → shared/        (Zod + TypeScript types shared with server)
 *   @assets   → attached_assets (gitignored — local-only image drops)
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    // Use the actual server port for HMR so the websocket can connect
    hmr: {
      clientPort: 5000,
    },
    allowedHosts: true,
  },
});
