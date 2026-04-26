import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// When the API lives at a different origin than the SPA (e.g. running the
// API server locally on :8080 while previewing the built SPA elsewhere),
// set VITE_API_BASE_URL at build time. In the standard Firebase deployment
// the SPA and the tietu_api Cloud Function share an origin via Hosting
// rewrites, so this env stays unset and requests use relative /api/... paths.
const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
if (apiBase) {
  setBaseUrl(apiBase);
}

// Sentry — only activates when VITE_SENTRY_DSN is set at build time
// (GitHub Actions secret). Empty / unset = skip init = zero bundle cost
// beyond the import (Sentry tree-shakes well).
const sentryDsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim();
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    // Capture <App /> render errors via Sentry's React ErrorBoundary if the
    // SPA hits an unhandled exception below the Wouter router.
    integrations: [Sentry.browserTracingIntegration()],
  });
}

createRoot(document.getElementById("root")!).render(<App />);
