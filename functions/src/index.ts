import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";
import * as Sentry from "@sentry/node";

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
// Sentry DSN — left as a "DISABLED" sentinel during bring-up. When you want
// real error tracking, run:
//   firebase functions:secrets:set TIETU_SENTRY_DSN --project=zhuyin-challenge-v3-4cd2b
// and paste the DSN from sentry.io. Code below treats absence / "DISABLED"
// the same: no init, zero overhead, no captures.
const TIETU_SENTRY_DSN = defineSecret("TIETU_SENTRY_DSN");
// LINE admin notifications — same "DISABLED" sentinel pattern as Sentry.
// When both secrets hold real values, every /api/stickers/generate success
// or failure pushes a LINE message to TIETU_LINE_ADMIN_USER_ID via the
// channel that owns TIETU_LINE_CHANNEL_ACCESS_TOKEN. See
// lib/integrations-line-server/notify.ts for the runtime fallback logic.
const TIETU_LINE_CHANNEL_ACCESS_TOKEN = defineSecret("TIETU_LINE_CHANNEL_ACCESS_TOKEN");
const TIETU_LINE_ADMIN_USER_ID = defineSecret("TIETU_LINE_ADMIN_USER_ID");

let _sentryInited = false;
function ensureSentry(): void {
  if (_sentryInited) return;
  _sentryInited = true; // set true even on skip so we don't keep re-evaluating

  const dsn = TIETU_SENTRY_DSN.value();
  if (!dsn || dsn === "DISABLED") return;
  try {
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      environment: process.env.NODE_ENV ?? "production",
      release: process.env.K_REVISION ?? "tietu_api@unknown",
      // Cloud Functions reuses instances across requests but cold-starts
      // create new ones; Sentry's default global flush behaviour is fine
      // for short-lived HTTP handlers like ours.
    });
    logger.info("[sentry] initialised");
  } catch (err) {
    logger.error("[sentry] init failed; continuing without Sentry", err);
  }
}

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
    // LINE admin notifications: same DISABLED-sentinel pattern. notifyAdmin
    // checks both TIETU_LINE_* env vars at call time and silently skips
    // when either is missing or "DISABLED" — so deploying without the
    // secrets set is safe and just leaves the feature dormant until you
    // run `firebase functions:secrets:set TIETU_LINE_*`.
    const lineToken = TIETU_LINE_CHANNEL_ACCESS_TOKEN.value();
    if (lineToken && lineToken !== "DISABLED") {
      process.env.TIETU_LINE_CHANNEL_ACCESS_TOKEN = lineToken;
    }
    const lineAdminId = TIETU_LINE_ADMIN_USER_ID.value();
    if (lineAdminId && lineAdminId !== "DISABLED") {
      process.env.TIETU_LINE_ADMIN_USER_ID = lineAdminId;
    }
    // Cloud Run sits behind two proxy hops (Google Frontend + Cloud Run sidecar).
    process.env.TRUST_PROXY = process.env.TRUST_PROXY ?? "2";
    // Hand-off bucket name to api-server's storage helper. The default GCS
    // bucket "tietu-sheets-cagoooo" lives in the same project, has 7-day
    // lifecycle delete, allUsers:objectViewer, and the Cloud Functions
    // runtime SA has storage.objectAdmin on it — no extra creds needed.
    process.env.STORAGE_BUCKET = process.env.STORAGE_BUCKET ?? "tietu-sheets-cagoooo";
    // CORS allowlist:
    //   - https://tietu.web.app           — Firebase Hosting (same-origin via
    //                                         rewrites; included for safety)
    //   - https://tietu.firebaseapp.com   — alternate Firebase Hosting URL
    //   - https://cagoooo.github.io       — GitHub Pages mirror at /TieTu/
    // If you wire up a custom domain or fork the repo, append yours here.
    process.env.CORS_ALLOWED_ORIGINS =
      process.env.CORS_ALLOWED_ORIGINS ??
      "https://tietu.web.app,https://tietu.firebaseapp.com,https://cagoooo.github.io";

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
    secrets: [
      TIETU_GEMINI_API_KEY,
      TIETU_TURNSTILE_SECRET_KEY,
      TIETU_SENTRY_DSN,
      TIETU_LINE_CHANNEL_ACCESS_TOKEN,
      TIETU_LINE_ADMIN_USER_ID,
    ],
  },
  async (req, res) => {
    ensureSentry();
    try {
      const app = await getApp();
      app(req, res);
    } catch (err) {
      logger.error("[tietu_api] Function entry error", err);
      // Best-effort: report to Sentry if it's been initialised. captureException
      // is a no-op when Sentry is not configured, so it's always safe to call.
      try {
        Sentry.captureException(err, {
          tags: { layer: "function-entry", route: req.path },
        });
      } catch {
        /* never let Sentry kill the response */
      }
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  },
);
