import type { RequestHandler } from "express";

/**
 * AI 生圖總開關（2026-11-26 起暫停）。
 *
 * 原因：Gemini 生圖模型沒有免費額度，預付儲值用完後每次都回 402；
 * 網站開放給外部測試，管理員決定先不儲值。
 *
 * 暫停期間：生成、依主題改寫、文字辨識三個會呼叫 Gemini 的 API
 * 一律直接回 503 generation_paused —— 不扣次數、不呼叫 Gemini、不發失敗通知。
 * 前端透過 GET /api/stickers/status 得知暫停，停用按鈕並顯示提示。
 *
 * 恢復：把 GENERATION_PAUSED 改成 false，commit + push 讓 CI 重新部署即可。
 */
export const GENERATION_PAUSED = true;

export const GENERATION_PAUSED_MESSAGE =
  "測試期間 AI 生圖暫停中，暫時無法生成貼圖。造成不便，敬請見諒！";

export function rejectIfGenerationPaused(): RequestHandler {
  return (_req, res, next) => {
    if (!GENERATION_PAUSED) {
      next();
      return;
    }
    res.status(503).json({
      error: GENERATION_PAUSED_MESSAGE,
      code: "generation_paused",
    });
  };
}
