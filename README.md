# TieTu — 3D Q版貼圖生成器

> 上傳一張大頭照 → 自訂主題與 24 個文字標籤 → AI 生成 4×6 共 24 張 Q 版貼圖 → 下載成 PNG / 24 張 ZIP / **LINE 個人原創貼圖上架包**。

| 介面 | 後端 | 模型 | 部署 |
|---|---|---|---|
| Vite + React 19 + Tailwind 4 + shadcn/ui | Express 5(monorepo)→ Cloud Functions v2 | **Google Gemini 2.5 Flash Image**(`gemini-2.5-flash-image`,multimodal IMAGE output) | **GitHub + Firebase**(主推) |

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
- **AI 生成**:Google Gemini 2.5 Flash Image(Nano Banana Pro)multimodal,輸入照片 + prompt 生成 4×6 sticker sheet
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
- AI:`@google/genai` SDK 1.x(Gemini multimodal)

### 共用 lib
- `lib/db` — Drizzle schema(`rate_limit_events`、`conversations`、`messages`)
- `lib/api-spec` — OpenAPI 3.1 YAML(codegen 來源)
- `lib/api-zod` — Orval 產生的 Zod schemas(`generated/` 已 ready)
- `lib/api-client-react` — Orval 產生的 React Query hooks + customFetch
- `lib/integrations-gemini-server` — Gemini 後端 wrapper(`@google/genai` SDK,multimodal image generation)

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
│   ├── integrations-gemini-server/      # Gemini 後端 wrapper(@google/genai)
│   └── integrations/openai_ai_integrations/   # Replit-managed integration(未引用,可保留或刪除)
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
| `GEMINI_API_KEY` | ✅ | — | Google AI Studio API key([aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey),格式 `AIzaSy...`) |
| `GEMINI_IMAGE_MODEL` |  | `gemini-2.5-flash-image` | 部署前用 ListModels 確認 model 還在,必要時 override |
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
- **Gemini API key**([aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey);free tier 已可跑 1500 RPD)

### 步驟

```bash
# 1. 安裝相依
pnpm install

# 2. 設 env(api-server)
export PORT=8080 NODE_ENV=development
export DATABASE_URL="postgresql://postgres:dev@localhost:5432/tietu"
export GEMINI_API_KEY="AIzaSy..."
# Optional: export GEMINI_IMAGE_MODEL="gemini-2.5-flash-image"

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
6. **`generateStickerSheet()`** → Gemini `gemini-2.5-flash-image` multimodal `generateContent`,`responseModalities: [IMAGE]`,`thinkingConfig: { thinkingBudget: 0 }`
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
| Gemini API | Google AI Studio | **Free tier 1500 RPD**;付費約 USD 0.04/張(比 OpenAI 便宜很多) |

> ⚠️ **Firebase 必須升 Blaze plan(綁信用卡)** 才能讓 Cloud Functions 呼叫外部 HTTPS。Spark plan 鎖在 Google services 內(雖然 Gemini API 也是 Google 服務,但走 `generativelanguage.googleapis.com` 仍算外部呼叫)。Blaze 有 free quota,小規模幾乎免費 → 實際 **$0**(不算 Gemini)。**務必設 GCP Budget Alert + Hard Limit**。

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
git remote add origin https://github.com/cagoooo/TieTu.git    # 若你 fork 出去,改成自己的 URL
git branch -M main
git push -u origin main
```
推前先 `git grep -nE "GEMINI_API_KEY|AIzaSy[A-Za-z0-9_-]{30,}|TURNSTILE_SECRET"` 確認沒外洩 secret。

#### Step 2 — Neon Postgres
1. [neon.tech](https://neon.tech) → 建 project(region:Singapore)
2. 拿 **Pooled connection URL**(網址有 `-pooler`)
3. 本機推 schema:
   ```bash
   DATABASE_URL="<pooled-url>" pnpm --filter @workspace/db run push
   ```
> 📌 Functions 在 Cloud Run 後面,**用 Pooled URL**(每 request 新建連線);Direct URL 在 multi-instance 會耗盡 Postgres connection。

#### Step 3 — Cloudflare Turnstile + Gemini key
- **Turnstile**:[Cloudflare Dashboard](https://dash.cloudflare.com/?to=/:account/turnstile) → Add Site,domain 填 hosting 自訂域名 + `<site-name>.web.app`,拿 Site Key + Secret Key
- **Gemini API key**:[aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) → Create API key(預設綁到當前 Google project,可選擇 `zhuyin-challenge-v3-4cd2b` 共用 quota)
- **驗證 model 還在**(必做):
  ```bash
  curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSy..." \
    | grep -oE '"name":\s*"models/gemini-[^"]*image[^"]*"'
  ```
  確認看到 `gemini-2.5-flash-image`(或同等的 image model)。如果改名,設 env `GEMINI_IMAGE_MODEL=...` 覆蓋。

#### Step 4 — 在既有 Firebase 專案加新 Web App + Hosting Site

> ⚠️ **本專案部署到既有 `zhuyin-challenge-v3-4cd2b` 專案**(而非建新 project)。
> 必須嚴格按 [`firebase-multi-app-safety` skill](https://github.com/anthropic-ai/skills) 的多應用隔離原則:
> - codebase 名稱 `tietu`(不是 `default`)
> - function export `tietu_api`(不會跟 zhuyin 將來加的 function 撞)
> - secrets 全用 `TIETU_*` 前綴
> - deploy 永遠 `--only functions:tietu`(不可用 `--only functions`)

**4.1 — Pre-flight 確認沒衝突**(本機跑):
```bash
firebase login                                                         # 確認登入帳號
firebase functions:list --project=zhuyin-challenge-v3-4cd2b           # 列既有 functions(有衝突命名要避開)
firebase apps:list --project=zhuyin-challenge-v3-4cd2b                # 列既有 web apps
firebase hosting:sites:list --project=zhuyin-challenge-v3-4cd2b       # 列既有 hosting sites
```
本專案 Pre-flight 結果:0 functions、1 web app(Zhuyin)、1 hosting site(default = `zhuyin-challenge-v3-4cd2b.web.app`)。**無衝突**。

**4.2 — 在 Firebase Console 建第二個 Web App**(GUI):
1. 進 [console.firebase.google.com](https://console.firebase.google.com) → 選 `zhuyin-challenge-v3-4cd2b`
2. **Project Overview** → 點齒輪圖示 → **Project settings** → 在「Your apps」段點「**Add app**」→ 選 Web 圖示
3. **App nickname**:`TieTu`(注意大小寫,跟 Zhuyin Web App v3 並列)
4. **不要勾** Firebase Hosting(等下另開獨立 site)
5. Register app — 取得 firebaseConfig 對象(本專案前端目前不用 Firebase SDK,所以暫不需要這個 config;**留著備用**,將來要加 Firebase Auth / Analytics 時會用到)

**4.3 — 在 Hosting 加第二個 Site**(關鍵 — 不會覆蓋 zhuyin 的網站):
1. Console → **Hosting** → 點「**Add another site**」
2. 輸入新 site ID:`tietu`(或 `tietu-sticker`,如果 `tietu` 已被全球佔用)
3. 完成 → 取得網址 `https://tietu.web.app`(或同名)

**4.4 — Blaze plan 與 Budget Alert**:
- 如果 `zhuyin-challenge-v3-4cd2b` 還是 Spark plan,進 Console 左下角升 **Blaze**(綁信用卡)
- **GCP Console → Billing → Budgets & alerts** 建 USD 10/mo 預算 + 50%/90%/100% email
- 確認啟用 Cloud Functions / Cloud Build / Artifact Registry / Secret Manager API(部署時會自動觸發)

**4.5 — 啟用 Generative Language API**(讓 GCP 能呼叫 Gemini):
雖然 Gemini API 是用 AI Studio key auth,Cloud Functions 跑時的 outbound HTTPS 會打 `generativelanguage.googleapis.com`,Blaze plan 必開即可,**不需額外 enable Vertex AI**(我們不走 Vertex)。

#### Step 5 — 加 Firebase 設定到 repo(本 repo 已包含,僅供參考)

> ✅ 這份 repo 已經把 `firebase.json`、`.firebaserc`、`functions/` wrapper 都建好。
> 如果你 fork 出去自己改,以下是參考內容。

**`firebase.json`**(repo 根目錄)— 注意 `hosting.target: "tietu"` 必須 + `functions.codebase: "tietu"`:
```json
{
  "hosting": {
    "target": "tietu",
    "public": "artifacts/sticker-studio/dist/public",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      { "source": "/api/**", "function": { "functionId": "tietu_api", "region": "asia-east1" } },
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
{
  "projects": {
    "default": "zhuyin-challenge-v3-4cd2b"
  },
  "targets": {
    "zhuyin-challenge-v3-4cd2b": {
      "hosting": {
        "tietu": []
      }
    }
  }
}
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
    "deploy": "pnpm run build && firebase deploy --only functions:tietu"
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

**`functions/src/index.ts`**(import Express app + 注入 TIETU_-prefixed secrets):
```ts
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";

// All secrets use the TIETU_ prefix to coexist safely with any other apps in
// the same Firebase project (see firebase-multi-app-safety skill).
const TIETU_DATABASE_URL = defineSecret("TIETU_DATABASE_URL");
const TIETU_GEMINI_API_KEY = defineSecret("TIETU_GEMINI_API_KEY");
const TIETU_TURNSTILE_SECRET_KEY = defineSecret("TIETU_TURNSTILE_SECRET_KEY");
const TIETU_RATE_LIMIT_PER_MINUTE = defineSecret("TIETU_RATE_LIMIT_PER_MINUTE");
const TIETU_RATE_LIMIT_PER_DAY = defineSecret("TIETU_RATE_LIMIT_PER_DAY");

// firebase-functions ships @types/express-serve-static-core@4 while api-server
// uses Express 5; types differ but runtime is compatible.
type RequestHandler = (req: unknown, res: unknown) => void;

let _appPromise: Promise<RequestHandler> | null = null;
async function getApp(): Promise<RequestHandler> {
  if (_appPromise) return _appPromise;
  _appPromise = (async () => {
    // Map TIETU_-prefixed secrets to env names the existing Express app expects.
    process.env.DATABASE_URL = TIETU_DATABASE_URL.value();
    process.env.GEMINI_API_KEY = TIETU_GEMINI_API_KEY.value();
    process.env.TURNSTILE_SECRET_KEY = TIETU_TURNSTILE_SECRET_KEY.value();
    process.env.STICKER_RATE_LIMIT_PER_MINUTE = TIETU_RATE_LIMIT_PER_MINUTE.value();
    process.env.STICKER_RATE_LIMIT_PER_DAY = TIETU_RATE_LIMIT_PER_DAY.value();
    process.env.TRUST_PROXY = process.env.TRUST_PROXY ?? "2";
    // CORS allowlist intentionally unset — Hosting rewrites keep us same-origin.
    const mod = (await import("@workspace/api-server/app")) as { default: RequestHandler };
    return mod.default;
  })();
  return _appPromise;
}

export const tietu_api = onRequest(
  {
    region: "asia-east1",
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 10,
    concurrency: 80,
    cpu: 1,
    invoker: "public",
    secrets: [TIETU_DATABASE_URL, TIETU_GEMINI_API_KEY, TIETU_TURNSTILE_SECRET_KEY, TIETU_RATE_LIMIT_PER_MINUTE, TIETU_RATE_LIMIT_PER_DAY],
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

#### Step 7 — 綁 hosting target、設 secrets、第一次手動部署
```bash
npm i -g firebase-tools
firebase login

# 7.1 — 把 firebase.json 內的 hosting target "tietu" 綁定到 Step 4.3 建立的
#       hosting site(預設名 "tietu";若被佔用則用實際名稱,如 "tietu-sticker")。
#       這個 target apply 結果會寫進 .firebaserc 的 targets 區段。
firebase target:apply hosting tietu tietu --project=zhuyin-challenge-v3-4cd2b

# 7.2 — 設 secrets。TIETU_ 前綴與 zhuyin 等其他應用安全共存。
firebase functions:secrets:set TIETU_DATABASE_URL          # 貼 Neon pooled URL
firebase functions:secrets:set TIETU_GEMINI_API_KEY        # 貼 AIzaSy 開頭的 Gemini API key
firebase functions:secrets:set TIETU_TURNSTILE_SECRET_KEY  # 貼 Turnstile secret
firebase functions:secrets:set TIETU_RATE_LIMIT_PER_MINUTE # 輸入 3
firebase functions:secrets:set TIETU_RATE_LIMIT_PER_DAY    # 輸入 30

# 7.3 — Build SPA + Functions
PORT=23937 BASE_PATH=/ \
  VITE_TURNSTILE_SITE_KEY="<site-key>" \
  pnpm --filter @workspace/sticker-studio run build

pnpm --filter tietu-functions run build

# 7.4 — 部署 — ⚠️ 一定要 --only 限定 codebase!
firebase deploy --only "hosting:tietu,functions:tietu" --project=zhuyin-challenge-v3-4cd2b
```

> 🛡️ **Multi-app safety**:
> - **絕對不要** `firebase deploy` 或 `firebase deploy --only functions`(沒指定 codebase)— 會把 Zhuyin 等其他應用的 Cloud Functions 砍光
> - **絕對不要** `--force` 配合無 `--only`(雙重危險)
> - 永遠用 `--only "hosting:tietu,functions:tietu"`(`tietu` 是 codebase 名稱,在 `firebase.json` 內定義;這個 codebase 內目前只有 `tietu_api` 一個 function)
> - 部署前可跑 `firebase functions:list --project=zhuyin-challenge-v3-4cd2b` 看看是否有非預期的 function,確認 zhuyin 等應用安全

完成後 CLI 印出 `https://tietu.web.app`(或自定 site 名),試:
```bash
curl https://tietu.web.app/api/healthz
# {"status":"ok"}
```

#### Step 8 — GitHub Actions 自動部署

**GitHub Secrets**(Repo → Settings → Secrets → Actions):
| 名稱 | 值 |
|---|---|
| `FIREBASE_TOKEN` | `firebase login:ci` 拿到的 token |
| `FIREBASE_PROJECT_ID` | `zhuyin-challenge-v3-4cd2b` |
| `VITE_TURNSTILE_SITE_KEY` | Turnstile site key |

> 📌 Gemini / DB 等 backend secrets 已在 GCP Secret Manager(用 `firebase functions:secrets:set TIETU_*` 設),不需放 GitHub Secrets。

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
          args: deploy --only "hosting:tietu,functions:tietu" --project ${{ secrets.FIREBASE_PROJECT_ID }} --force
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
- [ ] **Gemini API quota** 確認(Free tier 1500 RPD;若超 → [aistudio.google.com](https://aistudio.google.com) 升 paid tier)
- [ ] **GCP Budget Alert** USD 10/mo + 50%/90%/100% email
- [ ] **Cloud Functions `maxInstances: 10`** 防暴衝
- [ ] **Turnstile** site/secret 配對且 production 必填
- [ ] **CORS allowlist** 設好(同網域可空)
- [ ] **TRUST_PROXY=2** 適合 Cloud Run
- [ ] **Secrets 全 rotate** — Replit 搬出來的全換新
- [ ] `git log -p | grep -E "AIzaSy|sk-|secret_"` 無 hit
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

### 13.0 — 已完成成果(2026-04-26 部署 session)

從 Replit 搬到 GitHub + Firebase 多應用環境的成果(共 11 個 commits 從 `78fe643` ~ `50c97de`):

#### 部署與基礎建設(11 項)
- ✅ Repo push 到 `github.com/cagoooo/TieTu`(public),v0.1.0 tag
- ✅ Firebase 部署到既有 `zhuyin-challenge-v3-4cd2b` 專案,**multi-app safe**(codebase `tietu`、function `tietu_api`、hosting target `tietu` 全部 namespaced;Zhuyin Web App v3 與 Browser key 完全沒被誤動)
- ✅ Cloud Functions v2 在 `asia-east1`,Node 22,1 GiB,maxInstances=10,timeout 540 s
- ✅ Hosting site `tietu` + 同網域 `/api/**` rewrite 到 Function
- ✅ GitHub Pages mirror `https://cagoooo.github.io/TieTu/`(SPA 兩處皆可用)
- ✅ GCP Service Account `github-actions-tietu`,11 個 IAM roles,key piped 進 GitHub Secret(零暴露)
- ✅ GitHub Actions 三條 workflow:`ci.yml` + `deploy.yml`(Firebase)+ `deploy-pages.yml`(GitHub Pages)— **push main 自動部署兩處**
- ✅ Artifact Registry cleanup policy(5 day retention)防容器映像累積帳單
- ✅ Secrets 全 `TIETU_*` 前綴(剩 2 個:`TIETU_GEMINI_API_KEY` 真實值 + `TIETU_TURNSTILE_SECRET_KEY` 暫為 `DISABLED` sentinel)
- ✅ Cloud Billing API 啟用 + Blaze plan 綁定到 `01BE02-E9987A-49E884`(同 smes-e1dc3)
- ✅ Cloud Function CORS allowlist:`tietu.web.app` + `tietu.firebaseapp.com` + `cagoooo.github.io`(跨網域時 GitHub Pages 也能呼叫 API)

#### 程式碼遷移(6 項)
- ✅ 移除 OpenAI(`gpt-image-1`)→ 改 **Google Gemini API**(`@google/genai` SDK + AI Studio key)
- ✅ Default model 升級到 **`gemini-3.1-flash-image-preview`**(中文字體比 2.5-image 系列大幅進步;skill `gemini-api-integration` 的 ListModels 工作流確認)
- ✅ 修 `thinkingConfig` bug(image-output 模型不接受該 config,只有 text 模型用)
- ✅ Express CORS 從全開改成 env-driven allowlist;`trust proxy` 從 `true` 改成具體 hop count
- ✅ Vite config:`BASE_PATH` / `PORT` 改成 sane default(避開 Windows Git Bash 的 MSYS path conversion 雷)
- ✅ pnpm-workspace.yaml 放寬 Replit-only 平台 overrides;Cloud Functions wrapper 用 esbuild bundle workspace 套件成 2.9 MB 單檔(不再依賴 `workspace:*` protocol,雲端 npm 看不到)

#### 砍掉的(3 項)
- ✅ Postgres rate-limit middleware + `lib/db` 引用(plan A:私人/教學情境,改靠 maxInstances + Gemini quota + Turnstile 三層)
- ✅ `lib/integrations-openai-ai-server` + `lib/integrations-openai-ai-react`
- ✅ 4 個沒用到的 secrets(DATABASE_URL / RATE_LIMIT_PER_*)

#### SPA 新功能(3 項)
- ✅ **一鍵去背 toggle + 強度 slider**(切割預覽即時 checker 透明背景,24 張 ZIP 下載自動套用;LINE Export Dialog 仍有獨立 tolerance)
- ✅ **「如何上架」LINE Creators Market 連結卡片**(result page 與 export dialog 兩處)
- ✅ Default model 升級後 SPA 自動重 build + 跨兩處部署(`tietu.web.app` + `cagoooo.github.io/TieTu/`)

#### 文件 / Memory(3 項)
- ✅ 整合 USAGE / DEPLOYMENT / OPTIMIZATION 三份文件成單一 README(940 → 1100 行,取代 replit.md)
- ✅ Memory feedback `feedback_github_firebase_backend.md` — 未來規劃 GitHub 後端時主推 Firebase
- ✅ Memory feedback `feedback_windows_git_bash_msys_pathconv.md` — Windows + Git Bash + Vite `BASE_PATH=/` 的 MSYS path conversion 雷防範

**現況**:`https://tietu.web.app/` + `https://cagoooo.github.io/TieTu/` 都活著,生成貼圖完整流程可跑,月成本 **$0**(GCP free tier 內,Gemini quota 有日限但超量也不收費)。

---

### 13.1 — P0 仍待補強(下次有時間立刻做的小動作)

| 項 | 內容 | 為何重要 | 估時 |
|---|---|---|---|
| **P0-A** | **GCP Budget Alert** USD 10/mo + 50%/90%/100% email | 雖然 free tier 內,真有人惡意刷 Gemini image 還是會跳到付費,沒上限保護就裸奔 | 10 min |
| **P0-B** | **Cloudflare Turnstile 真實啟用**(目前 `DISABLED` sentinel) | 沒 captcha 等於把 Gemini API key 額度開放給任何人 | 15 min |
| **P0-C** | **Gemini API quota override**(GCP Console → IAM → Quotas) 設 daily 上限 | 比 Budget Alert 更直接 — 達上限直接 429,不會有「付費跳出 free tier」的灰色地帶 | 15 min |
| **P0-D** | **GitHub Actions 升級 Node 24** + `actions/checkout@v5` 等(Node 20 在 2026-09 強制下線) | CI 不會死但會持續警告 | 20 min |

> 💡 P0-A + P0-B + P0-C 我可以幫你**全自動跑完**(GCP CLI / Cloudflare API 都能搞)。Turnstile 那條需要你先去 Cloudflare 拿 site/secret key(< 3 分鐘)。

---

### 13.2 — P1 體驗與觀測(週級別)

| 項 | 內容 | 為何 | 估時 |
|---|---|---|---|
| **P1-1** | Vite dev server 加 `/api` proxy 到 :8080 | 本機開發者一進門就踩 404 | 15 min |
| **P1-2** | env 集中 zod 驗證(`api-server/src/env.ts`)+ 啟動時 fail-fast | 比現在散落各處 `if (!process.env.X) throw` 更乾淨 | 1 hr |
| **P1-3** | Gemini 失敗訊息**分類成 5 類**(safety_block / quota_exhausted / model_not_found / max_tokens / internal),前端對應不同 toast 文案 | 使用者看「貼圖生成失敗」啥都不知道,分類後可給「請換張照片」「等等再試」「請聯絡管理員」具體指引 | 2 hr |
| **P1-4** | 大檔案上傳改 `multipart/form-data`(目前 base64 進 50 MB JSON,吃 RAM) | 一張 10 MB 圖變 13.3 MB JSON;改 multipart 省 33% + 串流 | 3 hr |
| **P1-5** | 加 `/api/readyz`(檢查 Gemini ListModels)區分 liveness/readiness | UptimeRobot 監控可分「服務活著但 Gemini 掛」與「整體掛」 | 30 min |
| **P1-6** | 生成 loading 加 AbortController + 取消按鈕 | 30–90 秒乾等沒得反悔很折磨 | 1 hr |
| **P1-7** | **Sentry / Logtail 接 5xx error**(目前只能去 GCP Logging 撈) | error 跳出來才會被發現,不用每天主動看 log | 1 hr |
| **P1-8** | **Firebase Hosting Preview Channels** for PR(`firebase hosting:channel:deploy pr-N`) | PR 可在 `https://tietu--pr-N-xxxx.web.app/` 預覽,不污染 production | 1 hr |
| **P1-9** | Bundle code-split:framer-motion / react-day-picker / recharts 拆 chunk | 目前 725 KB → 230 KB gzip,可拆到 < 150 KB initial | 2 hr |
| **P1-10** | **整張 PNG 下載也支援去背**(目前去背只在 24 張 ZIP) | 某些情境(縮圖/分享)使用者想要透明 sheet | 1.5 hr |

---

### 13.3 — P2 規模化(MAU 破百後再考慮)

| 項 | 內容 | 估時 |
|---|---|---|
| **P2-1** | **背景 job 化**(避免 Cloud Run 60 秒 timeout):新增 `sticker_jobs` Firestore collection + 兩段 API(`POST /api/jobs` 建任務 + `GET /api/jobs/:id` polling)+ 前端 SSE/polling | 1–2 day |
| **P2-2** | **生成結果上傳 Firebase Storage** + signed URL,前端拿 URL 而非 base64;Storage 設 7 天 lifecycle 自動刪 | 0.5 day |
| **P2-3** | **重新引入 rate-limit**(用 Firestore atomic counter 而非 Postgres);僅在 MAU 到一定門檻才需 | 0.5 day |
| **P2-4** | **限流分層**:全域 quota + IP + Firebase Auth user(已登入用 user_id,未登入用 IP) | 0.5 day |
| **P2-5** | **Cloud Functions Min Instances=1** 消除 cold start(會持續扣 GB-seconds 但體驗顯著) | 5 min(設定)+ 觀察 1 週成本 |
| **P2-6** | Prometheus / OpenTelemetry metrics export 到 Grafana Cloud free | 0.5 day |
| **P2-7** | **API key rotation 自動化**(90 天 cron + Cloud Scheduler trigger SA 跑 gcloud secrets:set) | 1 day |

---

### 13.4 — P3 能力擴張(產品化)

| 項 | 內容 | 為何 | 估時 |
|---|---|---|---|
| **P3-1** | **Firebase Authentication 帳號系統**(Google + Apple OAuth)+ 把 IndexedDB 歷史改成 Firestore(可換瀏覽器/裝置看歷史) | IndexedDB 換瀏覽器就消失 | 1–2 wk |
| **P3-2** | **Stripe 付費**(`stripe-replit-sync` 已預留;改 Stripe vanilla):Free 5 張/月 / Plus 100/月 / Pro 無限 | 免費版規模化不可持續 | 2 wk |
| **P3-3** | **Prompt 風格選擇器**(pop-mart-3d / clay-figure / pixel-art / anime-2d / watercolor)+ DB-backed 模板 | 同樣 24 張可以有 5 種風格,UGC 增加 5x | 1 day |
| **P3-4** | 多語系(i18n;zh-Hant / zh-Hans / en / ja),預設 24 個 `DEFAULT_TEXTS` 對應每語系一份 | 把 TAM 從台灣擴到 CJK 全區 | 3 day |
| **P3-5** | 即時生成進度(SSE 推「上傳中→AI 思考中→生成中→切片中」),P2-1 完成後做 | 30–90 秒乾等留存率殺手 | 2 day |
| **P3-6** | **OCR 自動重試**:tesseract.js 跑切片後比對 expected vs recognized,差異率 > 30% 自動重生(最多 2 次) | 對抗 Gemini 偶爾把字寫錯的弱點 | 3 day |
| **P3-7** | LINE Bot 介面:LINE Messaging API,使用者直接在 LINE 上傳照片就能拿到貼圖 ZIP | 不用打開瀏覽器,使用門檻 0 | 1 wk |
| **P3-8** | **生成歷史社群展示**(僅同意分享的使用者):像 Lensa / Replicate 的 trending 牆 | 增加曝光 + 風格參考 | 1 wk |
| **P3-9** | **「直接送審 LINE」**(用 LINE Creators API 自動上傳 ZIP) | 目前是手動下載 → 上傳。一鍵送審是大幅降低門檻 | 2 wk(需 LINE 商業帳號) |
| **P3-10** | **多人合照變多角色**(輸入一張多人照,輸出每人一組 24 張) | 單人擴到家庭 / 班級 | 1–2 wk |

---

### 13.5 — P4 工程效能(累積 3 個月後)

| 項 | 內容 | 估時 |
|---|---|---|
| **P4-1** | 補測試(vitest):`verify-turnstile`、`decodePhoto`(magic bytes 各格式)、`buildPrompt`(snapshot)、`splitImageWithGuides`、`buildLineStickerPackage`、`removeMatteFromEdges`(用 canvas-mock) | 1 wk |
| **P4-2** | E2E test(Playwright):upload → mock Gemini fixture → 切片預覽 → 開去背 → 下載 ZIP → 開 ZIP 驗證 24 張透明 PNG | 1 day |
| **P4-3** | 整理 monorepo:刪 `lib/integrations/openai_ai_integrations/` 殭屍 + `mockup-sandbox` 是否要正式定位或移除;加 turbo / nx 跑 cache-aware build | 1 day |
| **P4-4** | 抽 prompt 到設定檔(`lib/sticker-prompts/templates/{style}.txt`)+ 後台改 prompt 不需重 deploy | 0.5 day |
| **P4-5** | **functions/lib npm install cache**(GitHub Actions 每次 deploy 都跑 install,可加 cache 省 10–20 秒) | 30 min |
| **P4-6** | **替換 firebase-tools npx 為 pinned version**(目前用 `npx --yes firebase-tools@15`,每次 download 慢) | 30 min |
| **P4-7** | 文件持續維護(README、TypeDoc、貢獻指南、ADRs) | 持續 |

---

### 13.6 — 短/中/長期建議路線

#### 🎯 下個 session(2 小時內可結束 — 安全加固)
```
20 min:P0-A GCP Budget Alert(我可以全自動跑)
15 min:P0-B Cloudflare Turnstile(你拿 keys + 我自動部署)
15 min:P0-C Gemini API quota override
20 min:P0-D GitHub Actions 升 Node 24
30 min:P1-1 Vite dev proxy + P1-5 /api/readyz
20 min:P1-7 Sentry 接上(SaaS,5 分鐘設定)
```
全做完從 0 → 防呆完整,**Budget + quota + captcha + monitoring 四層保險**。

#### 📅 下個月(週末做 1 個 — 體驗精進)
```
Week 1:P1-3 錯誤分類 + P1-6 取消按鈕 → 體感最直接
Week 2:P1-9 bundle 拆 chunk + P1-10 整張去背
Week 3:P3-3 風格選擇器(5 種風格)→ 內容大幅豐富
Week 4:P3-4 多語系 → 把 TAM 從台灣擴到 CJK
```

#### 🚀 下季(產品化)
```
Month 1:P3-1 Firebase Auth + Firestore 歷史
Month 2:P3-2 Stripe 付費 + 額度管理
Month 3:P3-5 即時進度 + P3-6 OCR 自動重試
```

#### 🌱 長期(平台化)
```
Q3 後:P3-7 LINE Bot
Q4 後:P3-8 社群展示 + P3-9 直送 LINE 審核
Q+:    P3-10 多人合照
```

---

### 13.7 — Top 5「我會親手做」(只有時間做 5 件事)

1. **P0-A + P0-B + P0-C**(預算 / Captcha / Quota 三連)— 沒做等於把信用卡留在桌上
2. **P1-3** 錯誤分類 — 體感最直接,使用者馬上覺得「這 app 有用心」
3. **P3-3** Prompt 風格選擇器 — 1 天工作換 5 倍內容多樣性,CP 值最高
4. **P3-2** Stripe 付費 — 沒收入的免費版規模化不可持續,愈早做愈不痛
5. **P4-1** 測試 — 改 prompt / 升 Gemini 模型版本時不怕(Gemini 棄用速度快,3.1-flash-image-preview 哪天改名你還想跑得動)

---

### 13.8 — 預算與成本上限預估

| 階段 | MAU | 月成本 | 備註 |
|---|---|---|---|
| **目前** | < 100(自用 / 朋友) | **$0** | 全在 free tier;Gemini 偶爾用 paid 可能 < $1 |
| 中規模 | 100–1,000 | $0–10 | Cloud Functions 可能跑超 free invocations;Gemini paid 快速累積 |
| 大規模 | 1,000–10,000 | $20–100 | 需要 P2-1 background jobs + P2-2 storage + P3-2 收費才不虧本 |
| 平台級 | > 10,000 | 看商業模式 | Cloudflare Cache 前置 + multi-region + 自架 GPU 推論可大幅降本 |

監控帳單:GCP Console → Billing → Reports,每月初檢視 + 帳單 alert。

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
| API 回 500 `貼圖生成失敗` | Gemini 端錯(quota / safety block / 模型 deprecated 404) | 看 pino log 內 `Gemini did not return an image` 訊息;若 `model not found` 跑 ListModels 確認 model 還在 |
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
| 部署完誤砍 zhuyin 等其他 app 的 function | 沒用 `:tietu` 限定 codebase | **永遠** `--only functions:tietu`(限定 codebase,不是 function name) |

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
