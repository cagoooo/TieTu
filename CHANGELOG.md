# 更新日誌 (Changelog)

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
