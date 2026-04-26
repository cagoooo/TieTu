import { Router, type IRouter } from "express";
import {
  GenerateStickerSheetBody,
  GenerateStickerSheetResponse,
} from "@workspace/api-zod";
import {
  generateStickerSheet,
  StickerGenerationError,
} from "@workspace/integrations-gemini-server/image";
import { rewriteTexts } from "@workspace/integrations-gemini-server/text";
import { logger } from "../lib/logger";
import { tryUploadSheetPng } from "../lib/storage";
import { verifyTurnstile } from "../middlewares/verify-turnstile";

// Per-IP rate limiting was removed in deployment plan A: this is a private /
// classroom-shared instance, so the protection layers we rely on are:
//   - Cloud Functions maxInstances: 10 (firebase.json wrapper)
//   - Cloudflare Turnstile (when TURNSTILE_SECRET_KEY is set)
//   - Gemini API daily quota (Google's own throttling; over-limit returns 429
//     to the client and is *not* billed)
//
// If you later open this up to the public, restore the Postgres-backed
// rateLimit middleware from git history (file: middlewares/rate-limit.ts)
// and provision Neon / Firestore for the rate_limit_events table.

const router: IRouter = Router();

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

// Art-style descriptions used by buildPrompt(). Each id matches one entry in
// the SPA's STICKER_STYLES array (artifacts/sticker-studio/src/lib/sticker-utils.ts).
// Keep these in sync — the SPA sends a `style` string from the radio group,
// the server looks it up here and inlines the description into the prompt.
type StyleId = "pop-mart-3d" | "clay" | "pixel" | "anime-2d" | "watercolor";

const STYLE_DESCRIPTIONS: Record<StyleId, { headline: string; details: string }> = {
  "pop-mart-3d": {
    headline: "Pop Mart / Nano Banana Pro 3D vinyl-toy chibi",
    details:
      "oversized adorable head, tiny rounded body, smooth glossy 3D rendering, soft studio lighting, gentle subsurface scattering, polished collectible-figure feel.",
  },
  clay: {
    headline: "handmade plasticine claymation chibi",
    details:
      "pinched-and-squashed clay forms, visible thumbprints and tool marks, matte (non-glossy) surface, slightly imperfect symmetry, warm uneven lighting reminiscent of stop-motion animation.",
  },
  pixel: {
    headline: "16-bit pixel-art chibi",
    details:
      "chunky retro game-sprite shapes, hard pixel edges with NO anti-aliasing, limited 8-color palette per cell, simple dithering for shading, evocative of classic JRPG character portraits — but the WHITE die-cut sticker outline below should still be smooth (not pixelated) so it reads as a sticker frame.",
  },
  "anime-2d": {
    headline: "2D anime / manga line-art chibi",
    details:
      "bold black ink outlines, flat cel-shaded coloring with one shadow tier and one highlight tier, expressive oversized eyes, clean vector-like silhouettes — explicitly NOT 3D, NOT photorealistic.",
  },
  watercolor: {
    headline: "soft watercolor wash chibi illustration",
    details:
      "visible brush strokes, gentle color bleeding at edges, paper-grain texture beneath the paint, pastel palette, hand-painted storybook feel — warm but slightly imperfect.",
  },
};

function isStyleId(value: unknown): value is StyleId {
  return typeof value === "string" && value in STYLE_DESCRIPTIONS;
}

function buildPrompt(
  texts: string[],
  theme: string | null | undefined,
  style: StyleId = "pop-mart-3d",
): string {
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

  const styleSpec = STYLE_DESCRIPTIONS[style];

  return `Create a single portrait image (1024x1536 pixels) that is a 4-column by 6-row grid (24 cells total) of chibi-style stickers based on the person in the reference photo. The art style is ${styleSpec.headline}: ${styleSpec.details}

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
    // `style` is intentionally outside the auto-generated zod schema so we
    // can ship it without re-running orval codegen. Defaults to pop-mart-3d
    // (the original system style) when absent or invalid.
    const styleId: StyleId = isStyleId((req.body as { style?: unknown }).style)
      ? ((req.body as { style: StyleId }).style)
      : "pop-mart-3d";

    let decoded: DecodedImage;
    try {
      decoded = decodePhoto(photoBase64);
    } catch (err) {
      res.status(400).json({
        error: `照片解析失敗：${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    const prompt = buildPrompt(texts, theme ?? null, styleId);

    try {
      const sheetBuffer = await generateStickerSheet({
        photoBuffer: decoded.buffer,
        photoMimeType: decoded.mimeType,
        prompt,
      });

      // Best-effort: upload to GCS in parallel so the SPA can store a URL
      // in IndexedDB history instead of multi-MB base64 strings (P2-2).
      // Falls back silently to base64-only when STORAGE_BUCKET isn't set
      // (local dev) or upload fails for any reason.
      const imageUrl = await tryUploadSheetPng(sheetBuffer);

      const parsedPayload = GenerateStickerSheetResponse.parse({
        imageBase64: sheetBuffer.toString("base64"),
        mimeType: "image/png",
      });
      // Tack imageUrl onto the response. The SPA reads it via a cast in
      // home.tsx (the auto-generated zod schema doesn't yet know about
      // it; deliberately not running orval codegen for one optional field).
      res.json(imageUrl ? { ...parsedPayload, imageUrl } : parsedPayload);
    } catch (err) {
      if (err instanceof StickerGenerationError) {
        logger.warn(
          { code: err.code, cause: err.cause, theme, style: styleId },
          "Sticker generation classified failure",
        );
        res.status(err.httpStatus).json({
          error: err.userMessage,
          code: err.code,
        });
        return;
      }
      logger.error({ err }, "Sticker generation failed (unclassified)");
      const message =
        err instanceof Error ? err.message : "未知錯誤，請稍後再試。";
      res.status(500).json({
        error: `貼圖生成失敗：${message}`,
        code: "internal",
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/stickers/rewrite-texts
// Asks Gemini text model to rewrite all 24 labels so they're cohesively tied
// to a user-supplied theme. Used by the SPA's "依主題改寫" button on the
// upload page. Hand-rolled validation (no zod dep in api-server).
// ---------------------------------------------------------------------------

interface RewriteTextsRequest {
  theme?: unknown;
  originalTexts?: unknown;
}

router.post("/stickers/rewrite-texts", verifyTurnstile(), async (req, res) => {
  const body = (req.body ?? {}) as RewriteTextsRequest;
  const themeRaw = typeof body.theme === "string" ? body.theme.trim() : "";
  if (!themeRaw) {
    res.status(400).json({ error: "請求格式錯誤：主題不可為空。" });
    return;
  }
  if (themeRaw.length > 50) {
    res.status(400).json({ error: "請求格式錯誤：主題請限制在 50 字內。" });
    return;
  }

  const originalRaw = Array.isArray(body.originalTexts) ? body.originalTexts : null;
  if (!originalRaw || originalRaw.length !== 24) {
    res.status(400).json({
      error: "請求格式錯誤：originalTexts 必須剛好 24 個元素。",
    });
    return;
  }
  const originalTexts: string[] = originalRaw.map((v) => (typeof v === "string" ? v : String(v ?? "")));

  try {
    const texts = await rewriteTexts({
      theme: themeRaw,
      originalTexts,
    });
    res.json({ texts });
  } catch (err) {
    logger.error({ err, theme: themeRaw }, "Theme rewrite failed");
    const message =
      err instanceof Error ? err.message : "未知錯誤，請稍後再試。";
    res.status(500).json({ error: `主題改寫失敗：${message}` });
  }
});

export default router;
