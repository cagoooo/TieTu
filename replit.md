# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

- **api-server** (`artifacts/api-server`) — Express 5 API at `/api`. Routes: `GET /api/healthz`, `POST /api/stickers/generate`. Body limit 50mb to accept base64 photo uploads. Trusts proxy for real client IP (`app.set("trust proxy", true)`); on Replit-managed proxies this is safe, but if self-hosting outside a single trusted reverse proxy, narrow it (e.g. trust hop count or specific CIDRs) so clients cannot spoof `X-Forwarded-For`. The sticker route is gated by Cloudflare Turnstile (`src/middlewares/verify-turnstile.ts`) and then rate-limited per IP (`src/middlewares/rate-limit.ts`). Captcha verification activates only when `TURNSTILE_SECRET_KEY` is set; without a token (read from body `turnstileToken` or header `X-Turnstile-Token`) or on a failed/expired token the API returns HTTP 403 with a Chinese error message. Rate limits are configurable via `STICKER_RATE_LIMIT_PER_MINUTE` (default 3) and `STICKER_RATE_LIMIT_PER_DAY` (default 30). Quota state is persisted in Postgres (`rate_limit_events` table in `@workspace/db`), keyed by a `bucket` string (sticker route uses `"sticker:generate"`) plus client IP, so used quota survives server restarts and is shared across instances. Rows older than 1 day are pruned by a 5-minute interval timer. Every response carries `X-RateLimit-Limit-{Minute,Day}` and `X-RateLimit-Remaining-{Minute,Day}`; over-limit responses return HTTP 429 with `{ error, retryAfterSeconds, scope, limit }` and a `Retry-After` header. If the database is unreachable the limiter fails closed with HTTP 503 rather than letting requests slip past.
- **sticker-studio** (`artifacts/sticker-studio`) — React + Vite SPA at `/`. "3D Q版貼圖生成器" — Traditional Chinese chibi sticker generator. User uploads a photo, optionally enters a theme, and edits 24 sticker text labels; the app calls the API to generate a single 4×6 sticker sheet, splits it client-side into 24 tiles, and offers PNG sheet + ZIP-of-tiles downloads (uses `jszip` + `file-saver`). Recent generations (up to 5) are persisted in the browser via IndexedDB (`src/lib/sticker-history.ts`, DB `sticker-studio` / store `history`); the `StickerHistory` panel renders on both the upload screen and below the result cards, supporting click-to-reopen, per-entry delete, and clear-all. Thumbnails are generated client-side via canvas down-scaling. The Cloudflare Turnstile widget (`src/components/turnstile-widget.tsx`) renders above the generate button when `VITE_TURNSTILE_SITE_KEY` is configured; the obtained token is sent as `turnstileToken` in the generate request, the button stays disabled until a token is present, and the widget auto-resets after every success/error (tokens are single-use). When `VITE_TURNSTILE_SITE_KEY` is unset the widget is hidden and requests omit the token (matching the server's "captcha disabled" mode). Per-tile micro-adjustments: each tile in the result preview is a button that opens `StickerTileEditor` (`src/components/sticker-tile-editor.tsx`) — a modal with sliders for rotation (±15°), horizontal/vertical translation (±15% of tile size), and scale (80–120%). The editor renders a real-time canvas using the same `drawAdjustedTile` helper that produces the final tiles, so what you see is what gets exported. Adjustments are stored as a `Record<index, TileAdjustment>` in `StickerResult` and flow through `splitImageWithGuides` and `buildLineStickerPackage` so they take effect in both the per-tile ZIP and the LINE upload package. Adjustments reset whenever the underlying sheet or the column/row count changes; non-default tiles get an "已微調" badge plus a summary line under the preview grid. The `drawAdjustedTile` source region is over-sampled by 30% on each side (clamped to image bounds) so that rotated/scaled content keeps continuity with the surrounding matte instead of leaving transparent corners.
- **mockup-sandbox** (`artifacts/mockup-sandbox`) — design preview server.

## OpenAI integration

`@workspace/integrations-openai-ai-server` (`lib/integrations-openai-ai-server`) wraps the Replit AI Integrations OpenAI proxy. The `image` entry exports `generateImageBuffer`, `editImages` (file-path inputs), and `editImagesFromBuffers` (Buffer inputs, used by the sticker route). `ImageSize` includes `1024x1536` portrait. Env vars: `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`.

## Captcha (Cloudflare Turnstile)

The sticker-generation endpoint is fronted by a Cloudflare Turnstile challenge so that bots rotating IPs cannot drain the OpenAI quota. Two env vars opt the system into enforcement; both default to "disabled" so local dev keeps working without Cloudflare credentials:

- `TURNSTILE_SECRET_KEY` (api-server) — secret used to call `https://challenges.cloudflare.com/turnstile/v0/siteverify`. When unset the middleware logs a one-time warning and skips verification (intended for local dev). The server **fails to start** if `NODE_ENV=production` and this var is missing, so production deployments cannot accidentally ship without captcha protection. When set, requests must include a valid token (body field `turnstileToken` or header `X-Turnstile-Token`); otherwise the API responds with HTTP 403 and a Chinese error message.
- `VITE_TURNSTILE_SITE_KEY` (sticker-studio, build-time Vite env) — site key passed to the Turnstile widget rendered above the generate button. When unset the widget is hidden and the client omits the token. To enable in production, set both env vars to a matching real Turnstile sitekey/secret pair (Cloudflare also provides always-pass / always-fail test keys for manual QA).

Captcha tokens are single-use, so the widget is auto-reset after every success or failure (including 429s) before the next attempt.
