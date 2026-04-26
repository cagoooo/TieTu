import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";

// ---------------------------------------------------------------------------
// Secrets — all use the TIETU_ prefix to coexist safely with any other
// applications in the same Firebase project (see firebase-multi-app-safety).
// Set these via:
//   firebase functions:secrets:set TIETU_DATABASE_URL --project=zhuyin-challenge-v3-4cd2b
// ---------------------------------------------------------------------------

// Plan A deployment: rate-limit middleware was removed, so we no longer
// need TIETU_DATABASE_URL or the per-IP rate limit knobs. Capacity protection
// now lives at the Cloud Functions concurrency layer (maxInstances) plus
// Gemini's own quota.
const TIETU_GEMINI_API_KEY = defineSecret("TIETU_GEMINI_API_KEY");
const TIETU_TURNSTILE_SECRET_KEY = defineSecret("TIETU_TURNSTILE_SECRET_KEY");

// firebase-functions ships @types/express-serve-static-core@4 while api-server
// uses Express 5 (whose Request/Response types differ). They are compatible at
// runtime; we use a structural type to bridge the type-level mismatch.
type RequestHandler = (req: unknown, res: unknown) => void;

// Lazily initialise the Express app so Cloud Functions only spins up the
// pool / OpenAI client on the first invocation per instance, not at module
// load time (which would otherwise run before secrets are injected).
let _appPromise: Promise<RequestHandler> | null = null;

async function getApp(): Promise<RequestHandler> {
  if (_appPromise) return _appPromise;
  _appPromise = (async () => {
    // Map TIETU_-prefixed secrets to the env names the existing Express app
    // expects. integrations-gemini-server reads GEMINI_API_KEY at module-import
    // time, so we must populate it BEFORE dynamically importing the app.
    process.env.GEMINI_API_KEY = TIETU_GEMINI_API_KEY.value();

    // Turnstile sentinel: "DISABLED" means we deliberately want captcha off
    // (typical for bring-up while waiting on the Cloudflare keys). Leaving
    // process.env.TURNSTILE_SECRET_KEY unset makes verify-turnstile.ts skip
    // verification entirely (with a one-time warning log). Any other value
    // is treated as a real secret and enforced.
    const turnstileValue = TIETU_TURNSTILE_SECRET_KEY.value();
    if (turnstileValue && turnstileValue !== "DISABLED") {
      process.env.TURNSTILE_SECRET_KEY = turnstileValue;
    }
    // Cloud Run sits behind two proxy hops (Google Frontend + Cloud Run sidecar).
    process.env.TRUST_PROXY = process.env.TRUST_PROXY ?? "2";
    // CORS allowlist is intentionally left unset: the SPA and this function
    // share an origin via Firebase Hosting rewrites (see firebase.json), so
    // requests are same-origin and never trigger CORS.
    // If you split SPA / API across origins, set CORS_ALLOWED_ORIGINS via env
    // (or another defineSecret) before this dynamic import runs.

    const mod = (await import("@workspace/api-server/app")) as {
      default: RequestHandler;
    };
    return mod.default;
  })();
  return _appPromise;
}

// ---------------------------------------------------------------------------
// HTTP entry point — Hosting rewrites /api/** here. The function is named
// tietu_api so it's clearly namespaced for multi-app coexistence and any future
// `firebase deploy --only functions:tietu` only touches this codebase.
// ---------------------------------------------------------------------------
export const tietu_api = onRequest(
  {
    region: "asia-east1",
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 10,
    concurrency: 80,
    cpu: 1,
    invoker: "public",
    secrets: [TIETU_GEMINI_API_KEY, TIETU_TURNSTILE_SECRET_KEY],
  },
  async (req, res) => {
    try {
      const app = await getApp();
      app(req, res);
    } catch (err) {
      logger.error("[tietu_api] Function entry error", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  },
);
