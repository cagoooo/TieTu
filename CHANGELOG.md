# 更新日誌 (Changelog)

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
