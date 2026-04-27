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
const basePath = process.env.BASE_PATH?.trim() || "./";

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
    // Raise the warning ceiling — the merged vendor chunk hovers around
    // 600 KB on its own and we'd rather log sizes than chase the warning.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Split ONLY non-React, leaf-level libraries into separate chunks.
        //
        // Why so conservative: aggressively splitting React-based libraries
        // (Radix, framer-motion, etc.) into their own chunks broke the live
        // site with `Cannot read properties of undefined (reading 'useLayoutEffect')`
        // — a separate `vendor-radix` chunk evaluated before `vendor-react`
        // had populated its named exports, leaving Radix's React.* references
        // pointing at undefined slots. Anything that imports React stays in
        // the default app chunk so module graph + evaluation order match.
        //
        // The libraries below are pure JS / DOM utilities that don't reach
        // back into React internals, so they're safe to ship in their own
        // long-lived chunks (jszip in particular is 99 KB / 31 KB gzip and
        // only loaded when the user hits "下載 ZIP").
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("jszip") || id.includes("file-saver")) return "vendor-io";
          if (id.includes("lucide-react")) return "vendor-icons";
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
