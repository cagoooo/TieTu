import JSZip from "jszip";
import { saveAs } from "file-saver";

export const DEFAULT_TEXTS = [
  "收到", "晚安", "天啊", "抱抱", "謝謝", "好的", "好棒棒", "開心YA", 
  "生氣氣", "做得好", "無言", "害羞", "沒問題", "驚訝", "買買買", "改功課中", 
  "出去玩", "哈哈哈", "白眼", "Hi", "麻煩了", "拜託", "辛苦了", "感謝你"
];

export function getThemeTexts(theme: string): string[] {
  if (!theme || theme.trim() === "") return [...DEFAULT_TEXTS];
  // Simple playful addition
  const themeSuffixes = [
    "!", "~", "...", "呀", "啦"
  ];
  return DEFAULT_TEXTS.map((t, i) => {
    // Only modify some of them to keep it interesting
    if (i % 3 === 0) return `${theme}${t}`;
    if (i % 4 === 0) return `${t} (${theme})`;
    return t;
  });
}

export async function splitImage(base64: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const tileWidth = img.width / 4;
      const tileHeight = img.height / 6;
      const tiles: string[] = [];
      
      for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 4; col++) {
          const canvas = document.createElement("canvas");
          canvas.width = tileWidth;
          canvas.height = tileHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          
          ctx.drawImage(
            img,
            col * tileWidth, row * tileHeight, tileWidth, tileHeight,
            0, 0, tileWidth, tileHeight
          );
          
          tiles.push(canvas.toDataURL("image/png"));
        }
      }
      resolve(tiles);
    };
    img.onerror = reject;
    img.src = `data:image/png;base64,${base64}`;
  });
}

export async function downloadZip(tilesBase64: string[], texts: string[]) {
  const zip = new JSZip();
  
  tilesBase64.forEach((dataUrl, index) => {
    const base64Data = dataUrl.split(',')[1];
    const num = (index + 1).toString().padStart(2, '0');
    // Sanitize label for filename
    const label = (texts[index] || "貼圖").replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "");
    zip.file(`sticker-${num}-${label}.png`, base64Data, { base64: true });
  });
  
  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, "stickers.zip");
}

export function downloadSheet(base64: string) {
  const link = document.createElement("a");
  link.href = `data:image/png;base64,${base64}`;
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
