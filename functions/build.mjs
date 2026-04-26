import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { rm } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const libDir = resolve(__dirname, "lib");

await rm(libDir, { recursive: true, force: true });

await build({
  entryPoints: [resolve(__dirname, "src/index.ts")],
  outfile: resolve(libDir, "index.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: [
    // Cloud Functions runtime provides these — keep external so the deployed
    // image uses the platform-managed versions.
    "firebase-functions",
    "firebase-admin",
    // Native modules: pg may try to load native bindings if available; we don't
    // ship them. Anything ending in .node likewise should not be inlined.
    "pg-native",
    "*.node",
    // Heavy native modules nothing in this app actually uses, but pino / openai
    // may dynamically resolve. Keeping them external prevents huge bundles.
    "sharp",
  ],
  banner: {
    js: "// Built by functions/build.mjs (monorepo bundle for Cloud Functions v2)."
  },
  logLevel: "info",
  sourcemap: "linked",
});

console.log("✓ Built functions/lib/index.js");
