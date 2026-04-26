import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { rm, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";

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

// Emit a Cloud Functions–friendly package.json alongside index.js.
//
// Why: firebase deploy uploads `functions/lib` (per firebase.json's
// source: "functions/lib"), and Cloud Build runs `npm install` there. The
// development functions/package.json contains workspace:* devDependencies that
// npm cannot resolve; this slim manifest only declares the runtime
// dependencies (firebase-functions, firebase-admin) which are kept external in
// the esbuild step above. Everything else (Express, Drizzle, @google/genai,
// the api-server source itself) is already inlined into index.js.
const deployPkg = {
  name: "tietu-functions",
  version: "0.1.0",
  private: true,
  engines: { node: "22" },
  main: "index.js",
  dependencies: {
    "firebase-admin": "^12.7.0",
    "firebase-functions": "^6.0.1",
  },
};
await writeFile(
  resolve(libDir, "package.json"),
  JSON.stringify(deployPkg, null, 2) + "\n",
);

// Install the two runtime dependencies into lib/node_modules so that
// firebase-tools can `require("firebase-functions")` when it parses the
// codebase before uploading. We use plain npm here (not pnpm) because the
// resulting tree is what the Cloud Build environment will mirror.
console.log("Installing runtime deps into lib/node_modules ...");
execSync("npm install --omit=dev --no-audit --no-fund --prefer-offline --silent", {
  cwd: libDir,
  stdio: "inherit",
});

console.log("✓ Built functions/lib/{index.js, package.json, node_modules} (deploy-ready)");
