// gacha/tokens.ts — 盲盒扭蛋改版的設計常數（A 盲盒包裝盒 × C 扭蛋機）。
//
// 顏色同時定義在 src/index.css 的 @theme（給 Tailwind 產生 bg-coral / border-ink
// 等 utility class）。這裡的常數供「需要程式化索引」或「inline gradient / canvas」
// 的場合使用（例如膠囊依 index 取色、扭蛋機翻滾膠囊、進度條條紋漸層）。
// 來源：design_handoff_gacha_redesign/prototype/ss-tokens.jsx

export const GACHA = {
  ink: "#221B1C",
  coral: "#FF5A4D",
  cream: "#FFF6EC",
  paper: "#FFFDF8",
  pink: "#FF7EB6",
  mint: "#5FCFBE",
  lemon: "#FFC94D",
  lilac: "#B59CFF",
  sky: "#7FC8FF",
  green: "#7CC36B",
} as const;

/** 五彩膠囊主色，依 index % 5 取用（編號標、膠囊、裝飾）。 */
export const CAP_COLORS = [
  GACHA.pink,
  GACHA.mint,
  GACHA.lemon,
  GACHA.lilac,
  GACHA.sky,
] as const;

/** 膠囊柔色（格子底 / 軟背景），與 CAP_COLORS 一一對應。 */
export const CAP_SOFT = [
  "#FFE3EF",
  "#DDF4EF",
  "#FFF0CE",
  "#ECE5FF",
  "#E1F1FF",
] as const;

/** 對應 index.css 的 .bg-cap-* / .border-cap-* Tailwind class（穩定的 token 名）。 */
export const CAP_CLASS = [
  "cap-pink",
  "cap-mint",
  "cap-lemon",
  "cap-lilac",
  "cap-sky",
] as const;

export const capColor = (i: number): string => CAP_COLORS[((i % 5) + 5) % 5];
export const capSoft = (i: number): string => CAP_SOFT[((i % 5) + 5) % 5];
export const capClass = (i: number): string => CAP_CLASS[((i % 5) + 5) % 5];

/** 主色備選（Tweaks / 主題切換用，正式版預設用 coral）。 */
export const ACCENTS = ["#FF5A4D", "#FF7EB6", "#5FCFBE", "#7A5AE0", "#3B49FF"] as const;
