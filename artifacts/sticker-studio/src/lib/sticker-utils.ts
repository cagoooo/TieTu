import JSZip from "jszip";
import { saveAs } from "file-saver";

export const DEFAULT_TEXTS = [
  "收到", "晚安", "天啊", "抱抱", "謝謝", "好的", "好棒棒", "開心YA",
  "生氣氣", "做得好", "無言", "害羞", "沒問題", "驚訝", "買買買", "改功課中",
  "出去玩", "哈哈哈", "白眼", "Hi", "麻煩了", "拜託", "辛苦了", "感謝你"
];

export function getThemeTexts(theme: string): string[] {
  if (!theme || theme.trim() === "") return [...DEFAULT_TEXTS];
  return DEFAULT_TEXTS.map((t, i) => {
    if (i % 3 === 0) return `${theme}${t}`;
    if (i % 4 === 0) return `${t} (${theme})`;
    return t;
  });
}

export interface Guides {
  xCuts: number[];
  yCuts: number[];
}

export const DEFAULT_COLS = 4;
export const DEFAULT_ROWS = 6;
export const MIN_COLS = 1;
export const MAX_COLS = 8;
export const MIN_ROWS = 1;
export const MAX_ROWS = 10;

export function getDefaultGuides(cols: number = DEFAULT_COLS, rows: number = DEFAULT_ROWS): Guides {
  const xCuts: number[] = [];
  for (let i = 0; i <= cols; i++) xCuts.push(i / cols);
  const yCuts: number[] = [];
  for (let i = 0; i <= rows; i++) yCuts.push(i / rows);
  return { xCuts, yCuts };
}

export function getGuideDimensions(guides: Guides): { cols: number; rows: number } {
  return {
    cols: Math.max(0, guides.xCuts.length - 1),
    rows: Math.max(0, guides.yCuts.length - 1),
  };
}

export function toImageDataUrl(base64: string, mimeType = "image/png"): string {
  return base64.startsWith("data:") ? base64 : `data:${mimeType};base64,${base64}`;
}

export function loadImage(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = toImageDataUrl(base64);
  });
}

export async function splitImageWithGuides(
  base64: string,
  guides: Guides,
  imgEl?: HTMLImageElement,
): Promise<string[]> {
  const img = imgEl ?? (await loadImage(base64));
  const tiles: string[] = [];
  const { cols, rows } = getGuideDimensions(guides);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const sx = guides.xCuts[col] * img.width;
      const sy = guides.yCuts[row] * img.height;
      const sw = (guides.xCuts[col + 1] - guides.xCuts[col]) * img.width;
      const sh = (guides.yCuts[row + 1] - guides.yCuts[row]) * img.height;

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sw));
      canvas.height = Math.max(1, Math.round(sh));
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      tiles.push(canvas.toDataURL("image/png"));
    }
  }
  return tiles;
}

export async function splitImage(base64: string): Promise<string[]> {
  return splitImageWithGuides(base64, getDefaultGuides());
}

export async function downloadZip(tilesBase64: string[], texts: string[]) {
  const zip = new JSZip();

  tilesBase64.forEach((dataUrl, index) => {
    const base64Data = dataUrl.split(",")[1];
    const num = (index + 1).toString().padStart(2, "0");
    const label = (texts[index] || "貼圖").replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "");
    zip.file(`sticker-${num}-${label}.png`, base64Data, { base64: true });
  });

  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, "stickers.zip");
}

export function downloadSheet(base64: string) {
  const link = document.createElement("a");
  link.href = toImageDataUrl(base64);
  link.download = "sticker-sheet.png";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
}
