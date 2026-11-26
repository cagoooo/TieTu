# 更新日誌 (Changelog)

## [0.3.1] - 2026-11-26

### 修改 (Changed)
- 按「下載 SKILL.md」後，同一次點擊會自動開新分頁到 Gemini 技能頁（`gemini.google.com/customize/skills`，沒登入會先登入再回來），並跳出提示「按上方『上傳』選剛下載的 SKILL.md」；步驟 ② 的連結也直接指向技能頁。

## [0.3.0] - 2026-11-26

### 新增 (Added)
- **用自己的 Gemini 免費畫貼圖**：首頁新增卡片，可下載技能檔 `SKILL.md`（`public/skills/line-sticker-24-grid/`，內容就是貼圖機的完整生圖提示詞、5 種畫風、預設 24 句），上傳到 Gemini 網頁版「技能」後，跟 Gemini 說「幫我做 LINE 貼圖」即可用自己的帳號畫。
- **上傳 Gemini 畫好的貼圖表**：直接進結果頁，在瀏覽器裡切 24 張，可一鍵去背、打包 LINE 格式；不用登入、不扣次數、不呼叫 AI。

## [0.2.2] - 2026-11-26

### 修改 (Changed)
- **測試期間暫停 AI 生圖**：Gemini 生圖模型沒有免費額度，管理員決定先不儲值。後端總開關 `GENERATION_PAUSED`（`artifacts/api-server/src/lib/generation-pause.ts`）打開時，生成、依主題改寫、文字辨識一律直接回 `generation_paused`，不扣次數、不呼叫 Gemini、不發失敗通知。
- 前端讀新的公開 API `GET /api/stickers/status`：頁面上方顯示「⏸️ 測試期間 AI 生圖暫停中」，生成按鈕與「依主題改寫」按鈕停用。
- 恢復方式：把 `GENERATION_PAUSED` 改成 `false` 後 push，CI 重新部署即可。

## [0.2.1] - 2026-11-26

### 修正 (Fixed)
- **Gemini 回 402（需要付款）不再被誤報成「今日免費額度用完、隔天重置」**：新增 `billing_required` 分類。使用者看到「AI 生圖服務暫停中」，Google Chat／LINE 管理員通知改寫「預付儲值用完或帳單有問題，等到隔天不會自動恢復，請到 Google AI Studio 帳單頁檢查」。失敗一樣自動退回次數。
- 後端記錄多存 Gemini 原始錯誤文字前 300 字（`causeMessage`），之後查帳單或額度問題不用再猜。

## [0.2.0] - 2026-11-25

### 修改 (Changed)
- **生成貼圖改成必須用 Google 帳號登入**：沒登入、匿名登入或憑證過期，後端一律回 401，前端按鈕改成「先用 Google 登入再轉一下」，不會送出任何請求。依主題改寫、文字辨識同樣要登入。
- **每個帳號每天可以生成 3 次**（台北時間午夜重置）：後端用 Firestore transaction 計數（`tietu_rateLimits` 集合），通過人機驗證後才扣次；AI 生成失敗會自動退回次數。依主題改寫與文字辨識另設每帳號每天 20 次保險絲，不算在 3 次裡。
- 生成按鈕下方固定顯示「今天還可以生成 N / 3 次」，用完變紅字提示明天再來；新增只查不扣的 `GET /api/stickers/quota`。

### 新增 (Added)
- **每次生成都推 Google Chat 通知**：成功、失敗（已退回次數）、今日次數用完被擋（同一帳號 5 分鐘最多一則），卡片含使用者、風格、耗時與今日剩餘次數，不含照片與文字內容。Webhook 只放在 Secret Manager（`TIETU_GOOGLE_CHAT_WEBHOOK_URL`）。

## [0.1.4] - 2026-11-18

### 修正 (Fixed)
- 在 App 內建瀏覽器按 Google 登入：跳出「改用預設瀏覽器開啟」提醒後，不再多跳一個紅色「登入失敗／登入已取消」通知。

## [0.1.3] - 2026-11-18

### 修正 (Fixed)
- 在 LINE／臉書等 App 內建瀏覽器按 Google 登入前，先提醒改用預設瀏覽器開啟，不再直接撞 Google 403。

## [0.1.2] - 2026-11-18

### 新增 (Added)
- App 內建瀏覽器防護：LINE 自動改用外部瀏覽器、Android 臉書／IG 自動叫出 Chrome、iPhone 顯示引導（避免 Google 登入 403）。

## [0.1.1] - 2026-04-27

### 新增 (Added)
- **應用圖示 (Favicon)**：新增專屬的 3D Q版貼圖生成器 favicon 圖示，強化品牌視覺。
- **社群分享預覽圖 (Open Graph / Twitter Card)**：新增供 LINE、Facebook 以及 Twitter 分享專用的預覽圖片 (`opengraph.png`)，幫助社群擴散。

### 修改 (Changed)
- **環境設定與相容性**：
  - 更新 `artifacts/sticker-studio/index.html` 中的 favicon 以及 OG tags 引用路徑。
  - 將 OG tags 與 Twitter Card Image 路徑轉換為 GitHub Pages 的絕對路徑 (`https://cagoooo.github.io/TieTu/opengraph.png`) 以滿足爬蟲抓取需求。
  - 修改 `artifacts/sticker-studio/vite.config.ts` 的 base URL 預設為相對路徑 `'./'`，確保 GitHub Pages 子目錄環境下的資源能正確加載。
- **安全性 (Security)**：
  - 清理了 `firebase.ts` 中殘留的 API Key 等敏感資訊，全面引入了佔位符 (`__FIREBASE_API_KEY__` 等) 以及 GitHub Secrets / 本地環境變數替換機制。
