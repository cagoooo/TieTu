// 每日次數與 Google Chat 通知（2026-11-25 阿凱老師定案：凡是用到老師 Gemini 金鑰的
// 公開 AI 功能，一律「Google 登入＋每個帳號每天 3 次（台北午夜重置）＋每次使用發 Chat 通知」）。
//
// 計數文件放在 `tietu_rateLimits/{kind}_{uid}_{台北日期}`（加 tietu_ 前綴，避免和同專案的
// 注音挑戰撞名）。用 transaction 扣次，AI 失敗時退回。
import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { logger } from "./logger";

export const SITE_NAME = "TieTu 盲盒貼圖機";

/** 每個帳號每天能「生成一整張 24 格貼圖」幾次 */
export const DAILY_GENERATE_LIMIT = 3;

/**
 * 中間步驟（依主題改寫文字、生成後的文字辨識）也會呼叫 Gemini，但不算在每天 3 次裡；
 * 另設每帳號每日保險絲，避免被拿來狂刷。
 */
export const DAILY_FUSE_LIMITS = {
  rewrite: 20,
  verify: 20,
} as const;

export type QuotaKind = "generate" | keyof typeof DAILY_FUSE_LIMITS;

export const RATE_LIMIT_COLLECTION = "tietu_rateLimits";

export function limitFor(kind: QuotaKind): number {
  return kind === "generate" ? DAILY_GENERATE_LIMIT : DAILY_FUSE_LIMITS[kind];
}

/** 台北日期 YYYY-MM-DD */
export function taipeiDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function quotaDocId(kind: QuotaKind, uid: string, day: string): string {
  return `${kind}_${uid}_${day}`;
}

function db() {
  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault() });
  }
  return getFirestore();
}

export interface QuotaResult {
  allowed: boolean;
  day: string;
  used: number;
  limit: number;
  remaining: number;
}

/** 扣一次。超過上限回 allowed=false（不會扣）。 */
export async function consumeQuota(kind: QuotaKind, uid: string): Promise<QuotaResult> {
  const day = taipeiDay();
  const limit = limitFor(kind);
  const ref = db().collection(RATE_LIMIT_COLLECTION).doc(quotaDocId(kind, uid, day));
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = snap.exists ? Number(snap.get("count") ?? 0) : 0;
    if (used >= limit) {
      return { allowed: false, day, used, limit, remaining: 0 };
    }
    const next = used + 1;
    tx.set(
      ref,
      {
        kind,
        uid,
        day,
        count: next,
        updatedAt: FieldValue.serverTimestamp(),
        // 兩天後可被 TTL 清掉（要另外在 Firestore 開 TTL 才會自動刪）
        expireAt: Timestamp.fromMillis(Date.now() + 2 * 24 * 60 * 60 * 1000),
      },
      { merge: true },
    );
    return { allowed: true, day, used: next, limit, remaining: Math.max(0, limit - next) };
  });
}

/** AI 失敗時退回一次；用扣次那天的日期，跨午夜失敗也不會退到隔天。 */
export async function refundQuota(kind: QuotaKind, uid: string, day: string): Promise<number | null> {
  const ref = db().collection(RATE_LIMIT_COLLECTION).doc(quotaDocId(kind, uid, day));
  try {
    return await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const used = snap.exists ? Number(snap.get("count") ?? 0) : 0;
      if (used <= 0) return 0;
      tx.update(ref, { count: used - 1, updatedAt: FieldValue.serverTimestamp() });
      return used - 1;
    });
  } catch (err) {
    logger.warn({ err, kind, day }, "[quota] refund failed");
    return null;
  }
}

/** 只查不扣 */
export async function readQuota(kind: QuotaKind, uid: string): Promise<QuotaResult> {
  const day = taipeiDay();
  const limit = limitFor(kind);
  const snap = await db().collection(RATE_LIMIT_COLLECTION).doc(quotaDocId(kind, uid, day)).get();
  const used = snap.exists ? Number(snap.get("count") ?? 0) : 0;
  return { allowed: used < limit, day, used, limit, remaining: Math.max(0, limit - used) };
}

// ---------------------------------------------------------------------------
// Google Chat 通知（每次使用都發，才看得出有沒有人亂刷）
// ---------------------------------------------------------------------------

export type ChatEvent = "success" | "failure" | "blocked";

const STYLE_LABELS: Record<string, string> = {
  "pop-mart-3d": "3D 盲盒公仔",
  clay: "黏土風",
  pixel: "像素風",
  "anime-2d": "日系動漫",
  watercolor: "水彩風",
};

function taipeiTime(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
}

/** 去掉亂碼與控制字元，避免通知卡片被注入奇怪內容 */
function clean(text: string, max = 120): string {
  return text.replace(/�/g, "").replace(/\p{Cc}/gu, " ").trim().slice(0, max);
}

export interface ChatNotice {
  event: ChatEvent;
  user: DecodedIdToken;
  styleId?: string;
  remaining?: number;
  elapsedMs?: number;
  errorMessage?: string;
}

export async function notifyChat(notice: ChatNotice): Promise<void> {
  const url = (process.env.TIETU_GOOGLE_CHAT_WEBHOOK_URL ?? "").trim();
  if (!url.startsWith("https://chat.googleapis.com/")) return;

  const title =
    notice.event === "success"
      ? `✅ 有人使用了 ${SITE_NAME}`
      : notice.event === "failure"
        ? `❌ ${SITE_NAME} 生成失敗（已退回次數）`
        : `⛔ ${SITE_NAME} 今日次數已用完被擋`;

  const name = clean(String(notice.user.name ?? "（沒有名稱）"), 60);
  const email = clean(String(notice.user.email ?? "（沒有 Email）"), 80);
  const rows: { label: string; text: string }[] = [
    { label: "功能", text: "生成 24 格貼圖" },
    { label: "使用者", text: `${name}（${email}）` },
    { label: "時間（台北）", text: taipeiTime() },
  ];
  if (notice.styleId) {
    rows.push({ label: "風格", text: STYLE_LABELS[notice.styleId] ?? "未知風格（已過濾）" });
  }
  if (typeof notice.elapsedMs === "number") {
    rows.push({ label: "耗時", text: `${(notice.elapsedMs / 1000).toFixed(1)} 秒` });
  }
  if (typeof notice.remaining === "number") {
    rows.push({ label: "今日剩餘", text: `${notice.remaining} / ${DAILY_GENERATE_LIMIT} 次` });
  }
  if (notice.errorMessage) {
    rows.push({ label: "錯誤", text: clean(notice.errorMessage) || "（無法辨識的文字，已過濾）" });
  }

  const payload = {
    text: `${title}｜${rows.map((r) => `${r.label}：${r.text}`).join("｜")}`,
    cardsV2: [
      {
        cardId: `tietu-${Date.now()}`,
        card: {
          header: { title, subtitle: "cagoooo.github.io/TieTu" },
          sections: [
            {
              widgets: rows.map((r) => ({
                decoratedText: { topLabel: r.label, text: r.text, wrapText: true },
              })),
            },
          ],
        },
      },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) logger.warn({ status: res.status }, "[chat] webhook non-2xx");
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, "[chat] webhook failed");
  } finally {
    clearTimeout(timer);
  }
}
