import { Router, type IRouter } from "express";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { logger } from "../lib/logger";
import { attachFirebaseUser, getRequestUser } from "../lib/auth-middleware";
import { verifyTurnstile } from "../middlewares/verify-turnstile";

// ---------------------------------------------------------------------------
// /shared/{shortCode} Firestore collection
//
// Document shape:
//   {
//     ownerUid: string,         // Firebase Auth uid that created the share
//     texts: string[24],        // labels rendered onto the sheet
//     theme: string | null,     // optional theme
//     styleId: string,          // pop-mart-3d / clay / pixel / anime-2d / watercolor
//     sheetUrl: string,         // public Cloud Storage URL of the rendered sheet
//     createdAt: number,        // ms epoch
//     viewCount: number,        // incremented on each public read
//   }
//
// Read access: PUBLIC (allowed by Firestore rules so anonymous /share/:code
// pages can render without an Auth token).
// Write access: server-only (this file creates docs via firebase-admin which
// bypasses rules; the rules deny client writes outright).
// ---------------------------------------------------------------------------

const router: IRouter = Router();

const SHORT_CODE_LENGTH = 8;
const SHORT_CODE_ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789"; // no l, 0, 1 to avoid OCR-style ambiguity
const MAX_TEXT_LEN = 32;
const MAX_THEME_LEN = 80;
const VALID_STYLES = new Set([
  "pop-mart-3d",
  "clay",
  "pixel",
  "anime-2d",
  "watercolor",
]);

function generateShortCode(): string {
  let code = "";
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    const idx = Math.floor(Math.random() * SHORT_CODE_ALPHABET.length);
    code += SHORT_CODE_ALPHABET[idx];
  }
  return code;
}

interface CreateShareBody {
  texts?: unknown;
  theme?: unknown;
  styleId?: unknown;
  sheetUrl?: unknown;
}

// POST /api/stickers/share
// Auth required. Captures the current sheet + texts + theme into a public
// /shared/{code} entry and returns the short code so the client can build
// a share URL.
router.post(
  "/stickers/share",
  verifyTurnstile(),
  attachFirebaseUser(),
  async (req, res) => {
    const user = getRequestUser(req);
    if (!user?.uid) {
      res.status(401).json({
        error: "請先登入才能建立分享連結。",
      });
      return;
    }

    const body = (req.body ?? {}) as CreateShareBody;

    // texts: must be 24 strings each <= 32 chars
    const textsRaw = Array.isArray(body.texts) ? body.texts : null;
    if (!textsRaw || textsRaw.length !== 24) {
      res
        .status(400)
        .json({ error: "請求格式錯誤:texts 必須剛好 24 個元素。" });
      return;
    }
    const texts: string[] = textsRaw.map((v) => {
      const s = typeof v === "string" ? v : String(v ?? "");
      return s.length > MAX_TEXT_LEN ? s.slice(0, MAX_TEXT_LEN) : s;
    });

    // theme: optional string up to 80 chars
    const themeRaw =
      typeof body.theme === "string" ? body.theme.trim() : "";
    const theme = themeRaw.length === 0
      ? null
      : (themeRaw.length > MAX_THEME_LEN ? themeRaw.slice(0, MAX_THEME_LEN) : themeRaw);

    // styleId: must be one of the 5 known styles
    const styleId =
      typeof body.styleId === "string" && VALID_STYLES.has(body.styleId)
        ? body.styleId
        : "pop-mart-3d";

    // sheetUrl: must be a Cloud Storage public URL
    const sheetUrl = typeof body.sheetUrl === "string" ? body.sheetUrl.trim() : "";
    if (!sheetUrl) {
      res.status(400).json({
        error: "請求格式錯誤:sheetUrl 不可為空(請等貼圖完成上傳後再試)。",
      });
      return;
    }
    if (
      !sheetUrl.startsWith("https://storage.googleapis.com/") &&
      !sheetUrl.startsWith("https://firebasestorage.googleapis.com/") &&
      !sheetUrl.startsWith("https://storage.cloud.google.com/")
    ) {
      // Defence in depth — only accept Google Cloud Storage URLs so an
      // attacker can't register arbitrary URLs as "share entries" pointing
      // to malicious sites.
      res.status(400).json({
        error: "請求格式錯誤:sheetUrl 必須是 Cloud Storage 公開網址。",
      });
      return;
    }

    try {
      const db = getFirestore();

      // Pick a short code that's not already taken. Collision risk at 8 chars
      // from the 32-letter alphabet ≈ 32^8 = 1.1e12, so 3 attempts is plenty.
      let shortCode = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = generateShortCode();
        const doc = await db.collection("shared").doc(candidate).get();
        if (!doc.exists) {
          shortCode = candidate;
          break;
        }
      }
      if (!shortCode) {
        res.status(503).json({
          error: "短碼產生失敗,請再試一次。",
        });
        return;
      }

      await db.collection("shared").doc(shortCode).set({
        ownerUid: user.uid,
        ownerEmail: user.email ?? null,
        texts,
        theme,
        styleId,
        sheetUrl,
        createdAt: Date.now(),
        viewCount: 0,
      });

      logger.info(
        { uid: user.uid, shortCode, theme, styleId },
        "[shares] share entry created",
      );

      res.json({
        shortCode,
        // The SPA prefers same-origin URLs so the final share link looks
        // clean. Origin selection happens client-side; we just hand back
        // the short code.
      });
    } catch (err) {
      logger.error({ err, uid: user.uid }, "Share creation failed");
      const message =
        err instanceof Error ? err.message : "未知錯誤,請稍後再試。";
      res.status(500).json({ error: `分享建立失敗:${message}` });
    }
  },
);

// GET /api/stickers/shared/:shortCode
// Public read — no auth, no Turnstile. Returns the share data plus
// increments viewCount as a side effect (best-effort, errors swallowed).
router.get("/stickers/shared/:shortCode", async (req, res) => {
  const { shortCode } = req.params as { shortCode?: string };
  if (!shortCode || !/^[a-z0-9]{4,16}$/.test(shortCode)) {
    res.status(400).json({ error: "短碼格式錯誤。" });
    return;
  }

  try {
    const db = getFirestore();
    const docRef = db.collection("shared").doc(shortCode);
    const doc = await docRef.get();
    if (!doc.exists) {
      res.status(404).json({ error: "找不到這個分享連結(可能已被刪除或網址打錯)。" });
      return;
    }
    const data = doc.data() ?? {};

    // Best-effort view counter — never fail the read because of it.
    docRef
      .update({ viewCount: FieldValue.increment(1) })
      .catch((err) =>
        logger.debug({ err, shortCode }, "[shares] viewCount increment failed"),
      );

    res.json({
      shortCode,
      texts: data.texts ?? [],
      theme: data.theme ?? null,
      styleId: data.styleId ?? "pop-mart-3d",
      sheetUrl: data.sheetUrl ?? "",
      createdAt: data.createdAt ?? 0,
      viewCount: (data.viewCount ?? 0) + 1, // include the increment we just queued
    });
  } catch (err) {
    logger.error({ err, shortCode }, "Share lookup failed");
    res.status(500).json({ error: "讀取分享連結失敗,請稍後再試。" });
  }
});

export default router;
