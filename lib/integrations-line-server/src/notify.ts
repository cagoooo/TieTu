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
//
// Flex Message vs plain text:
//   Default sends a Flex Message bubble (header + hero image + body rows +
//   action button) for visually-distinct, scannable notifications. If LINE
//   rejects the Flex (rare — usually a malformed property or an oversized
//   field), we fall back to a plain text version that carries the same
//   information so the admin still gets the alert. This pattern is from
//   line-messaging-firebase skill 雷 #9 (the 6-digit hex requirement bites
//   hard the first time you see it).

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

const MAX_ERROR_MESSAGE_LEN = 200;

// LINE Flex Message brand palette. ALL color values must be 6-digit hex
// (#RRGGBB) — line-messaging-firebase skill 雷 #9: 3-digit hex like "#888"
// returns HTTP 400 "invalid property" with no other clue.
const COLOR = {
  // Headers
  successHeader: "#06C755",   // LINE brand green
  failureHeader: "#EF4444",   // soft red
  warningHeader: "#F59E0B",   // amber
  // Header text
  headerText: "#FFFFFF",
  // Body
  label: "#888888",           // muted grey for "📝 主題" labels
  value: "#1F2937",           // near-black for the values
  emphasisRed: "#DC2626",     // for error code value
  link: "#06C755",            // button background = LINE green
  buttonText: "#FFFFFF",
  divider: "#E5E7EB",
} as const;

type LoggerLike = {
  warn: (data: unknown, msg?: string) => void;
  debug?: (data: unknown, msg?: string) => void;
};

/**
 * Pushes a notification (Flex card with text fallback) to the admin LINE user.
 *
 * Returns void — never throws. If the env vars aren't set or are the
 * "DISABLED" sentinel, we silently skip (handy for local dev).
 */
export async function notifyAdmin(
  notification: AdminNotification,
  logger?: LoggerLike,
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

  const altText = formatPlainText(notification);
  const flex = buildFlexMessage(altText, notification);

  // Attempt 1: Flex Message
  let flexRes: Response | null = null;
  try {
    flexRes = await pushMessages(token, adminUserId, [flex]);
  } catch (err) {
    logger?.warn(
      { err: errSummary(err) },
      "[line] notifyAdmin Flex fetch threw; will try text fallback",
    );
  }

  if (flexRes?.ok) {
    logger?.debug?.({ kind: notification.kind, mode: "flex" }, "[line] delivered");
    return;
  }

  if (flexRes) {
    const body = await flexRes.text().catch(() => "");
    logger?.warn(
      { status: flexRes.status, body: body.slice(0, 400) },
      "[line] Flex push rejected; falling back to text",
    );
  }

  // Attempt 2: plain text fallback
  try {
    const textRes = await pushMessages(token, adminUserId, [
      { type: "text", text: altText },
    ]);
    if (!textRes.ok) {
      const body = await textRes.text().catch(() => "");
      logger?.warn(
        { status: textRes.status, body: body.slice(0, 400) },
        "[line] text fallback also failed",
      );
      return;
    }
    logger?.debug?.(
      { kind: notification.kind, mode: "text-fallback" },
      "[line] delivered",
    );
  } catch (err) {
    logger?.warn(
      { err: errSummary(err) },
      "[line] text fallback fetch threw",
    );
  }
}

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

async function pushMessages(
  token: string,
  to: string,
  messages: unknown[],
): Promise<Response> {
  return fetch(LINE_PUSH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to, messages }),
  });
}

function errSummary(err: unknown): { message: string; name?: string } {
  if (err instanceof Error) {
    return { message: err.message, name: err.name };
  }
  return { message: String(err).slice(0, 200) };
}

// ---------------------------------------------------------------------------
// Formatting helpers (also used by the plain-text fallback / altText)
// ---------------------------------------------------------------------------

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

function formatTimestamp(d: Date): string {
  const tw = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const yyyy = tw.getUTCFullYear();
  const mm = String(tw.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(tw.getUTCDate()).padStart(2, "0");
  const hh = String(tw.getUTCHours()).padStart(2, "0");
  const mi = String(tw.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} (台灣時間)`;
}

/**
 * Plain text version, used as Flex altText AND as the fallback message body
 * when Flex push fails. Lock-screen previews on phones use this.
 */
export function formatNotification(notification: AdminNotification): string {
  return formatPlainText(notification);
}

function formatPlainText(notification: AdminNotification): string {
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
      if (notification.imageUrl) lines.push(`🖼 ${notification.imageUrl}`);
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

// ---------------------------------------------------------------------------
// Flex Message builder
// ---------------------------------------------------------------------------

interface FlexMessage {
  type: "flex";
  altText: string;
  contents: FlexBubble;
}

interface FlexBubble {
  type: "bubble";
  size?: "nano" | "micro" | "kilo" | "mega" | "giga";
  header?: FlexBox;
  hero?: FlexImage;
  body?: FlexBox;
  footer?: FlexBox;
  styles?: {
    header?: { backgroundColor?: string };
    footer?: { separator?: boolean };
  };
}

interface FlexBox {
  type: "box";
  layout: "vertical" | "horizontal" | "baseline";
  contents: FlexComponent[];
  spacing?: "none" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
  margin?: "none" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
  paddingAll?: "none" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
  paddingTop?: string;
  paddingBottom?: string;
  paddingStart?: string;
  paddingEnd?: string;
  backgroundColor?: string;
  cornerRadius?: string;
  borderWidth?: string;
  borderColor?: string;
}

interface FlexImage {
  type: "image";
  url: string;
  size?: string;
  aspectRatio?: string;
  aspectMode?: "cover" | "fit";
  action?: FlexAction;
}

interface FlexText {
  type: "text";
  text: string;
  size?: "xxs" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl" | "3xl" | "4xl" | "5xl";
  weight?: "regular" | "bold";
  color?: string;
  wrap?: boolean;
  flex?: number;
  align?: "start" | "end" | "center";
  margin?: "none" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
}

interface FlexButton {
  type: "button";
  action: FlexAction;
  style?: "primary" | "secondary" | "link";
  color?: string;
  height?: "sm" | "md";
  margin?: "none" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
}

interface FlexSeparator {
  type: "separator";
  margin?: "none" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
  color?: string;
}

interface FlexAction {
  type: "uri";
  label?: string;
  uri: string;
}

type FlexComponent = FlexBox | FlexImage | FlexText | FlexButton | FlexSeparator;

function buildFlexMessage(
  altText: string,
  notification: AdminNotification,
): FlexMessage {
  return {
    type: "flex",
    altText,
    contents: buildBubble(notification),
  };
}

function buildBubble(notification: AdminNotification): FlexBubble {
  switch (notification.kind) {
    case "generate_success":
      return successBubble(notification);
    case "generate_failure":
      return failureBubble(notification);
    case "verify_text_failure":
      return verifyFailureBubble(notification);
  }
}

/** Common header row: emoji + title text on a colored background. */
function header(emoji: string, title: string, bg: string): FlexBox {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: emoji, size: "xl", flex: 0 },
      {
        type: "text",
        text: title,
        weight: "bold",
        size: "lg",
        color: COLOR.headerText,
        margin: "md",
        flex: 1,
      },
    ],
    backgroundColor: bg,
    paddingAll: "md",
  };
}

/** Common label/value row inside the body. */
function row(emoji: string, label: string, value: string, valueColor: string = COLOR.value): FlexBox {
  return {
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      { type: "text", text: emoji, size: "sm", flex: 0 },
      {
        type: "text",
        text: label,
        size: "sm",
        color: COLOR.label,
        flex: 0,
        margin: "xs",
      },
      {
        type: "text",
        text: value,
        size: "sm",
        weight: "bold",
        color: valueColor,
        wrap: true,
        flex: 5,
        margin: "md",
      },
    ],
  };
}

function timestampRow(): FlexBox {
  return row("⏰", "時間", formatTimestamp(new Date()), COLOR.label);
}

function successBubble(notification: AdminNotification): FlexBubble {
  const bubble: FlexBubble = {
    type: "bubble",
    size: "kilo",
    header: header("🎉", "新貼圖生成成功", COLOR.successHeader),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      paddingAll: "md",
      contents: [
        row("📝", "主題", describeTheme(notification.theme)),
        row("🎨", "畫風", describeStyle(notification.styleId)),
        row("👤", "使用者", describeUser(notification)),
        timestampRow(),
      ],
    },
  };

  if (notification.imageUrl) {
    bubble.hero = {
      type: "image",
      url: notification.imageUrl,
      size: "full",
      aspectRatio: "2:3",
      aspectMode: "fit",
      action: { type: "uri", uri: notification.imageUrl },
    };
    bubble.footer = {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "md",
      contents: [
        {
          type: "button",
          style: "primary",
          color: COLOR.link,
          height: "sm",
          action: {
            type: "uri",
            label: "🖼 查看完整貼圖",
            uri: notification.imageUrl,
          },
        },
      ],
    };
  }

  return bubble;
}

function failureBubble(notification: AdminNotification): FlexBubble {
  const code = notification.errorCode ?? "internal";
  const msg = (notification.errorMessage ?? "").slice(0, MAX_ERROR_MESSAGE_LEN);

  const bodyContents: FlexComponent[] = [
    // Error code highlighted at top
    {
      type: "box",
      layout: "vertical",
      spacing: "xs",
      paddingAll: "sm",
      backgroundColor: "#FEF2F2",
      cornerRadius: "md",
      contents: [
        {
          type: "text",
          text: "🚫 錯誤代碼",
          size: "xs",
          color: COLOR.label,
        },
        {
          type: "text",
          text: code,
          size: "md",
          weight: "bold",
          color: COLOR.emphasisRed,
        },
      ],
    },
    { type: "separator", margin: "md", color: COLOR.divider },
    row("📝", "主題", describeTheme(notification.theme)),
    row("🎨", "畫風", describeStyle(notification.styleId)),
    row("👤", "使用者", describeUser(notification)),
  ];

  if (msg) {
    bodyContents.push({ type: "separator", margin: "md", color: COLOR.divider });
    bodyContents.push({
      type: "box",
      layout: "vertical",
      spacing: "xs",
      contents: [
        { type: "text", text: "💬 訊息", size: "xs", color: COLOR.label },
        { type: "text", text: msg, size: "sm", color: COLOR.value, wrap: true },
      ],
    });
  }

  bodyContents.push({ type: "separator", margin: "md", color: COLOR.divider });
  bodyContents.push(timestampRow());

  return {
    type: "bubble",
    size: "kilo",
    header: header("❌", "生成失敗", COLOR.failureHeader),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      paddingAll: "md",
      contents: bodyContents,
    },
  };
}

function verifyFailureBubble(notification: AdminNotification): FlexBubble {
  const msg =
    (notification.errorMessage ?? "").slice(0, MAX_ERROR_MESSAGE_LEN) ||
    "Gemini Vision 呼叫異常";

  return {
    type: "bubble",
    size: "kilo",
    header: header("⚠️", "文字驗證失敗", COLOR.warningHeader),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      paddingAll: "md",
      contents: [
        row("👤", "使用者", describeUser(notification)),
        { type: "separator", margin: "md", color: COLOR.divider },
        {
          type: "box",
          layout: "vertical",
          spacing: "xs",
          contents: [
            { type: "text", text: "💬 訊息", size: "xs", color: COLOR.label },
            { type: "text", text: msg, size: "sm", color: COLOR.value, wrap: true },
          ],
        },
        { type: "separator", margin: "md", color: COLOR.divider },
        timestampRow(),
      ],
    },
  };
}
