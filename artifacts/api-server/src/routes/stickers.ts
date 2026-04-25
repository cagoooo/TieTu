import { Router, type IRouter } from "express";
import {
  GenerateStickerSheetBody,
  GenerateStickerSheetResponse,
} from "@workspace/api-zod";
import { editImagesFromBuffers } from "@workspace/integrations-openai-ai-server/image";
import { logger } from "../lib/logger";
import { rateLimit } from "../middlewares/rate-limit";
import { verifyTurnstile } from "../middlewares/verify-turnstile";

const router: IRouter = Router();

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn(
      { env: name, value: raw },
      `Invalid ${name}, falling back to ${fallback}`,
    );
    return fallback;
  }
  return parsed;
}

const STICKER_RATE_LIMIT_PER_MINUTE = readPositiveInt(
  "STICKER_RATE_LIMIT_PER_MINUTE",
  3,
);
const STICKER_RATE_LIMIT_PER_DAY = readPositiveInt(
  "STICKER_RATE_LIMIT_PER_DAY",
  30,
);

const stickerRateLimiter = rateLimit({
  bucket: "sticker:generate",
  perMinute: STICKER_RATE_LIMIT_PER_MINUTE,
  perDay: STICKER_RATE_LIMIT_PER_DAY,
});

interface DecodedImage {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

function detectMimeFromMagicBytes(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  // WEBP: "RIFF"...."WEBP"
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  // HEIC/HEIF: "ftyp" at offset 4 with brand heic/heix/hevc/mif1
  if (buffer.toString("ascii", 4, 8) === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12).toLowerCase();
    if (
      brand.startsWith("heic") ||
      brand.startsWith("heix") ||
      brand.startsWith("hevc") ||
      brand.startsWith("mif1") ||
      brand.startsWith("heim") ||
      brand.startsWith("heis")
    ) {
      return "image/heic";
    }
  }
  return null;
}

function decodePhoto(input: string): DecodedImage {
  const trimmed = input.trim();
  const dataUrlMatch = trimmed.match(
    /^data:(image\/(png|jpeg|jpg|webp|heic|heif));base64,(.+)$/i,
  );

  let base64 = trimmed;
  if (dataUrlMatch) {
    base64 = dataUrlMatch[3];
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64.replace(/\s+/g, ""))) {
    throw new Error("照片內容不是有效的 Base64 字串。");
  }

  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) {
    throw new Error("照片內容為空。");
  }

  const sniffedMime = detectMimeFromMagicBytes(buffer);
  if (!sniffedMime) {
    throw new Error(
      "無法辨識的影像格式，請改用 JPG、PNG、WEBP 或 HEIC 圖片。",
    );
  }

  const ext = sniffedMime.split("/")[1] ?? "png";
  return { buffer, mimeType: sniffedMime, filename: `user-photo.${ext}` };
}

function buildPrompt(texts: string[], theme: string | null | undefined): string {
  const themeLine = theme && theme.trim().length > 0
    ? `Overall styling theme keyword (apply to costumes, props, accessories, and background accents while keeping each sticker still about the same person): ${theme.trim()}.`
    : "No specific theme — keep outfits simple and cute.";

  const labelLines = texts
    .map((label, idx) => {
      const row = Math.floor(idx / 4) + 1;
      const col = (idx % 4) + 1;
      return `  - Row ${row}, Col ${col}: "${label}"`;
    })
    .join("\n");

  return `Create a single portrait image (1024x1536 pixels) that is a 4-column by 6-row grid (24 cells total) of chibi-style 3D collectible-figure stickers based on the person in the reference photo. The art style is Pop Mart / Nano Banana Pro 3D vinyl-toy chibi: oversized adorable head, tiny rounded body, smooth glossy 3D rendering, soft studio lighting.

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

${themeLine}

The 24 cell labels in row-major order (left to right, top to bottom) are:
${labelLines}

Each label MUST be rendered EXACTLY as given (Traditional Chinese characters). Do not translate, romanize, abbreviate, or substitute the text. Do not add extra text, logos, watermarks, signatures, page numbers, or borders. The output must be a single flat image of the full sheet only.`;
}

router.post(
  "/stickers/generate",
  verifyTurnstile(),
  stickerRateLimiter,
  async (req, res) => {
    const parsed = GenerateStickerSheetBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: `請求格式錯誤：${parsed.error.issues
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .join("; ")}`,
      });
      return;
    }

    const { photoBase64, theme, texts } = parsed.data;

    let decoded: DecodedImage;
    try {
      decoded = decodePhoto(photoBase64);
    } catch (err) {
      res.status(400).json({
        error: `照片解析失敗：${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    const prompt = buildPrompt(texts, theme ?? null);

    try {
      const sheetBuffer = await editImagesFromBuffers(
        [
          {
            buffer: decoded.buffer,
            filename: decoded.filename,
            mimeType: decoded.mimeType,
          },
        ],
        prompt,
        "1024x1536",
      );

      const payload = GenerateStickerSheetResponse.parse({
        imageBase64: sheetBuffer.toString("base64"),
        mimeType: "image/png",
      });
      res.json(payload);
    } catch (err) {
      logger.error({ err }, "Sticker generation failed");
      const message =
        err instanceof Error ? err.message : "未知錯誤，請稍後再試。";
      res.status(500).json({ error: `貼圖生成失敗：${message}` });
    }
  },
);

export default router;
