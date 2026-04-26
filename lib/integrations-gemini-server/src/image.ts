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

/**
 * Default model for sticker sheet generation. Override at runtime via the
 * `GEMINI_IMAGE_MODEL` environment variable.
 *
 * Verified 2026-04-26 against ListModels — `gemini-2.5-flash-image` is the GA
 * name (the earlier `-preview` suffix has been retired). Newer alternatives
 * available the same day:
 *   - gemini-3.1-flash-image-preview  (newer but preview, may break)
 *   - gemini-3-pro-image-preview      (slower / pricier, preview)
 *
 * ⚠️ Google deprecates Gemini models faster than other providers. BEFORE
 *    deploying, verify the model is still active by running:
 *
 *      curl "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" \
 *        | grep -oE '"name":\s*"models/gemini-[^"]*image[^"]*"'
 *
 *    If `gemini-2.5-flash-image` disappears, set `GEMINI_IMAGE_MODEL` to a
 *    listed replacement.
 */
const DEFAULT_MODEL = "gemini-2.5-flash-image";

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

  const response = await client().models.generateContent({
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
      // Disable thinking — image generation does not benefit from chain-of-thought
      // tokens and they would consume the output budget. (See gemini-api-integration
      // skill, gotcha #9.)
      thinkingConfig: { thinkingBudget: 0 },
      // NOTE on safety: we let Gemini's default thresholds run for now. If user
      // photos start getting rejected with promptFeedback.blockReason === "SAFETY",
      // import HarmCategory + HarmBlockThreshold from "@google/genai" and add
      // safetySettings here using the IMAGE-prefixed categories
      // (HARM_CATEGORY_IMAGE_HARASSMENT, _IMAGE_DANGEROUS_CONTENT,
      //  _IMAGE_SEXUALLY_EXPLICIT, etc.) at threshold BLOCK_ONLY_HIGH.
    },
  });

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
    const text = parts.find((p) => typeof p.text === "string")?.text ?? "";
    const detail = blockReason
      ? `safety blocked (${blockReason})`
      : `finishReason=${finishReason}`;
    throw new Error(
      `Gemini did not return an image (${detail}): ${text.slice(0, 200)}`,
    );
  }

  return Buffer.from(imagePart.inlineData.data, "base64");
}
