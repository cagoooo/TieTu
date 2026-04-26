# TieTu — 3D Q版貼圖生成器

> 上傳一張大頭照 → 自訂主題與 24 個文字標籤 → AI 生成 4×6 共 24 張 Q 版貼圖 → 下載成 PNG / 24 張 ZIP / **LINE 個人原創貼圖上架包**。

| 介面 | 後端 | 模型 | 部署 |
|---|---|---|---|
| Vite + React 19 + Tailwind 4 + shadcn/ui | Express 5(monorepo)→ Cloud Functions v2 | OpenAI `gpt-image-1`(1024×1536) | **GitHub + Firebase**(主推) |

---

## 目錄
1. [專案總覽](#1-專案總覽)
2. [技術堆疊](#2-技術堆疊)
3. [專案結構](#3-專案結構)
4. [環境變數總表](#4-環境變數總表)
5. [本機開發快速啟動](#5-本機開發快速啟動)
6. [常用指令對照表](#6-常用指令對照表)
7. [前端使用流程](#7-前端使用流程)
8. [後端 API 規格](#8-後端-api-規格)
9. [限流與人機驗證](#9-限流與人機驗證)
10. [資料庫 Schema](#10-資料庫-schema)
11. [LINE 上架包規格](#11-line-上架包規格)
12. [從 Replit 移植到 GitHub + Firebase](#12-從-replit-移植到-github--firebase)
13. [優化路線圖 P0–P4](#13-優化路線圖-p0p4)
14. [疑難排解 FAQ](#14-疑難排解-faq)

---

## 1. 專案總覽

| 項目 | 說明 |
|---|---|
| 專案名稱 | TieTu(貼圖)|
| 主要產品 | 3D Q版貼圖生成器(Traditional Chinese chibi sticker generator) |
| 使用情境 | 上傳大頭照 → 輸入主題與 24 個文字 → AI 生 4×6 貼圖 → 下載 / LINE 上架 |
| 介面語言 | 繁體中文 |
| 程式碼語言 | TypeScript 5.9 |
| 部署原型 | Replit Autoscale Deployment(本文檔指引你搬到 GitHub + Firebase) |

### 核心功能
- **照片上傳**:JPG / PNG / WEBP / HEIC,前端用 magic bytes 驗,上限 10 MB
- **主題客製**:輸入關鍵字(如「馬年、太空人、黏土風」),一鍵套用到 24 格
- **24 格自訂文字**:每格 1–8 字繁中,可單獨修改
- **AI 生成**:OpenAI `gpt-image-1` 影像編輯,1024×1536 直式單張
- **客戶端切片**:Canvas 切成 24 張獨立 PNG
- **單張微調**:旋轉 ±15°、平移 ±15%、縮放 80–120%,即時預覽
- **三種下載格式**:整張 PNG、24 張 ZIP、**LINE 上架版 ZIP**(24 張 370×320 + main.png 240×240 + tab.png 96×74 + README.txt)
- **歷史紀錄**:IndexedDB 保留最近 5 次(JPEG 1280px @ 0.85 壓縮),點擊重新開啟
- **限流保護**:每 IP 每分鐘 3 張、每日 30 張(可調),Postgres 持久化
- **人機驗證**:Cloudflare Turnstile,production 必填,本機可關

---

## 2. 技術堆疊

### Monorepo
- **套件管理**:pnpm workspaces(`pnpm-workspace.yaml`)
- **Node.js**:v24(本機開發);**部署到 Cloud Functions 必須降到 v22**
- **TypeScript**:5.9(strict mode)
- **lint/format**:Prettier 3
- **供應鏈防護**:`minimumReleaseAge: 1440`(npm 套件需發布滿 1 天才允許安裝)

### 前端 `artifacts/sticker-studio`
- React 19.1 + Vite 7
- 路由:Wouter 3
- 資料/快取:`@tanstack/react-query` 5
- UI:Radix UI + shadcn/ui(本地化在 `src/components/ui/*`)
- 動畫:framer-motion
- 樣式:Tailwind CSS 4(`@tailwindcss/vite` plugin)
- 表單:react-hook-form + zod
- 影像處理:HTMLCanvas API(切片、micro-adjust、洪泛填充背景去除)
- 打包:JSZip + file-saver
- 離線歷史:IndexedDB(自製 wrapper)
- 人機驗證:Cloudflare Turnstile(SDK 由 `index.html` 載入)

### 後端 `artifacts/api-server`
- Express 5
- 日誌:pino + pino-http
- DB:PostgreSQL + Drizzle ORM
- 打包:esbuild ESM bundle → `dist/index.mjs`
- AI:`openai` SDK 6.x

### 共用 lib
- `lib/db` — Drizzle schema(`rate_limit_events`、`conversations`、`messages`)
- `lib/api-spec` — OpenAPI 3.1 YAML(codegen 來源)
- `lib/api-zod` — Orval 產生的 Zod schemas(`generated/` 已 ready)
- `lib/api-client-react` — Orval 產生的 React Query hooks + customFetch
- `lib/integrations-openai-ai-server` — OpenAI 後端 wrapper

### 資料庫
- PostgreSQL 16
- Drizzle ORM + drizzle-kit + drizzle-zod

---

## 3. 專案結構

```
TieTu/
├── README.md                     ← 本文件
├── .replit                       # Replit 啟動設定(GitHub 部署可不刪,會被忽略)
├── .gitignore / .npmrc / .replitignore
├── pnpm-workspace.yaml           # workspace + catalog + 平台 override
├── pnpm-lock.yaml
├── package.json                  # root scripts:typecheck / build
├── tsconfig.base.json + tsconfig.json
│
├── artifacts/                    # 可部署的應用層
│   ├── api-server/               # Express 5 API
│   │   ├── build.mjs             # esbuild ESM 打包
│   │   └── src/
│   │       ├── index.ts                 # PORT + 啟動驗證 + listen
│   │       ├── app.ts                   # express + middlewares
│   │       ├── lib/logger.ts            # pino
│   │       ├── middlewares/
│   │       │   ├── rate-limit.ts        # Postgres-backed 限流(advisory lock)
│   │       │   └── verify-turnstile.ts  # Cloudflare Turnstile
│   │       └── routes/
│   │           ├── health.ts            # GET /api/healthz
│   │           └── stickers.ts          # POST /api/stickers/generate
│   │
│   ├── sticker-studio/           # React Vite SPA(主應用)
│   │   ├── index.html            # 載入 Turnstile <script>
│   │   ├── vite.config.ts        # 需 PORT + BASE_PATH env
│   │   └── src/
│   │       ├── App.tsx           # QueryClient + Wouter + Toaster
│   │       ├── pages/{home,not-found}.tsx
│   │       ├── components/
│   │       │   ├── sticker-generator.tsx          # 上傳+24格輸入+Turnstile
│   │       │   ├── sticker-result.tsx             # 切片預覽+下載
│   │       │   ├── sticker-tile-editor.tsx        # 單格旋轉/平移/縮放
│   │       │   ├── sticker-line-export-dialog.tsx # LINE 上架包對話框
│   │       │   ├── sticker-cropper.tsx            # 可拖曳切割線編輯器
│   │       │   ├── sticker-lightbox.tsx           # 全螢幕放大檢視
│   │       │   ├── sticker-history.tsx            # IndexedDB 歷史紀錄
│   │       │   ├── turnstile-widget.tsx           # Turnstile JS API 包裝
│   │       │   └── ui/                            # shadcn Radix 元件
│   │       ├── hooks/
│   │       │   ├── use-mobile.tsx
│   │       │   ├── use-toast.ts
│   │       │   └── use-sticker-history-storage.ts # IndexedDB quota 自動釋放
│   │       └── lib/
│   │           ├── utils.ts                       # cn() helper
│   │           ├── sticker-utils.ts               # 切片、micro-adjust、LINE pack、洪泛去背
│   │           └── sticker-history.ts             # IndexedDB CRUD + JPEG 壓縮
│   │
│   └── mockup-sandbox/           # 內部 UI 元件預覽器(非主流程,部署可不帶)
│
├── lib/                          # 共用 packages(workspace:* 內部相依)
│   ├── api-spec/                 # openapi.yaml + orval.config.ts(codegen 來源)
│   ├── api-zod/                  # 已 generated 的 Zod schemas
│   ├── api-client-react/         # 已 generated 的 React Query hooks + customFetch
│   ├── db/                       # Drizzle schema + drizzle-kit config
│   ├── integrations-openai-ai-server/   # OpenAI 後端 wrapper
│   ├── integrations-openai-ai-react/    # 預留前端 wrapper(未使用)
│   └── integrations/openai_ai_integrations/   # Replit-managed integration(未引用)
│
├── scripts/
│   └── post-merge.sh             # `pnpm install` + `db push`(Replit hook)
│
└── attached_assets/              # 開發參考素材(設計稿截圖等),不被程式引用
```

---

## 4. 環境變數總表

### API Server
| 變數 | 必填 | 預設 | 說明 |
|---|---|---|---|
| `PORT` | ✅ | — | 監聽埠 |
| `NODE_ENV` |  | `development` | `production` 時強制要求 `TURNSTILE_SECRET_KEY` |
| `DATABASE_URL` | ✅ | — | Postgres 連線字串 |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | ✅ | — | OpenAI base(直連填 `https://api.openai.com/v1`) |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | ✅ | — | OpenAI API key |
| `TURNSTILE_SECRET_KEY` | dev 選 / prod 必 | — | Cloudflare Turnstile secret |
| `STICKER_RATE_LIMIT_PER_MINUTE` |  | `3` | 每分鐘上限 |
| `STICKER_RATE_LIMIT_PER_DAY` |  | `30` | 每日上限 |
| `LOG_LEVEL` |  | `info` | pino log level |
| `TRUST_PROXY` |  | (本專案目前是 `true`) | 部署到雲端要改成具體 hop 數(見 §12) |
| `CORS_ALLOWED_ORIGINS` |  | (本專案目前 cors 全開) | 上線必設(見 §12) |

### Sticker Studio(build-time Vite env)
| 變數 | 必填 | 預設 | 說明 |
|---|---|---|---|
| `PORT` | ✅(dev/preview) | — | Vite dev server 埠 |
| `BASE_PATH` | ✅ | — | 部署在子路徑時設 `/repo/`,根路徑設 `/` |
| `VITE_TURNSTILE_SITE_KEY` |  | — | 沒設則隱藏 widget |
| `VITE_API_BASE_URL` |  | — | 跨網域部署時設;Hosting + Functions 同網域時留空 |

> ⚠️ Cloudflare 提供測試 keys 供 QA([Turnstile testing](https://developers.cloudflare.com/turnstile/troubleshooting/testing/))。

---

## 5. 本機開發快速啟動

### 系統需求
- **Node.js 24+**(`nvm install 24 && nvm use 24`)
- **pnpm 10+**(`corepack enable && corepack prepare pnpm@latest --activate`)
- **Postgres 16**(本機 Docker:`docker run -d --name pg-tietu -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16`)
- **OpenAI API key**([platform.openai.com](https://platform.openai.com/api-keys))

### 步驟

```bash
# 1. 安裝相依
pnpm install

# 2. 設 env(api-server)
export PORT=8080 NODE_ENV=development
export DATABASE_URL="postgresql://postgres:dev@localhost:5432/tietu"
export AI_INTEGRATIONS_OPENAI_BASE_URL="https://api.openai.com/v1"
export AI_INTEGRATIONS_OPENAI_API_KEY="sk-..."

# 3. 設 env(sticker-studio)— 另一個 terminal
export PORT=23937 BASE_PATH="/"

# 4. 建 db + 推 schema
psql -h localhost -U postgres -c 'CREATE DATABASE tietu;'
pnpm --filter @workspace/db run push

# 5. 啟動 API
pnpm --filter @workspace/api-server run dev
# → http://localhost:8080/api/healthz

# 6. 啟動前端(另一 terminal)
pnpm --filter @workspace/sticker-studio run dev
# → http://localhost:23937
```

> ⚠️ **本機開發必補一個 patch**:`vite.config.ts` 沒設 proxy,前端打 `/api/*` 會 404。在 `server` block 加上:
> ```ts
> proxy: {
>   '/api': {
>     target: process.env.VITE_API_PROXY ?? 'http://localhost:8080',
>     changeOrigin: true,
>   },
> },
> ```
> Replit 環境靠平台反向代理,本機沒這層。

---

## 6. 常用指令對照表

| 指令 | 作用 |
|---|---|
| `pnpm install` | 安裝整個 workspace 相依 |
| `pnpm run typecheck` | 跨所有 package 跑 TS typecheck |
| `pnpm run build` | typecheck + 跑每個 package 的 build |
| `pnpm --filter @workspace/api-spec run codegen` | 從 `openapi.yaml` 重產 hooks + Zod schemas |
| `pnpm --filter @workspace/db run push` | drizzle-kit push schema(dev only) |
| `pnpm --filter @workspace/db run push-force` | 強制 push(會 drop columns) |
| `pnpm --filter @workspace/api-server run dev` | dev 模式跑 API(實際是 build+start) |
| `pnpm --filter @workspace/api-server run build` | esbuild bundle → `dist/index.mjs` |
| `pnpm --filter @workspace/sticker-studio run dev` | Vite dev server(HMR) |
| `pnpm --filter @workspace/sticker-studio run build` | Vite production build → `dist/public` |

---

## 7. 前端使用流程

```
1. 首頁 → 三大區塊
   ① 上傳大頭照(拖曳/點擊,JPG/PNG/WEBP/HEIC,≤ 10 MB)
   ② 主題輸入(選填,例「馬年/太空人/黏土風」)
   ③ 24 格貼圖文字(可逐格修改,「依主題改寫」/「恢復預設」)
2. 完成 Turnstile 人機驗證(若 site key 已設)
3. 點「生成 24 張 Q 版貼圖」
4. Loading 畫面播 6 條提示語(每 5 秒輪換),約 30–90 秒
5. 結果頁:
   ・整張 4×6 預覽(可放大檢視單張 — sticker-lightbox)
   ・調整切割線(欄/列數)— sticker-cropper
   ・點任一格 → 微調對話框(旋轉±15°、平移±15%、縮放 80–120%)
   ・三種下載:
     - 整張 PNG(stickers-{時間戳}.png)
     - 24 張 ZIP(stickers-tiles-{時間戳}.zip,內含 tile-01.png…)
     - LINE 上架版(開對話框選 main/tab + 調 matte tolerance,
                   產出 line-stickers-{時間戳}.zip;見 §11)
6. 歷史紀錄(IndexedDB)
   ・自動保留最近 5 次生成結果
   ・卡片可點擊 → 重新打開該次結果
   ・每張可單獨刪除,或一次「清除全部」
   ・配額不足時自動釋放最舊項目
```

### 微調(Tile Editor)細節
- 旋轉 `±15°`、平移 `±15%`(以 tile 邊長為基準)、縮放 `0.8 – 1.2`
- 內部以 `drawAdjustedTile()` 渲染,**source 區域 over-sample 30%** 避免旋轉/縮放後出現透明角
- 微調過的 tile 顯示「已微調」徽章 + 摘要

---

## 8. 後端 API 規格

來源真相是 [`lib/api-spec/openapi.yaml`](lib/api-spec/openapi.yaml)。

### `GET /api/healthz`
```json
200 OK
{ "status": "ok" }
```

### `POST /api/stickers/generate`
**Headers**(可擇一帶 token):body 內 `turnstileToken` 或 header `X-Turnstile-Token`。

**Request body**:
```jsonc
{
  "photoBase64": "data:image/png;base64,...",  // 或純 base64
  "theme": "馬年",                              // 選填,可 null
  "texts": ["收到", "晚安", ... 共 24 個 ],
  "turnstileToken": "0.kKO..."                  // server 啟用 captcha 時必填
}
```

**處理流程**:
1. **`verifyTurnstile()` middleware**
   - 沒設 secret → 跳過(dev only,啟動 log warning)
   - 沒帶 token → `403`
   - 呼叫 Cloudflare siteverify → 失敗 → `403`(過期/重用會給不同訊息)
2. **`rateLimit()` middleware**
   - Postgres advisory lock 串行同 IP 請求
   - 超過每分鐘 → `429` + `scope:"minute"` + `Retry-After`
   - 超過每日 → `429` + `scope:"day"` + `Retry-After`
   - DB 連不上 → `503`(fail-closed)
3. **Zod 驗證 body**
4. **`decodePhoto()`**:base64 → magic bytes 檢查(PNG/JPEG/WEBP/HEIC)
5. **`buildPrompt()`**:組長 prompt(4×6 排版、白色 die-cut 框、12 px 安全區、文字必須完整顯示)
6. **`editImagesFromBuffers()`** → OpenAI `gpt-image-1` `images.edit`,size `1024x1536`
7. 回傳:
```json
{
  "imageBase64": "iVBORw0...",  // 純 base64,無 data URL prefix
  "mimeType": "image/png"
}
```

### Response headers(限流)
不論成敗,都會帶:
- `X-RateLimit-Limit-Minute`、`X-RateLimit-Limit-Day`
- `X-RateLimit-Remaining-Minute`、`X-RateLimit-Remaining-Day`
- 超量時加 `Retry-After`

---

## 9. 限流與人機驗證

### 限流(`api-server/src/middlewares/rate-limit.ts`)
- **Bucket**:`"sticker:generate"`,寫入 `rate_limit_events` 表共用
- **Key**:預設 `req.ip`(因 `app.set("trust proxy", true)`)
- **演算法**:滑動視窗(過去 1 分鐘 / 1 天 vs 上限)
- **併發保護**:Postgres advisory lock(`pg_advisory_xact_lock(hashtext(bucket), hashtext(key))`)
- **清理**:每 5 分鐘 setInterval `DELETE WHERE created_at < now() - 1 day`
- **Fail-closed**:DB 連不上 → `503`,不放水

### Trust Proxy 警告
`app.set("trust proxy", true)` **完全信任** `X-Forwarded-For`。Replit 環境 OK,但搬到 Cloud Run / Cloudflare 後攻擊者可偽造繞過 IP 限流。修法:
```ts
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? "1"));
```

### Turnstile(`api-server/src/middlewares/verify-turnstile.ts`)
- 後端 POST 到 `https://challenges.cloudflare.com/turnstile/v0/siteverify`
- token **單次使用**,前端每次成功/失敗都要 `widget.reset()`
- 前端 widget 透過 `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js">` 載入

---

## 10. 資料庫 Schema

來源:`lib/db/src/schema/`。

### `rate_limit_events`(主要使用)
```sql
CREATE TABLE rate_limit_events (
  id          SERIAL PRIMARY KEY,
  bucket      TEXT NOT NULL,
  key         TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX rate_limit_events_bucket_key_created_at_idx
  ON rate_limit_events (bucket, key, created_at);
CREATE INDEX rate_limit_events_created_at_idx
  ON rate_limit_events (created_at);
```

### `conversations` / `messages`(預留,未使用)
Starter template 留下,目前無對應路由。要做客服對話可直接用。

### Schema 推送
```bash
pnpm --filter @workspace/db run push          # 互動式比對 → 套用
pnpm --filter @workspace/db run push-force    # 強制(會 drop;限 dev)
```

---

## 11. LINE 上架包規格

`buildLineStickerPackage`([sticker-utils.ts](artifacts/sticker-studio/src/lib/sticker-utils.ts))產出符合 LINE 個人原創貼圖規格的 ZIP:

| 檔案 | 規格 | 說明 |
|---|---|---|
| `01.png` ~ `24.png` | 370 × 320 透明 PNG | 24 張貼圖(LINE 個人原創必須剛好 24 張) |
| `main.png` | 240 × 240 透明 PNG | 主圖,使用者從 24 格選一 |
| `tab.png` | 96 × 74 透明 PNG | 聊天室分頁圖,可選與主圖相同或另選一格 |
| `README.txt` | 純文字 | 內容說明 |

### 背景去除(`removeMatteFromEdges`)
洪泛填充(flood fill)從邊緣灰底擴散,以可調 tolerance(0–96,**預設 28**)轉透明。前端在 `sticker-line-export-dialog.tsx` 用滑桿即時預覽。

### 流程
1. 點「下載 LINE 上架版」開 `StickerLineExportDialog`
2. 選主圖(從 24 格挑一)
3. 選分頁圖(switch:與主圖相同 / 另選一格)
4. 拖 matte tolerance 滑桿調背景去除程度
5. 即時透明預覽(checker 背景)
6. 確認 → 下載 ZIP

---

## 12. 從 Replit 移植到 GitHub + Firebase

> 🔥 **本專案的部署主推路線**:GitHub repo + GitHub Actions + Firebase Hosting + Cloud Functions v2 + Neon Postgres + Cloudflare Turnstile。
>
> Express 完全不用改寫,Hosting + Functions 同網域 → **零 CORS**,單一 console。

### 12.1 服務組合與成本

| 元件 | 服務 | 月成本 |
|---|---|---|
| Repo + CI/CD | **GitHub** + GitHub Actions | $0 |
| SPA | **Firebase Hosting** | $0(10 GB / 360 MB-day) |
| API | **Cloud Functions v2**(wrap Express) | $0(2M invocations / 400K GB-sec free) |
| Postgres | **Neon free tier** | $0(0.5 GB) |
| Captcha | **Cloudflare Turnstile** | $0 |
| OpenAI | 直連 | **每張 USD 0.16–0.19**(務必設帳單上限) |

> ⚠️ **Firebase 必須升 Blaze plan(綁信用卡)** 才能讓 Cloud Functions 呼叫外部 API(OpenAI)。Spark plan 鎖在 Google services 內。但 Blaze 有 free quota,小規模幾乎免費 → 實際 **$0**(不算 OpenAI)。**務必設 GCP Budget Alert + Hard Limit**。

### 12.2 移植前必改清單

#### A. `pnpm-workspace.yaml` 放寬平台 override
原本為 Replit Linux x64 image 縮小,把所有非 Linux x64 二進位 override 成 `"-"`。在 GitHub Actions Ubuntu runner OK,但若也要在 macOS / Windows 本機 dev 會抓不到。**整段 `overrides` 全刪,只留**:
```yaml
overrides:
  "@esbuild-kit/esm-loader": "npm:tsx@^4.21.0"
  esbuild: "0.27.3"
```

#### B. 前端 `vite.config.ts` 加 dev proxy
見 §5 末尾。

#### C. `artifacts/api-server/package.json` 加 `exports`(讓 Functions wrapper 能 import)
```json
"exports": {
  "./app": "./src/app.ts"
}
```
`app.ts` 已 `export default app`,不用改 source。

#### D. CORS 改 allowlist + Trust Proxy 改具體 hop
編輯 [`artifacts/api-server/src/app.ts:33`](artifacts/api-server/src/app.ts:33):
```ts
const allowed = (process.env.CORS_ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowed.length ? allowed : false,  // false = same-origin only
  credentials: false,
}));
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? "2"));
// Cloud Run 通常 2 hop(Google Frontend + Cloud Run sidecar)
```
> 💡 用 Hosting rewrite 同網域時,`CORS_ALLOWED_ORIGINS` 可不設(走 same-origin)。

#### E. 前端設 API base URL(僅跨網域時需要)
[`artifacts/sticker-studio/src/main.tsx`](artifacts/sticker-studio/src/main.tsx) 加:
```ts
import { setBaseUrl } from "@workspace/api-client-react";
const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
if (apiBase) setBaseUrl(apiBase);
```
Hosting + Functions 同網域時不設這個 env,走相對路徑。

#### F. Cloud Functions 最高支援 Node 22
本機可繼續用 24,部署到 Functions runtime 用 22(`functions/package.json` 內 `engines.node: "22"`)。本專案沒用 Node 23/24 才有的 feature,程式碼相容。

### 12.3 部署步驟

#### Step 1 — 推 repo 到 GitHub
```bash
git remote add origin https://github.com/<you>/tietu-sticker.git
git branch -M main
git push -u origin main
```
推前先 `git grep -nE "AI_INTEGRATIONS_OPENAI_API_KEY|sk-[a-zA-Z0-9]{20,}|TURNSTILE_SECRET"` 確認沒外洩 secret。

#### Step 2 — Neon Postgres
1. [neon.tech](https://neon.tech) → 建 project(region:Singapore)
2. 拿 **Pooled connection URL**(網址有 `-pooler`)
3. 本機推 schema:
   ```bash
   DATABASE_URL="<pooled-url>" pnpm --filter @workspace/db run push
   ```
> 📌 Functions 在 Cloud Run 後面,**用 Pooled URL**(每 request 新建連線);Direct URL 在 multi-instance 會耗盡 Postgres connection。

#### Step 3 — Cloudflare Turnstile + OpenAI key
- Turnstile:[Cloudflare Dashboard](https://dash.cloudflare.com/?to=/:account/turnstile) → Add Site,domain 填 `<project-id>.web.app` 與 `<project-id>.firebaseapp.com`,拿 Site Key + Secret Key
- OpenAI:[platform.openai.com](https://platform.openai.com),建 key,**Settings → Limits → Hard limit USD 50/mo**

#### Step 4 — Firebase 專案 + Blaze
1. [console.firebase.google.com](https://console.firebase.google.com) → Add project(名 `tietu-sticker`,disable Analytics)
2. 升 Blaze plan(綁卡)
3. **GCP Console → Billing → Budgets & alerts** 建 USD 10/mo 預算 + 50%/90%/100% email
4. 啟用 Hosting、Functions(會自動啟用 Cloud Build / Artifact Registry / Secret Manager API)
5. 記下 Project ID(例 `tietu-sticker`)

#### Step 5 — 加 Firebase 設定到 repo

**`firebase.json`**(repo 根目錄):
```json
{
  "hosting": {
    "public": "artifacts/sticker-studio/dist/public",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      { "source": "/api/**", "function": { "functionId": "tietuApi", "region": "asia-east1" } },
      { "source": "**", "destination": "/index.html" }
    ],
    "headers": [
      {
        "source": "**/*.@(js|css|svg|png|jpg|webp|woff2)",
        "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
      },
      {
        "source": "/index.html",
        "headers": [{ "key": "Cache-Control", "value": "no-cache" }]
      }
    ]
  },
  "functions": [
    {
      "source": "functions",
      "codebase": "tietu",
      "runtime": "nodejs22",
      "ignore": ["node_modules", ".git", "*.local"]
    }
  ]
}
```

**`.firebaserc`**:
```json
{ "projects": { "default": "tietu-sticker" } }
```

**`.gitignore`** 補一行:`.firebase/`

#### Step 6 — Cloud Functions wrapper

```
functions/
├── package.json
├── tsconfig.json
├── build.mjs
└── src/index.ts
```

**`functions/package.json`**:
```json
{
  "name": "tietu-functions",
  "version": "0.0.0",
  "private": true,
  "engines": { "node": "22" },
  "main": "lib/index.js",
  "scripts": {
    "build": "node ./build.mjs",
    "deploy": "pnpm run build && firebase deploy --only functions:tietuApi"
  },
  "dependencies": {
    "firebase-functions": "^6.0.0",
    "firebase-admin": "^12.0.0"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "esbuild": "^0.27.3",
    "typescript": "^5.9.2"
  }
}
```

**`functions/build.mjs`**(esbuild 把整個 Express + lib bundle 進 `lib/index.js`):
```js
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(__dirname, "src/index.ts")],
  outfile: resolve(__dirname, "lib/index.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["firebase-functions", "firebase-admin", "pg-native", "*.node"],
  logLevel: "info",
  sourcemap: "linked",
});
console.log("✓ Built functions/lib/index.js");
```

**`functions/src/index.ts`**(import Express app + 注入 secrets):
```ts
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";
import type { Request, Response } from "express";

const DATABASE_URL = defineSecret("DATABASE_URL");
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const TURNSTILE_SECRET_KEY = defineSecret("TURNSTILE_SECRET_KEY");
const STICKER_RATE_LIMIT_PER_MINUTE = defineSecret("STICKER_RATE_LIMIT_PER_MINUTE");
const STICKER_RATE_LIMIT_PER_DAY = defineSecret("STICKER_RATE_LIMIT_PER_DAY");

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://api.openai.com/v1";

let _app: any = null;
async function getApp() {
  if (_app) return _app;
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = OPENAI_API_KEY.value();
  const mod = await import("../../artifacts/api-server/src/app");
  _app = mod.default;
  return _app;
}

export const tietuApi = onRequest(
  {
    region: "asia-east1",
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 10,
    concurrency: 80,
    cpu: 1,
    invoker: "public",
    secrets: [DATABASE_URL, OPENAI_API_KEY, TURNSTILE_SECRET_KEY, STICKER_RATE_LIMIT_PER_MINUTE, STICKER_RATE_LIMIT_PER_DAY],
  },
  async (req: Request, res: Response): Promise<void> => {
    try {
      const app = await getApp();
      app(req, res);
    } catch (err) {
      logger.error("Function entry error", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);
```

把 `functions` 加進 `pnpm-workspace.yaml`:
```yaml
packages:
  - artifacts/*
  - lib/*
  - lib/integrations/*
  - scripts
  - functions
```
然後 `pnpm install`。

#### Step 7 — 設 secrets + 第一次手動部署
```bash
npm i -g firebase-tools
firebase login

firebase functions:secrets:set DATABASE_URL          # 貼 Neon pooled URL
firebase functions:secrets:set OPENAI_API_KEY        # 貼 OpenAI key
firebase functions:secrets:set TURNSTILE_SECRET_KEY  # 貼 Turnstile secret
firebase functions:secrets:set STICKER_RATE_LIMIT_PER_MINUTE   # 輸入 3
firebase functions:secrets:set STICKER_RATE_LIMIT_PER_DAY      # 輸入 30

PORT=23937 BASE_PATH=/ \
  VITE_TURNSTILE_SITE_KEY="<site-key>" \
  pnpm --filter @workspace/sticker-studio run build

pnpm --filter tietu-functions run build

firebase deploy --only hosting,functions:tietuApi
```

> ⚠️ **絕對不要** `firebase deploy --force` 或 `--only functions`(沒 `:tietuApi` 後綴)。`--force` 會無聲砍掉這個 GCP project 上**任何**現存 functions(即使是別 codebase)。永遠用 `:tietuApi` 限定。

完成後 CLI 印出 `https://tietu-sticker.web.app`,試:
```bash
curl https://tietu-sticker.web.app/api/healthz
# {"status":"ok"}
```

#### Step 8 — GitHub Actions 自動部署

**GitHub Secrets**(Repo → Settings → Secrets → Actions):
| 名稱 | 值 |
|---|---|
| `FIREBASE_TOKEN` | `firebase login:ci` 拿到的 token |
| `FIREBASE_PROJECT_ID` | 例 `tietu-sticker` |
| `VITE_TURNSTILE_SITE_KEY` | Turnstile site key |

> 📌 OpenAI / DB 等 backend secrets 已在 GCP Secret Manager,不需放 GitHub Secrets。

**`.github/workflows/ci.yml`**:
```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm run typecheck
```

**`.github/workflows/deploy.yml`**:
```yaml
name: Deploy to Firebase
on:
  push: { branches: [main] }
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Build SPA
        env:
          PORT: 23937
          BASE_PATH: /
          VITE_TURNSTILE_SITE_KEY: ${{ secrets.VITE_TURNSTILE_SITE_KEY }}
        run: pnpm --filter @workspace/sticker-studio run build
      - name: Build Functions
        run: pnpm --filter tietu-functions run build
      - name: Deploy to Firebase
        uses: w9jds/firebase-action@v14.10.1
        with:
          args: deploy --only hosting,functions:tietuApi --project ${{ secrets.FIREBASE_PROJECT_ID }} --force
        env:
          FIREBASE_TOKEN: ${{ secrets.FIREBASE_TOKEN }}
```
推 main 後 → repo Actions 看 workflow。約 5 分鐘完成。

#### Step 9 — 自訂網域(選用)
- Firebase Console → Hosting → Add custom domain → `tietu.example.com`
- DNS 加上 Firebase 給的 A record(等 5–60 分鐘驗證)
- Cloudflare Turnstile widget settings 加上自訂網域

> Functions 走在 Hosting 後面,API 自動跟著走自訂網域(`https://tietu.example.com/api/...`)

### 12.4 上線前安全 Checklist

#### 必做
- [ ] **OpenAI Hard Limit** USD 50/mo
- [ ] **GCP Budget Alert** USD 10/mo + 50%/90%/100% email
- [ ] **Cloud Functions `maxInstances: 10`** 防暴衝
- [ ] **Turnstile** site/secret 配對且 production 必填
- [ ] **CORS allowlist** 設好(同網域可空)
- [ ] **TRUST_PROXY=2** 適合 Cloud Run
- [ ] **Secrets 全 rotate** — Replit 搬出來的全換新
- [ ] `git log -p | grep -E "sk-|secret_"` 無 hit
- [ ] `.firebase/` 在 `.gitignore`

#### 強烈建議
- [ ] Firebase App Check(防 token 直打 API)
- [ ] UptimeRobot 監控 `/api/healthz`
- [ ] Sentry / Logtail 收 5xx error

### 12.5 替代路線(僅供參考)

| 路線 | 何時選 |
|---|---|
| **GitHub Pages + Cloudflare Workers + Neon** | 想要邊緣速度,不介意把 Express 改寫成 Hono(~200 行) |
| **GitHub Pages + Deno Deploy + Neon** | 完全免費,免費 50ms CPU 比 Workers 寬鬆 |
| **GitHub Pages + Hugging Face Spaces (Docker) + Neon** | 完全免費,Express 不改寫,但會 sleep |

> 都不如 Firebase 直觀。本專案以 Firebase 為主推。

---

## 13. 優化路線圖 P0–P4

排序原則:**先安全 → 再體驗 → 再成本/規模 → 最後是能力擴張**。

### P0 — 安全與穩定(上線前必做)
| 項 | 內容 | 出處 | 估時 |
|---|---|---|---|
| P0-1 | **CORS allowlist** | [api-server/src/app.ts:33](artifacts/api-server/src/app.ts:33) | 30 min |
| P0-2 | **`trust proxy` 改具體 hop** | [api-server/src/app.ts:12](artifacts/api-server/src/app.ts:12) | 15 min |
| P0-3 | **OpenAI 帳單上限 + 監控告警** | OpenAI Dashboard | 30 min |
| P0-4 | **Secrets 全面 rotate**(從 Replit 搬出來時) | — | 30 min |

### P1 — 體驗與品質(上線後 1 週內)
| 項 | 內容 | 估時 |
|---|---|---|
| P1-1 | Vite dev server 加 `/api` proxy | 15 min |
| P1-2 | env 集中驗證(用 zod 在啟動時) | 1 hr |
| P1-3 | OpenAI 失敗訊息**分類**(content_policy / rate_limit / upstream_error / internal) | 1 hr |
| P1-4 | 大檔案上傳改 `multipart/form-data`(省 33% 流量,避免 50mb JSON 吃 RAM) | 3 hr |
| P1-5 | 加 `/api/readyz`(檢查 DB)區分 liveness/readiness | 30 min |
| P1-6 | Loading 中斷邏輯(`AbortController` + 取消按鈕) | 1 hr |

### P2 — 成本與規模(MAU 破千後)
| 項 | 內容 | 估時 |
|---|---|---|
| P2-1 | **背景 job 化**(避免 Cloud Run / LB 60 秒切斷):新表 `sticker_jobs` + 兩段 API + 前端 polling/SSE | 1–2 day |
| P2-2 | **CDN 快取生成結果**:上傳到 Firebase Storage / R2,前端拿 URL 而非 base64 | 0.5 day |
| P2-3 | Postgres pool 調校(`max`、`idleTimeoutMillis`) | 30 min |
| P2-4 | **限流分層**:全域 + IP + session | 0.5 day |
| P2-5 | Prometheus / OpenTelemetry metrics | 0.5 day |

### P3 — 能力擴張(產品化)
| 項 | 內容 | 估時 |
|---|---|---|
| P3-1 | **使用者帳號**(Firebase Authentication 最 native):Google + Apple OAuth | 1–2 wk |
| P3-2 | **付費方案**(Stripe;workspace 已預留 `stripe-replit-sync`):Free/Plus/Pro | 2 wk |
| P3-3 | Prompt 風格選擇器(pop-mart-3d / clay / pixel / anime / watercolor) | 1 day |
| P3-4 | 多語系(i18n;zh-TW / zh-CN / en / ja) | 3 day |
| P3-5 | 即時生成進度(SSE 推「上傳中→AI 思考中→生成中→切片中」) | 2 day |
| P3-6 | OCR 自動重試:tesseract.js 比對輸出文字,差異率 > 30% 重生 | 3 day |
| P3-7 | LINE Bot / Telegram Bot 介面 | 1 wk |

### P4 — 工程效能(累積 3 個月後)
| 項 | 內容 | 估時 |
|---|---|---|
| P4-1 | 補測試(vitest;rate-limit、verify-turnstile、decodePhoto、buildPrompt、splitImageWithGuides、buildLineStickerPackage) | 1 wk |
| P4-2 | E2E test(Playwright;upload → mock OpenAI → 切片 → 下載 ZIP) | 1 day |
| P4-3 | 整理 monorepo(統一 `lib/integrations/openai/`,加 turbo cache) | 1 day |
| P4-4 | 抽 prompt 到設定檔(`lib/sticker-prompts/templates/{style}.txt`) | 0.5 day |
| P4-5 | 文件持續維護(README、TypeDoc、貢獻指南) | 持續 |

### 1 週上線優化計畫(最務實)
```
Day 1(2 hr):P0-1 ~ P0-4 全做
Day 2(3 hr):P1-1、P1-2、P1-3
Day 3:Firebase 部署(§12)+ Turnstile + 自訂網域
Day 4–5:觀察 OpenAI usage、pino log 錯誤 pattern,調 RATE_LIMIT_PER_DAY
Day 6–7:P1-5 readyz、UptimeRobot、Slack/LINE 告警
```

### 3 個月規模化路線
```
Week 1–2:P2-1 background jobs
Week 3:    P2-2 Firebase Storage 結果儲存 + CDN
Week 4:    P2-4 全域 + session 限流
Week 5–6:  P3-1 帳號(Firebase Auth)
Week 7–8:  P3-2 Stripe 付費 + 額度
Week 9:    P3-3 風格選擇器
Week 10:   P4-1 測試
Week 11–12:P3-5 進度 + P3-6 OCR 自動重試
```

### Top 5 我會親手做(只有時間做 5 件事的話)
1. **P0-1 + P0-2 + P0-3**(安全三連)
2. **P1-3** 錯誤分類(體感最明顯)
3. **P2-1** 背景 job(規模一上來必經之痛)
4. **P3-2** Stripe 付費(免費版不可持續)
5. **P4-1** 測試(改 prompt / 升 OpenAI 模型版本時不怕)

---

## 14. 疑難排解 FAQ

| 症狀 | 可能原因 | 解法 |
|---|---|---|
| 啟動 API 拋 `PORT environment variable is required` | 沒設 `PORT` | export |
| 啟動 API 拋 `TURNSTILE_SECRET_KEY is required in production` | `NODE_ENV=production` 但沒設 secret | 設 secret 或暫改 NODE_ENV |
| 啟動 API 拋 `DATABASE_URL must be set` | 沒設 DB | 補 env |
| API 回 503 + `暫時無法驗證生成額度` | DB 連線中斷或表不存在 | `pnpm --filter @workspace/db run push` |
| API 回 403 `請先完成人機驗證` | token 沒帶,或 site/secret 不配對 | 檢查 `VITE_TURNSTILE_SITE_KEY` 與 `TURNSTILE_SECRET_KEY` |
| API 回 429 + 今天額度用完 | 達 `STICKER_RATE_LIMIT_PER_DAY` | 等 24 小時或調高(注意帳單) |
| API 回 500 `貼圖生成失敗` | OpenAI 那端錯(quota / safety / 模型 down) | 看 pino log;`gpt-image-1` 偶爾拒絕真人照 |
| 前端送請求都 404 | Vite dev server 沒 proxy | 加 `server.proxy['/api']`(§5) |
| 上傳 HEIC 後拋「無法辨識的影像格式」 | magic bytes 對不上罕見 sub-brand | 轉 JPG;或在 `detectMimeFromMagicBytes` 多加 brand |
| `pnpm install` 卡很久 | `minimumReleaseAge: 1440` 在驗證 | 預期行為,首次裝會慢 |
| Build 抓不到平台二進位 | `pnpm-workspace.yaml` 平台 override 太嚴 | 刪除 overrides(§12.2.A) |
| `firebase deploy` 失敗:Functions deploy requires Blaze | 還在 Spark | 升 Blaze |
| Function 啟動 crash:`DATABASE_URL must be set` | secret 沒在 onRequest 的 `secrets:` 宣告 | 兩邊都要;`firebase functions:secrets:get` 確認 |
| Function 第一次叫醒慢 3 秒 | Cold start | 正常;不能接受設 `minInstances: 1`(會收費) |
| Function timeout(60 秒) | 預設太低 | 已設 `timeoutSeconds: 540` |
| SPA 路由 `/some-page` 404 | `firebase.json` rewrites 順序錯 | `/api/**` 必須在 `**` 之前 |
| 同網域但前端打 API 還 CORS | 前端用了 `VITE_API_BASE_URL` 指到別網域 | 留空 → 走相對路徑 |
| Neon 偶爾 connection refused | Neon free tier 自動暫停 idle compute | 第一次 wake 慢,後續正常;升 paid 或加 retry |
| 部署完不知道誤砍既有 function | 沒用 `:tietuApi` 限定 codebase | **永遠** `--only functions:tietuApi` |

---

## 附錄 A — Prompt 設計重點

完整 prompt 在 [`api-server/src/routes/stickers.ts:118`](artifacts/api-server/src/routes/stickers.ts:118) 的 `buildPrompt()`。要點:
1. 單張 1024×1536 直式、4 欄 6 列均分
2. 每格 256×256,**全圖背景固定 #808080**(50% 灰)
3. 每格 ≥12 px 安全區,文字+角色都不能碰邊
4. 每列文字位置固定:Row 1、2–5 底部;Row 6 頂部
5. 文字必須**完整顯示在格內**,粗體圓黑體繁中,過長可換行
6. 每格白色 die-cut 框 14–18 px
7. 同一個人物 24 個動作/表情/服裝/道具
8. 不可加 logo / 簽名 / 浮水印

> 這個 prompt 經過多次調整(可從 git log 看 `Adjust sticker generation to prevent text from being cut off` 等 commit),不要輕易改動。

---

## 附錄 B — 為什麼是 Firebase 而非其他?

| 維度 | Firebase | Cloudflare Workers | Render / Vercel Pro / Fly | VPS |
|---|---|---|---|---|
| Express 是否要改寫 | ❌ 不用 | ✅ 改 Hono(~200 行) | ❌ 不用 | ❌ 不用 |
| 同網域(零 CORS) | ✅ Hosting rewrite | ❌ 跨網域 | 看設定 | 視 reverse proxy |
| 免費 tier 流量 | 2M invocations/mo | 100K req/day(free)| Render free 會 sleep | 看主機 |
| 冷啟動 | 1–3 秒 | < 100 ms | 長 sleep 後 30 秒+ | 不 sleep |
| 是否要綁卡 | ✅ Blaze | 用 free 不用 | 用 free 不用 | 主機要 |
| 部署方式 | `firebase deploy` + GitHub Actions | `wrangler deploy` | git push | rsync / Docker |
| 適合 | 主推 | 邊緣性能 / 完全免費 | 不選(收費) | 完全控管 |

---

## License

MIT
