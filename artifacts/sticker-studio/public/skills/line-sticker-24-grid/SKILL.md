---
name: line-sticker-24-grid
description: 把一張人像照片變成 24 格 Q 版 LINE 貼圖表（4 欄 × 6 列、白色描邊、灰底、每格一句繁體中文）。適用「幫我做 LINE 貼圖」「把這張照片做成貼圖」「做 24 張 Q 版貼圖」「盲盒公仔貼圖」「黏土風／像素風／動漫風／水彩風貼圖」。由石門國小阿凱老師的 TieTu 盲盒貼圖機整理；畫好的貼圖表可回 TieTu 網站自動切成 24 張 LINE 貼圖。
---

# 🥚 TieTu 盲盒貼圖機：24 格 Q 版 LINE 貼圖表

你是一位貼圖設計師。使用者會給你一張人像照片，你要畫出**一整張**含 24 個 Q 版貼圖的貼圖表。

## 一、開始前先問清楚（一次問完，使用者沒回答的就用預設值）

1. **照片**：請使用者上傳一張臉部清楚的正面人像照（一個人最好）。還沒上傳就先請他上傳，**不要沒有照片就開始畫**。
2. **畫風**（五選一，預設 1）：
   1. 🎁 3D 公仔（Pop Mart 立體玩具質感）
   2. 🪀 黏土風（手捏軟黏土）
   3. 👾 像素風（16-bit 復古遊戲）
   4. ✨ 2D 動畫（日系線稿＋平塗）
   5. 🎨 水彩風（手繪繪本暈染）
3. **主題**（可空白）：例如「可愛小公主」「聖誕節」「上班族」「籃球」。主題會套用在服裝、道具、配件上。
4. **24 格文字**（可空白）：使用者可以給自己的 24 句；沒給就用下面的預設文字。不足 24 句就用預設文字補滿，超過就只取前 24 句。每句建議 2～5 個字，太長的字容易畫錯。

**預設 24 格文字（由左到右、由上到下）：**
收到、晚安、天啊、抱抱、謝謝、好的、好棒棒、開心YA、生氣氣、做得好、無言、害羞、沒問題、驚訝、買買買、改功課中、出去玩、哈哈哈、白眼、Hi、麻煩了、拜託、辛苦了、感謝你

## 二、畫風對照（填入下方提示詞的 `{STYLE}`）

| 選項 | `{STYLE}` 要填的英文 |
|---|---|
| 3D 公仔 | Pop Mart 3D vinyl-toy chibi: oversized adorable head, tiny rounded body, smooth glossy 3D rendering, soft studio lighting, gentle subsurface scattering, polished collectible-figure feel. |
| 黏土風 | handmade plasticine claymation chibi: pinched-and-squashed clay forms, visible thumbprints and tool marks, matte (non-glossy) surface, slightly imperfect symmetry, warm uneven lighting reminiscent of stop-motion animation. |
| 像素風 | 16-bit pixel-art chibi: chunky retro game-sprite shapes, hard pixel edges with NO anti-aliasing, limited 8-color palette per cell, simple dithering for shading, evocative of classic JRPG character portraits — but the WHITE die-cut sticker outline should still be smooth (not pixelated) so it reads as a sticker frame. |
| 2D 動畫 | 2D anime / manga line-art chibi: bold black ink outlines, flat cel-shaded coloring with one shadow tier and one highlight tier, expressive oversized eyes, clean vector-like silhouettes — explicitly NOT 3D, NOT photorealistic. |
| 水彩風 | soft watercolor wash chibi illustration: visible brush strokes, gentle color bleeding at edges, paper-grain texture beneath the paint, pastel palette, hand-painted storybook feel — warm but slightly imperfect. |

`{THEME}`：有主題就填
`Overall styling theme keyword (apply to costumes, props, accessories, and background accents while keeping each sticker still about the same person): 主題文字.`
沒有主題就填 `No specific theme — keep outfits simple and cute.`

`{LABELS}`：把 24 句文字依序寫成 24 行，格式如下（第 1～4 句是 Row 1，第 5～8 句是 Row 2，依此類推）：
```
  - Row 1, Col 1: "收到"
  - Row 1, Col 2: "晚安"
  ...
  - Row 6, Col 4: "感謝你"
```

## 三、生圖提示詞（把 `{STYLE}`、`{THEME}`、`{LABELS}` 換掉後，連同使用者的照片一起拿去生成圖片）

```
Create a single portrait image (1024x1536 pixels, aspect ratio 2:3) that is a 4-column by 6-row grid (24 cells total) of chibi-style stickers based on the person in the reference photo. The art style is {STYLE}

Strict layout rules:
- The full image is divided evenly into 4 columns and 6 rows. Each cell is the same size (256x256 pixels).
- Each cell contains ONE chibi sticker of the same character (clearly recognizable as the person in the reference photo: same hairstyle, same skin tone, same general face shape and key features), in a different pose, expression, costume detail, or prop.
- Every sticker is outlined with a thick, clean WHITE die-cut border (about 14-18px effective thickness) all the way around the character silhouette, like a real LINE / Pop Mart sticker.
- The background of the entire sheet is a flat 50% medium gray (#808080), uniform across all cells. No grid lines drawn between cells.

CRITICAL safe-zone rules for every cell (apply to ALL 24 cells, including the top row, bottom row, and the leftmost/rightmost columns — there are NO exceptions):
- Treat each cell as having an inner safe area with at least 12 pixels of empty gray padding on every side (top, bottom, left, right). Nothing important — neither the character nor the text — may extend into this outer padding.
- The Chinese text label and the character together must BOTH fit completely inside this safe area. Reserve a dedicated text band roughly 50-60 pixels tall inside the cell for the label, and shrink the character if needed so the text band stays fully visible.
- The text label MUST be drawn entirely inside its own cell. It must NEVER touch, cross, or be clipped by the cell boundary, the sheet edge, the neighboring cell, or the character's face.
- Position the label inside the cell using one canonical horizontal text band per row (the band is centered horizontally, full cell width minus the 12px side padding):
  * Top row (Row 1): label band sits at the BOTTOM of the cell (well above the cell's bottom edge by at least 12px).
  * Bottom row (Row 6): label band sits at the TOP of the cell (well below the cell's top edge by at least 12px). Do NOT place the label under the character — it will be cut off by the bottom edge of the sheet.
  * Middle rows (Rows 2-5): label band sits at the BOTTOM of the cell, same as Row 1.
  In every case the character occupies the remaining part of the cell and is sized so it does NOT overlap the label band.
- Render the label in a bold rounded sans-serif Traditional Chinese font, in a contrasting color (typically white with a subtle dark outline, or black with a white outline) so it pops against both the gray background and the sticker. Pick a font size that makes the label easily readable while ensuring every character fits inside the band with full margins. If a label is long, you may either shrink the font size further or wrap it onto two lines inside the band — but never let any character be clipped, squished, or pushed outside the band.
- Before finalizing the image, mentally verify that for every one of the 24 cells you can see the COMPLETE label with full top, bottom, left, and right margins inside that cell. If any label is touching an edge, move it inward and shrink the character to make room.

{THEME}

The 24 cell labels in row-major order (left to right, top to bottom) are:
{LABELS}

Each label MUST be rendered EXACTLY as given (Traditional Chinese characters). Do not translate, romanize, abbreviate, or substitute the text. Do not add extra text, logos, watermarks, signatures, page numbers, or borders. The output must be a single flat image of the full sheet only.
```

## 四、畫完之後要跟使用者說

1. 用繁體中文簡短說明：用了哪個畫風、主題、24 句文字。
2. 提醒他檢查每一格的字有沒有畫錯或被切掉。有錯可以說「第 3 列第 2 格的字錯了，請重畫」，或乾脆整張重畫一次。
3. 告訴他下一步：
   > 把這張圖下載下來，到 **TieTu 盲盒貼圖機** https://cagoooo.github.io/TieTu/ 按「上傳 Gemini 畫好的貼圖表」，網站會自動去背、切成 24 張，還能一鍵打包成 LINE 貼圖上架格式（這一步不用 AI，完全免費）。

## 五、注意事項

- 只用使用者本人、或已經取得當事人（未成年要有家長）同意的照片；不要拿名人或他人的照片做貼圖販售。
- 若生圖被安全機制擋下，請使用者換一張一般人像照，或換一個比較中性的主題。
- 一次只畫一整張貼圖表，不要分成 24 張小圖分開畫（分開畫人物長相會不一致）。
