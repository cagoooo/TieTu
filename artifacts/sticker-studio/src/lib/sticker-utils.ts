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

export interface TileAdjustment {
  rotation: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

export const DEFAULT_TILE_ADJUSTMENT: TileAdjustment = {
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  scale: 1,
};

export const TILE_ROTATION_MAX = 15;
export const TILE_OFFSET_MAX = 0.15;
export const TILE_SCALE_MIN = 0.8;
export const TILE_SCALE_MAX = 1.2;
const TILE_SOURCE_PAD = 0.3;

export type TileAdjustments = Record<number, TileAdjustment>;

export function isTileAdjustmentDefault(adj: TileAdjustment | undefined | null): boolean {
  if (!adj) return true;
  return (
    adj.rotation === 0 &&
    adj.offsetX === 0 &&
    adj.offsetY === 0 &&
    adj.scale === 1
  );
}

export function clampTileAdjustment(adj: TileAdjustment): TileAdjustment {
  return {
    rotation: Math.max(-TILE_ROTATION_MAX, Math.min(TILE_ROTATION_MAX, adj.rotation)),
    offsetX: Math.max(-TILE_OFFSET_MAX, Math.min(TILE_OFFSET_MAX, adj.offsetX)),
    offsetY: Math.max(-TILE_OFFSET_MAX, Math.min(TILE_OFFSET_MAX, adj.offsetY)),
    scale: Math.max(TILE_SCALE_MIN, Math.min(TILE_SCALE_MAX, adj.scale)),
  };
}

export function drawAdjustedTile(
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  outW: number,
  outH: number,
  adj?: TileAdjustment,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(outW));
  canvas.height = Math.max(1, Math.round(outH));
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const a = adj ?? DEFAULT_TILE_ADJUSTMENT;
  const cw = canvas.width;
  const ch = canvas.height;

  if (sw <= 0 || sh <= 0) return canvas;

  const padX = sw * TILE_SOURCE_PAD;
  const padY = sh * TILE_SOURCE_PAD;
  const srcX = Math.max(0, sx - padX);
  const srcY = Math.max(0, sy - padY);
  const srcRight = Math.min(img.width, sx + sw + padX);
  const srcBottom = Math.min(img.height, sy + sh + padY);
  const srcW = srcRight - srcX;
  const srcH = srcBottom - srcY;
  if (srcW <= 0 || srcH <= 0) return canvas;

  const drawW = (srcW / sw) * cw;
  const drawH = (srcH / sh) * ch;
  const drawX = -cw / 2 - ((sx - srcX) / sw) * cw;
  const drawY = -ch / 2 - ((sy - srcY) / sh) * ch;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(cw / 2 + a.offsetX * cw, ch / 2 + a.offsetY * ch);
  ctx.rotate((a.rotation * Math.PI) / 180);
  ctx.scale(a.scale, a.scale);
  ctx.drawImage(img, srcX, srcY, srcW, srcH, drawX, drawY, drawW, drawH);
  return canvas;
}

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
  adjustments?: TileAdjustments,
): Promise<string[]> {
  const img = imgEl ?? (await loadImage(base64));
  const tiles: string[] = [];
  const { cols, rows } = getGuideDimensions(guides);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      const sx = guides.xCuts[col] * img.width;
      const sy = guides.yCuts[row] * img.height;
      const sw = (guides.xCuts[col + 1] - guides.xCuts[col]) * img.width;
      const sh = (guides.yCuts[row + 1] - guides.yCuts[row]) * img.height;

      const canvas = drawAdjustedTile(img, sx, sy, sw, sh, sw, sh, adjustments?.[idx]);
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

export const LINE_STICKER_COUNT = 24;
export const LINE_TILE_W = 370;
export const LINE_TILE_H = 320;
export const LINE_MAIN_SIZE = 240;
export const LINE_TAB_W = 96;
export const LINE_TAB_H = 74;

const MATTE_COLOR: [number, number, number] = [0x7f, 0x7f, 0x7f];
const MATTE_TOLERANCE = 28;

function removeMatteFromEdges(
  canvas: HTMLCanvasElement,
  target: [number, number, number] = MATTE_COLOR,
  tolerance: number = MATTE_TOLERANCE,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  if (width === 0 || height === 0) return;

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];

  const matches = (idx: number) => {
    const offset = idx * 4;
    if (data[offset + 3] === 0) return true;
    const dr = data[offset] - target[0];
    const dg = data[offset + 1] - target[1];
    const db = data[offset + 2] - target[2];
    return (
      Math.abs(dr) <= tolerance &&
      Math.abs(dg) <= tolerance &&
      Math.abs(db) <= tolerance
    );
  };

  for (let x = 0; x < width; x++) {
    stack.push(x);
    stack.push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    stack.push(y * width);
    stack.push(y * width + width - 1);
  }

  while (stack.length > 0) {
    const idx = stack.pop()!;
    if (visited[idx]) continue;
    if (!matches(idx)) continue;
    visited[idx] = 1;
    data[idx * 4 + 3] = 0;

    const x = idx % width;
    const y = (idx / width) | 0;
    if (x > 0) stack.push(idx - 1);
    if (x < width - 1) stack.push(idx + 1);
    if (y > 0) stack.push(idx - width);
    if (y < height - 1) stack.push(idx + width);
  }

  ctx.putImageData(imageData, 0, 0);
}

function getOpaqueBounds(canvas: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { width, height } = canvas;
  if (width === 0 || height === 0) return null;
  const data = ctx.getImageData(0, 0, width, height).data;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function fitOnTransparentCanvas(
  src: HTMLCanvasElement,
  targetW: number,
  targetH: number,
  bounds?: { x: number; y: number; w: number; h: number } | null,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const region = bounds ?? { x: 0, y: 0, w: src.width, h: src.height };
  if (region.w === 0 || region.h === 0) return canvas;

  const scale = Math.min(targetW / region.w, targetH / region.h);
  const drawW = Math.max(1, Math.round(region.w * scale));
  const drawH = Math.max(1, Math.round(region.h * scale));
  const dx = Math.round((targetW - drawW) / 2);
  const dy = Math.round((targetH - drawH) / 2);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, region.x, region.y, region.w, region.h, dx, dy, drawW, drawH);
  return canvas;
}

interface LineExportTile {
  pngBase64: string;
}

export interface LineExportPackage {
  tiles: LineExportTile[];
  mainPngBase64: string;
  tabPngBase64: string;
}

export async function buildLineStickerPackage(
  base64: string,
  guides: Guides,
  imgEl?: HTMLImageElement,
  adjustments?: TileAdjustments,
): Promise<LineExportPackage> {
  const img = imgEl ?? (await loadImage(base64));
  const { cols, rows } = getGuideDimensions(guides);
  const total = cols * rows;
  if (total !== LINE_STICKER_COUNT) {
    throw new Error(
      `LINE 個人原創貼圖需要剛好 ${LINE_STICKER_COUNT} 張，目前為 ${total} 張。請調整切割數量。`,
    );
  }

  const tiles: LineExportTile[] = [];
  let mainSourceCanvas: HTMLCanvasElement | null = null;
  let mainBounds: { x: number; y: number; w: number; h: number } | null = null;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      const sx = guides.xCuts[col] * img.width;
      const sy = guides.yCuts[row] * img.height;
      const sw = (guides.xCuts[col + 1] - guides.xCuts[col]) * img.width;
      const sh = (guides.yCuts[row + 1] - guides.yCuts[row]) * img.height;

      const tileCanvas = drawAdjustedTile(img, sx, sy, sw, sh, sw, sh, adjustments?.[idx]);
      if (tileCanvas.width === 0 || tileCanvas.height === 0) continue;

      removeMatteFromEdges(tileCanvas);
      const bounds = getOpaqueBounds(tileCanvas);
      const fitted = fitOnTransparentCanvas(tileCanvas, LINE_TILE_W, LINE_TILE_H, bounds);
      const dataUrl = fitted.toDataURL("image/png");
      tiles.push({ pngBase64: dataUrl.split(",")[1] });

      if (!mainSourceCanvas) {
        mainSourceCanvas = tileCanvas;
        mainBounds = bounds;
      }
    }
  }

  if (!mainSourceCanvas) {
    throw new Error("無法產生主圖：找不到任何貼圖內容。");
  }

  const mainCanvas = fitOnTransparentCanvas(
    mainSourceCanvas,
    LINE_MAIN_SIZE,
    LINE_MAIN_SIZE,
    mainBounds,
  );
  const tabCanvas = fitOnTransparentCanvas(
    mainSourceCanvas,
    LINE_TAB_W,
    LINE_TAB_H,
    mainBounds,
  );

  return {
    tiles,
    mainPngBase64: mainCanvas.toDataURL("image/png").split(",")[1],
    tabPngBase64: tabCanvas.toDataURL("image/png").split(",")[1],
  };
}

export async function downloadLineStickerZip(pkg: LineExportPackage) {
  const zip = new JSZip();
  pkg.tiles.forEach((tile, index) => {
    const num = (index + 1).toString().padStart(2, "0");
    zip.file(`${num}.png`, tile.pngBase64, { base64: true });
  });
  zip.file("main.png", pkg.mainPngBase64, { base64: true });
  zip.file("tab.png", pkg.tabPngBase64, { base64: true });
  zip.file(
    "README.txt",
    [
      "LINE 個人原創貼圖上架素材包",
      "",
      `貼圖：01.png ~ ${LINE_STICKER_COUNT.toString().padStart(2, "0")}.png（${LINE_TILE_W} x ${LINE_TILE_H} 透明 PNG）`,
      `主圖：main.png（${LINE_MAIN_SIZE} x ${LINE_MAIN_SIZE} 透明 PNG）`,
      `聊天室分頁圖：tab.png（${LINE_TAB_W} x ${LINE_TAB_H} 透明 PNG）`,
      "",
      "請至 LINE Creators Market 上傳：https://creator.line.me/",
    ].join("\n"),
  );

  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, "line-stickers.zip");
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
