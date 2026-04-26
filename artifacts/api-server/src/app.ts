import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Trust the reverse-proxy hop count so req.ip reflects the real client IP for
// the per-IP rate limiter. Cloud Run / Firebase Functions usually present 2
// hops (Google Frontend + Cloud Run sidecar). Override with TRUST_PROXY env.
// Setting this to `true` (trust everything) lets clients spoof X-Forwarded-For,
// which would defeat IP-based rate limiting outside Replit's single-proxy
// environment.
const trustRaw = process.env["TRUST_PROXY"] ?? "2";
const trustParsed = Number(trustRaw);
app.set(
  "trust proxy",
  Number.isFinite(trustParsed) && trustParsed >= 0 ? trustParsed : trustRaw,
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// CORS allowlist driven by env. When SPA and API share an origin (e.g. served
// behind Firebase Hosting rewrites), leave CORS_ALLOWED_ORIGINS unset and
// requests default to same-origin only.
const corsAllowed = (process.env["CORS_ALLOWED_ORIGINS"] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: corsAllowed.length > 0 ? corsAllowed : false,
    credentials: false,
  }),
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api", router);

export default app;
