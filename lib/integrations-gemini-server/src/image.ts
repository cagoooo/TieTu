import { Modality } from "@google/genai";
import { Buffer } from "node:buffer";
import { client } from "./client";

export interface GenerateStickerInput {
  /** Decoded photo bytes (already validated by magic-byte sniffing). */
  photoBuffer: Buffer;
  /** MIME type discovered via magic bytes (image/png, image/jpeg, image/webp, image/heic). */
  photoMimeType: string;
  /** Pre-built sticker generation prompt (see api-server/src/routes/stickers.ts buildPrompt). */
  prompt: string;
}

// ---------------------------------------------------------------------------
// Classified errors so the api-server can pick a sensible HTTP code + the SPA
// can show a precisely-actionable toast (instead of one generic "貼圖生成失敗").
// ---------------------------------------------------------------------------

export type StickerGenerationErrorCode =
  | "safety_block"        // Gemini blocked the prompt or response (photo / theme too sensitive)
  | "quota_exhausted"     // 429 / RESOURCE_EXHAUSTED — free tier daily cap usually
  | "model_not_found"     // 404 — model name retired (the GEMINI_IMAGE_MODEL override case)
  | "max_tokens"          // finishReason=MAX_TOKENS — output truncated before image emitted
  | "no_image"            // Got a response but no image in any candidate (rare)
  | "network"             // fetch rejected — Cloud Functions egress / Gemini outage
  | "internal";           // Anything else (treat as bug / SDK error)

export class StickerGenerationError extends Error {
  readonly code: StickerGenerationErrorCode;
  readonly userMessage: string;
  readonly httpStatus: number;
  readonly cause?: unknown;

  constructor(code: StickerGenerationErrorCode, userMessage: string, httpStatus: number, cause?: unknown) {
    super(userMessage);
    this.name = "StickerGenerationError";
    this.code = code;
    this.userMessage = userMessage;
    this.httpStatus = httpStatus;
    this.cause = cause;
  }
}

interface GeminiLikeError {
  status?: number;
  message?: string;
  name?: string;
}

function classifyGeminiError(err: unknown): StickerGenerationError {
  const e = (err ?? {}) as GeminiLikeError;
  const status = typeof e.status === "number" ? e.status : null;
  const msg = (typeof e.message === "string" ? e.message : "").toLowerCase();

  // Order matters: pattern-match before status-only fallbacks so we catch
  // SDK quirks where status=200 but the body says "blocked".
  if (msg.includes("safety") || msg.includes("blocked") || msg.includes("policy")) {
    return new StickerGenerationError(
      "safety_block",
      "AI 安全過濾器拒絕了這張照片或主題。請換一張一般人像照(不含未成年/暴力/敏感內容),或改一個比較中性的主題後再試。",
      400,
      err,
    );
  }
  if (msg.includes("model") && (msg.includes("not found") || msg.includes("not supported"))) {
    return new StickerGenerationError(
      "model_not_found",
      "AI 模型暫時無法使用,可能是模型版本剛被官方棄用。請告知管理員執行 ListModels 確認最新可用模型。",
      503,
      err,
    );
  }
  if (status === 429 || msg.includes("quota") || msg.includes("resource_exhausted") || msg.includes("rate limit")) {
    return new StickerGenerationError(
      "quota_exhausted",
      "Gemini API 今日免費額度已用完(通常隔日重置)。如急用,管理員可至 Google AI Studio 升級到付費 tier。",
      503,
      err,
    );
  }
  if (msg.includes("max_tokens") || msg.includes("max output") || msg.includes("truncated")) {
    return new StickerGenerationError(
      "max_tokens",
      "AI 輸出被截斷,圖片沒生成完整。可能是文字標籤過多或過長,請縮短部分標籤後再試。",
      502,
      err,
    );
  }
  if (e.name === "TypeError" && msg.includes("fetch")) {
    return new StickerGenerationError(
      "network",
      "AI 服務連線異常,請稍後再試一次。",
      502,
      err,
    );
  }
  return new StickerGenerationError(
    "internal",
    `生成失敗:${e.message ?? "未知錯誤"},請稍後再試。`,
    500,
    err,
  );
}

/**
 * Default model for sticker sheet generation. Override at runtime via the
 * `GEMINI_IMAGE_MODEL` environment variable.
 *
 * 2026-04-26 model selection notes (verified via ListModels):
 *   - gemini-2.5-flash-image          (GA, fast, weak at Traditional Chinese
 *                                      character rendering — produces
 *                                      visually-similar but wrong glyphs)
 *   - gemini-3.1-flash-image-preview  ← chosen default: dramatically better
 *                                      at zh-Hant text rendering, still fast,
 *                                      preview status accepted as trade-off
 *   - gemini-3-pro-image-preview      (slowest / priciest, peak quality;
 *                                      switch to this if 3.1-flash starts
 *                                      mis-rendering on harder layouts)
 *
 * ⚠️ Google retires Gemini models faster than other providers. Before
 *    deploying a new revision, verify the model is still active:
 *
 *      curl "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" \
 *        | grep -oE '"name":\s*"models/gemini-[^"]*image[^"]*"'
 *
 *    If the default disappears, set `GEMINI_IMAGE_MODEL` env to a listed
 *    replacement and redeploy (no code change needed).
 */
const DEFAULT_MODEL = "gemini-3.1-flash-image-preview";

function modelName(): string {
  return process.env["GEMINI_IMAGE_MODEL"]?.trim() || DEFAULT_MODEL;
}

/**
 * Generates a 4×6 chibi sticker sheet PNG by sending the user's photo plus
 * the layout prompt to Gemini's multimodal image generation endpoint.
 *
 * Returns the raw PNG bytes (Buffer). Throws if the model returns no image
 * data — e.g. when the prompt is rejected by safety filters or when output
 * is truncated by max-token limits.
 */
export async function generateStickerSheet(
  input: GenerateStickerInput,
): Promise<Buffer> {
  const { photoBuffer, photoMimeType, prompt } = input;

  let response;
  try {
    response = await client().models.generateContent({
      model: modelName(),
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: photoMimeType,
                data: photoBuffer.toString("base64"),
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: [Modality.IMAGE],
        // NOTE: do NOT set thinkingConfig on image-output models
      // (gemini-2.5-flash-image / gemini-3-*-image-*). They reject it with
      //   400 INVALID_ARGUMENT: Thinking is not enabled for this model.
      // The gemini-api-integration skill's gotcha #9 (thinking eats output
      // budget) only applies to text models that have thinking enabled by
      // default, like gemini-2.5-flash and gemini-2.5-pro.
      //
      // NOTE on safety: we let Gemini's default thresholds run for now. If user
      // photos start getting rejected with promptFeedback.blockReason === "SAFETY",
      // import HarmCategory + HarmBlockThreshold from "@google/genai" and add
      // safetySettings here using the IMAGE-prefixed categories
      // (HARM_CATEGORY_IMAGE_HARASSMENT, _IMAGE_DANGEROUS_CONTENT,
      //  _IMAGE_SEXUALLY_EXPLICIT, etc.) at threshold BLOCK_ONLY_HIGH.
      },
    });
  } catch (err) {
    throw classifyGeminiError(err);
  }

  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const imagePart = parts.find(
    (p) =>
      typeof p.inlineData?.data === "string" &&
      typeof p.inlineData.mimeType === "string" &&
      p.inlineData.mimeType.startsWith("image/"),
  );

  if (!imagePart?.inlineData?.data) {
    const finishReason = candidate?.finishReason ?? "unknown";
    const blockReason = response.promptFeedback?.blockReason;

    if (blockReason) {
      throw new StickerGenerationError(
        "safety_block",
        "AI 安全過濾器擋下了這張照片或主題。請改用一般人像照(不含未成年/暴力/敏感內容),或換一個比較中性的主題。",
        400,
        { blockReason, finishReason },
      );
    }
    if (typeof finishReason === "string" && finishReason.toUpperCase() === "MAX_TOKENS") {
      throw new StickerGenerationError(
        "max_tokens",
        "AI 輸出在生成圖片前用完 token 預算。請縮短部分標籤文字後再試。",
        502,
        { finishReason },
      );
    }
    const text = parts.find((p) => typeof p.text === "string")?.text ?? "";
    throw new StickerGenerationError(
      "no_image",
      `AI 沒有回傳圖片(finishReason=${finishReason})。請換一張角度清楚的人像照再試。${text ? ` 提示:${text.slice(0, 80)}` : ""}`,
      502,
      { finishReason, text: text.slice(0, 200) },
    );
  }

  return Buffer.from(imagePart.inlineData.data, "base64");
}
