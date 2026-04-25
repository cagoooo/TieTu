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

- **api-server** (`artifacts/api-server`) — Express 5 API at `/api`. Routes: `GET /api/healthz`, `POST /api/stickers/generate`. Body limit 50mb to accept base64 photo uploads.
- **sticker-studio** (`artifacts/sticker-studio`) — React + Vite SPA at `/`. "3D Q版貼圖生成器" — Traditional Chinese chibi sticker generator. User uploads a photo, optionally enters a theme, and edits 24 sticker text labels; the app calls the API to generate a single 4×6 sticker sheet, splits it client-side into 24 tiles, and offers PNG sheet + ZIP-of-tiles downloads (uses `jszip` + `file-saver`).
- **mockup-sandbox** (`artifacts/mockup-sandbox`) — design preview server.

## OpenAI integration

`@workspace/integrations-openai-ai-server` (`lib/integrations-openai-ai-server`) wraps the Replit AI Integrations OpenAI proxy. The `image` entry exports `generateImageBuffer`, `editImages` (file-path inputs), and `editImagesFromBuffers` (Buffer inputs, used by the sticker route). `ImageSize` includes `1024x1536` portrait. Env vars: `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`.
