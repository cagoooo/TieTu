import { Buffer } from "node:buffer";
import { client } from "./client";

export interface VerifyTextsInput {
  /** Full sheet PNG bytes (the same buffer the SPA holds in sheetBase64). */
  sheetBuffer: Buffer;
  /** MIME type of the sheet image. Always image/png in practice. */
  sheetMimeType: string;
  /** Number of cells to read, in row-major order. Currently always 24. */
  expectedCount: number;
}

const DEFAULT_VERIFY_MODEL = "gemini-2.5-flash";

function modelName(): string {
  return process.env["GEMINI_VERIFY_MODEL"]?.trim() || DEFAULT_VERIFY_MODEL;
}

/**
 * Symmetric Jaccard on the character sets of two short strings, after
 * stripping whitespace and Unicode punctuation. Same metric the deprecated
 * Tesseract pipeline used (sticker-ocr.ts) so the SPA's UI display logic
 * doesn't need to change when we swap the backend.
 */
function characterSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.replace(/[\s\p{P}]/gu, "");
  const aN = norm(a);
  const bN = norm(b);
  if (aN.length === 0 && bN.length === 0) return 1;
  if (aN.length === 0 || bN.length === 0) return 0;
  const aSet = new Set(aN.split(""));
  const bSet = new Set(bN.split(""));
  const intersection = [...aSet].filter((c) => bSet.has(c)).length;
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
}

export interface VerifyTextsResult {
  /** What Gemini Vision read in each cell (row-major, length === expectedCount). */
  recognizedTexts: string[];
  /** Same metric the Tesseract path used so the UI shows familiar percentages. */
  averageSimilarity: number;
}

/**
 * Reads back the rendered Chinese (and occasional English) labels from a
 * generated 4×6 sticker sheet by sending the full PNG to gemini-2.5-flash
 * with a single multimodal call.
 *
 * Why we replaced Tesseract.js + chi_tra:
 *   - chi_tra alone could not read English fragments (Hi / YA → blank).
 *   - Tesseract treats the whole tile as a text region, so the chibi
 *     character's strokes (eyebrows, hair clumps, clothing folds) often got
 *     read as random Chinese characters. On a real generated sheet this gave
 *     a 67% false-positive rate (8/12 sampled cells flagged as wrong), which
 *     trained users to ignore the warning entirely.
 *   - Tesseract.js + chi_tra weighed ~8 MB of language-pack download per
 *     verification, which made the feature feel slow and unreliable.
 *
 * Gemini Vision handles all of these natively: mixed zh-Hant + Latin, can
 * isolate text from the surrounding cartoon character, and runs inside the
 * existing free tier (~1 call per verification, well under the
 * 1500 RPD gemini-2.5-flash quota).
 */
export async function verifyTexts(
  input: VerifyTextsInput,
  expectedTexts: string[],
): Promise<VerifyTextsResult> {
  const { sheetBuffer, sheetMimeType, expectedCount } = input;
  if (expectedTexts.length !== expectedCount) {
    throw new Error(
      `expectedTexts length (${expectedTexts.length}) must match expectedCount (${expectedCount}).`,
    );
  }

  const labelHints = expectedTexts
    .map((t, i) => {
      const row = Math.floor(i / 4) + 1;
      const col = (i % 4) + 1;
      return `  ${i + 1}. (Row ${row}, Col ${col}) 「${t}」`;
    })
    .join("\n");

  const prompt = `這是一張 4 欄 × 6 列、共 24 格的貼圖。每一格的下半部(或第 6 列的上半部)印有一段文字標籤,大多是繁體中文,偶爾混雜英文字母(例如 Hi、YA)。

請依照「**從左到右、從上到下**」的順序,逐格讀出每一格實際印出來的文字標籤。

【硬性規則】
1. 只看每一格內的文字,**不要把人物的線條、頭髮、表情誤判成中文字**
2. 若某一格的文字模糊、被遮住、或實在讀不清楚,該位置回空字串 ""
3. 不要翻譯、不要解釋、不要加任何標號或備註
4. 一定要剛好回 ${expectedCount} 個元素,順序對應 1~${expectedCount} 格
5. 保留中英文混合(例如 "Hi"、"開心YA"),不要省略字母

【參考(僅作為「標籤大概長這樣」的提示,實際以圖片中印出來的為準。如果圖片寫的跟提示不同,請以圖片為準)】
${labelHints}

【輸出格式】
只回 JSON array,${expectedCount} 個 string,**不要 markdown 程式碼框、不要 key、不要解釋文字**。

範例(若這張剛好印著範例文字):["收到","晚安","天啊","抱抱","謝謝","好的","好棒棒","開心YA","生氣氣","做得好","無言","害羞","沒問題","驚訝","買買買","改功課中","出去玩","哈哈哈","白眼","Hi","麻煩了","拜託","辛苦了","感謝你"]

現在請直接輸出 JSON array:`;

  const response = await client().models.generateContent({
    model: modelName(),
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: sheetMimeType,
              data: sheetBuffer.toString("base64"),
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      // Slightly above zero so the model commits to a single most-likely
      // reading per cell instead of producing equally-likely alternates.
      // Higher temperatures hurt OCR fidelity.
      temperature: 0.1,
      // 24 short labels max ~150 chars total + JSON syntax = well under 1k.
      // Buffer for thinking tokens if the API tries to enable them.
      maxOutputTokens: 2048,
      // Reading-back is mechanical, no reasoning helps. Keeps cost down and
      // avoids the gemini-2.5 thinking-eats-output-budget pitfall (gemini-
      // api-integration skill gotcha #9).
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const candidate = response.candidates?.[0];
  const rawText =
    candidate?.content?.parts?.find((p) => typeof p.text === "string")?.text ?? "";
  if (!rawText) {
    const finishReason = candidate?.finishReason ?? "unknown";
    const blockReason = response.promptFeedback?.blockReason;
    throw new Error(
      `Gemini Vision returned no text (finishReason=${finishReason}${blockReason ? `, blockReason=${blockReason}` : ""}).`,
    );
  }

  const cleaned = rawText
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Gemini Vision did not return valid JSON. Got: ${cleaned.slice(0, 200)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Gemini Vision did not return an array.");
  }

  // Coerce + clamp. Empty string is fine (means "couldn't read this cell").
  const recognized: string[] = parsed.map((v) => {
    const s = String(v ?? "").trim();
    return s.length > 32 ? s.slice(0, 32) : s;
  });

  if (recognized.length !== expectedCount) {
    // Pad / truncate defensively rather than failing the whole call — partial
    // results are still useful to the user.
    while (recognized.length < expectedCount) recognized.push("");
    if (recognized.length > expectedCount) recognized.length = expectedCount;
  }

  const totalSim = recognized.reduce(
    (sum, got, i) => sum + characterSimilarity(expectedTexts[i] ?? "", got),
    0,
  );

  return {
    recognizedTexts: recognized,
    averageSimilarity: recognized.length === 0 ? 1 : totalSim / recognized.length,
  };
}
