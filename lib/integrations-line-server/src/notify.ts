// Single-purpose LINE Messaging API client for "push to admin" notifications.
//
// Why no @line/bot-sdk dependency:
//   The LINE SDK is convenient but pulls in 8+ MB of types/transport, and we
//   only need ONE endpoint (POST /v2/bot/message/push). A 50-line fetch
//   wrapper keeps the Cloud Function bundle smaller and removes a moving
//   dependency we'd otherwise have to keep version-aligned.
//
// Why "best effort" semantics:
//   The admin LINE notification is a side-effect of /api/stickers/generate.
//   If LINE is rate-limited / down / token-rotated, the user must still get
//   their sticker. Every failure here is logged and swallowed — never
//   bubbles up to the HTTP response.

import process from "node:process";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type AdminNotificationKind =
  | "generate_success"
  | "generate_failure"
  | "verify_text_failure";

export interface AdminNotification {
  kind: AdminNotificationKind;
  /** User-supplied theme (or null if no theme). */
  theme?: string | null;
  /** Style id used for generation (pop-mart-3d / clay / etc.). */
  styleId?: string;
  /** Firebase Auth uid when the request was authenticated. */
  uid?: string | null;
  /** Firebase Auth email when available. */
  email?: string | null;
  /** Public Cloud Storage URL of the generated sheet (success only). */
  imageUrl?: string;
  /** StickerGenerationError code (failure only). */
  errorCode?: string;
  /** User-facing error message (failure only, capped at 200 chars when sent). */
  errorMessage?: string;
}

const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";
const ENV_TOKEN = "TIETU_LINE_CHANNEL_ACCESS_TOKEN";
const ENV_ADMIN = "TIETU_LINE_ADMIN_USER_ID";
const DISABLED_SENTINEL = "DISABLED";

// LINE text messages cap at 5000 chars; we cap our error message inclusion at
// 200 so the notification stays readable on a phone lock-screen preview.
const MAX_ERROR_MESSAGE_LEN = 200;

/**
 * Pushes a single text notification to the admin LINE user.
 *
 * Returns void — never throws. If the env vars aren't set or are the
 * "DISABLED" sentinel, we silently skip (handy for local dev).
 *
 * Logger is optional; when omitted, failures are silently dropped after best-
 * effort console.warn fallback. Most callers pass their pino logger so the
 * GCP Logging trace stays correlated with the originating HTTP request.
 */
export async function notifyAdmin(
  notification: AdminNotification,
  logger?: { warn: (data: unknown, msg?: string) => void; debug?: (data: unknown, msg?: string) => void },
): Promise<void> {
  const token = process.env[ENV_TOKEN]?.trim() ?? "";
  const adminUserId = process.env[ENV_ADMIN]?.trim() ?? "";

  if (!token || token === DISABLED_SENTINEL) {
    logger?.debug?.({ reason: "no_token" }, "[line] notifyAdmin skipped");
    return;
  }
  if (!adminUserId || adminUserId === DISABLED_SENTINEL) {
    logger?.debug?.({ reason: "no_admin_id" }, "[line] notifyAdmin skipped");
    return;
  }

  const text = formatNotification(notification);

  try {
    const res = await fetch(LINE_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: adminUserId,
        messages: [{ type: "text", text }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const log = logger?.warn ?? ((data: unknown, msg?: string) => console.warn(msg, data));
      log(
        { status: res.status, body: body.slice(0, 400) },
        "[line] notifyAdmin push returned non-2xx",
      );
      return;
    }
    logger?.debug?.({ kind: notification.kind }, "[line] notifyAdmin push delivered");
  } catch (err) {
    const log = logger?.warn ?? ((data: unknown, msg?: string) => console.warn(msg, data));
    log({ err: errSummary(err) }, "[line] notifyAdmin fetch threw");
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function errSummary(err: unknown): { message: string; name?: string } {
  if (err instanceof Error) {
    return { message: err.message, name: err.name };
  }
  return { message: String(err).slice(0, 200) };
}

const STYLE_LABELS_ZH: Record<string, string> = {
  "pop-mart-3d": "Pop Mart 3D",
  clay: "黏土風",
  pixel: "16-bit 像素",
  "anime-2d": "二次元動畫",
  watercolor: "水彩",
};

function describeUser(notification: AdminNotification): string {
  if (notification.email) return notification.email;
  if (notification.uid) return notification.uid.slice(0, 12) + "...";
  return "(訪客)";
}

function describeStyle(styleId: string | undefined): string {
  if (!styleId) return "(未指定)";
  return STYLE_LABELS_ZH[styleId] ?? styleId;
}

function describeTheme(theme: string | null | undefined): string {
  if (!theme) return "(無主題)";
  return theme.length > 40 ? theme.slice(0, 40) + "..." : theme;
}

/**
 * Format a notification as plain LINE-safe text. We avoid Flex Messages here
 * because:
 *   - Flex requires a separate altText that gets shown on lock screens —
 *     plain text just IS the lock-screen text, which is what we actually
 *     want for instant glance-able status.
 *   - Flex 6-digit color rule (skill 雷 #9) is one more thing to get wrong.
 */
export function formatNotification(notification: AdminNotification): string {
  const divider = "━━━━━━━━━━━━━━";
  const userLine = `👤 使用者:${describeUser(notification)}`;
  const themeLine = `📝 主題:${describeTheme(notification.theme)}`;
  const styleLine = `🎨 畫風:${describeStyle(notification.styleId)}`;
  const at = formatTimestamp(new Date());

  switch (notification.kind) {
    case "generate_success": {
      const lines = [
        "🎉 TieTu 新貼圖生成成功",
        divider,
        themeLine,
        styleLine,
        userLine,
      ];
      if (notification.imageUrl) {
        lines.push(`🖼 ${notification.imageUrl}`);
      }
      lines.push(`⏰ ${at}`);
      return lines.join("\n");
    }
    case "generate_failure": {
      const code = notification.errorCode ?? "internal";
      const msg = (notification.errorMessage ?? "").slice(0, MAX_ERROR_MESSAGE_LEN);
      return [
        "❌ TieTu 生成失敗",
        divider,
        themeLine,
        styleLine,
        userLine,
        `🚫 錯誤代碼:${code}`,
        msg ? `💬 ${msg}` : null,
        `⏰ ${at}`,
      ]
        .filter((l): l is string => l !== null)
        .join("\n");
    }
    case "verify_text_failure": {
      const msg = (notification.errorMessage ?? "").slice(0, MAX_ERROR_MESSAGE_LEN);
      return [
        "⚠️ TieTu 文字驗證失敗",
        divider,
        userLine,
        msg ? `💬 ${msg}` : "💬 Gemini Vision 呼叫異常",
        `⏰ ${at}`,
      ].join("\n");
    }
  }
}

function formatTimestamp(d: Date): string {
  // Fixed Asia/Taipei offset because Cloud Functions runs in UTC and we want
  // the admin to read times in their own zone without doing math.
  const tw = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const yyyy = tw.getUTCFullYear();
  const mm = String(tw.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(tw.getUTCDate()).padStart(2, "0");
  const hh = String(tw.getUTCHours()).padStart(2, "0");
  const mi = String(tw.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} (台灣時間)`;
}
