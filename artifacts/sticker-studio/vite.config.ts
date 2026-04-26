import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// PORT only matters for `vite dev` / `vite preview`. `vite build` doesn't
// listen on a port, so we default rather than throwing — that lets bare
// `pnpm run build` work without env wrangling.
const rawPort = process.env.PORT?.trim() || "23937";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Default to "/" (root deploy on Firebase Hosting / GitHub Pages with custom
// domain). Override BASE_PATH only when deploying under a sub-path, e.g.
// "/tietu-sticker/" for the default GitHub Pages URL pattern.
//
// IMPORTANT: do NOT pass `BASE_PATH=/` from a Git Bash on Windows shell —
// MSYS path conversion will rewrite the literal "/" into "/Program Files/Git/"
// before the Node child sees it, producing broken script src in index.html.
// The default below avoids that footgun entirely.
const basePath = process.env.BASE_PATH?.trim() || "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Raise the 500 KB warning ceiling — the merged vendor chunk (radix +
    // framer-motion) sits around 200 KB on its own and we'd rather log
    // sizes than chase the warning into noise.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Split heavy npm vendors into named chunks so the browser can fetch
        // them in parallel under HTTP/2 and only re-download the ones whose
        // versions actually change. Buckets are picked by frequency-of-use
        // and "ships together" cohesion (e.g. all Radix primitives change
        // in lockstep so they share one chunk).
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react-dom") || /[\\/]react[\\/]/.test(id) || id.includes("scheduler")) {
            return "vendor-react";
          }
          if (id.includes("framer-motion")) return "vendor-motion";
          if (id.includes("@radix-ui")) return "vendor-radix";
          if (id.includes("@tanstack")) return "vendor-query";
          if (
            id.includes("react-hook-form") ||
            id.includes("@hookform") ||
            id.includes("/zod/")
          ) {
            return "vendor-forms";
          }
          if (id.includes("jszip") || id.includes("file-saver")) return "vendor-io";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("react-day-picker") || id.includes("date-fns")) return "vendor-datepicker";
          if (id.includes("embla-carousel")) return "vendor-carousel";
          if (id.includes("recharts") || id.includes("/d3-")) return "vendor-charts";
          if (id.includes("cmdk") || id.includes("sonner") || id.includes("vaul") || id.includes("input-otp")) {
            return "vendor-ui-extra";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      // Forward /api/* to the backend during local dev. Override target with
      // VITE_API_PROXY env when running the API on a non-default port. In
      // Firebase Hosting production, /api/** is rewritten to the
      // tietu_api Cloud Function via firebase.json — this proxy is dev-only.
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://localhost:8080",
        changeOrigin: true,
      },
    },
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
