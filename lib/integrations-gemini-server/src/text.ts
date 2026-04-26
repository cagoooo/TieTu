import { client } from "./client";

export interface RewriteTextsInput {
  theme: string;
  /** Existing 24 sticker labels — used as a "slot semantics" reference so the
   *  rewritten labels keep the same emotional layout (greeting / response /
   *  emotion / action…). */
  originalTexts: string[];
}

const DEFAULT_TEXT_MODEL = "gemini-2.5-flash";

function modelName(): string {
  return process.env["GEMINI_TEXT_MODEL"]?.trim() || DEFAULT_TEXT_MODEL;
}

/**
 * Rewrites the 24 sticker labels so that every single one is contextually
 * tied to the user-supplied theme, while preserving the emotional/role
 * function of each slot from the original list.
 *
 * Returns a fresh array of 24 Traditional Chinese strings, each 1–8 chars.
 * Throws if the model returns malformed JSON, an array of the wrong length,
 * or empty content.
 */
export async function rewriteTexts(input: RewriteTextsInput): Promise<string[]> {
  const theme = input.theme.trim();
  if (!theme) {
    throw new Error("Theme cannot be empty.");
  }
  if (!Array.isArray(input.originalTexts) || input.originalTexts.length !== 24) {
    throw new Error("originalTexts must be an array of exactly 24 strings.");
  }

  const labelLines = input.originalTexts
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");

  const prompt = `你是專業的 LINE 貼圖文案設計師。請依「主題」全部改寫下列 24 個貼圖文字。

【主題】「${theme}」

【原始 24 格(僅作為各格情緒/功能的位置參考)】
${labelLines}

【硬性規則】
1. 必須回 24 個元素,順序對應原本的 1~24 格
2. 每個元素都是繁體中文短句,長度 1~8 個字(可含驚嘆號、問號、波浪號)
3. **每一個都必須跟主題「${theme}」直接相關**(不可以只改部分,其他保留原文)
4. 盡量保留原本各格的「情境/語氣/功能」(例如原是問候 → 改寫後也是該主題下的問候;原是抒發情緒 → 改寫後也是該主題情境的情緒)
5. 同一個詞不可重複使用兩次以上
6. 適合 LINE 貼圖場景:口語、有情緒、活潑、好讀好懂

【輸出格式】
只回 JSON array,24 個 string,**不要 markdown 程式碼框、不要解釋文字、不要 key**。
範例(主題若是「馬年祝賀」):["新年快樂","萬事如意","馬到成功","龍馬精神","恭喜發財","心想事成", … 共 24 個 ]

現在請直接輸出 JSON array:`;

  const response = await client().models.generateContent({
    model: modelName(),
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      temperature: 0.95,
      maxOutputTokens: 2048,
      // 對 24 格短文字改寫,thinking 沒幫助而且會吃 maxOutputTokens 預算
      // (gemini-api-integration skill 雷 #9)。
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const candidate = response.candidates?.[0];
  const rawText = candidate?.content?.parts?.find((p) => typeof p.text === "string")?.text ?? "";
  if (!rawText) {
    const finishReason = candidate?.finishReason ?? "unknown";
    const blockReason = response.promptFeedback?.blockReason;
    throw new Error(
      `Gemini returned no text (finishReason=${finishReason}${blockReason ? `, blockReason=${blockReason}` : ""}).`,
    );
  }

  // Defensive: Gemini occasionally wraps JSON in ```json fences despite
  // responseMimeType=application/json (skill gotcha #4).
  const cleaned = rawText
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Gemini did not return valid JSON. Got: ${cleaned.slice(0, 200)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Gemini did not return an array.");
  }

  // Coerce + clamp each entry to a sane string length (defence in depth
  // against a hallucinated 200-char "label").
  const result = parsed.map((v) => {
    const s = String(v ?? "").trim();
    return s.length > 16 ? s.slice(0, 16) : s;
  });

  if (result.length !== 24) {
    throw new Error(
      `Expected 24 labels in response, got ${result.length}. First few: ${result.slice(0, 3).join(", ")}`,
    );
  }
  if (result.some((s) => s.length === 0)) {
    throw new Error("Gemini returned an empty label among the 24.");
  }

  return result;
}
