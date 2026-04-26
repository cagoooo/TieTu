import { createRoot } from "react-dom/client";
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

createRoot(document.getElementById("root")!).render(<App />);
