import type { Request, Response, NextFunction, RequestHandler } from "express";
import { logger } from "../lib/logger";

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface TurnstileVerifyResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
}

interface VerifyTurnstileOptions {
  /**
   * Field on the JSON body that carries the Turnstile token. Falls back to
   * the `X-Turnstile-Token` header when absent.
   */
  bodyField?: string;
  /**
   * Override the secret used for verification. Defaults to
   * `process.env.TURNSTILE_SECRET_KEY`. When neither this nor the env var is
   * configured, verification is skipped (and a warning is logged once on
   * startup) so local development continues to work without Cloudflare creds.
   */
  secret?: string | (() => string | undefined);
  /**
   * Override the verify endpoint (used by tests).
   */
  verifyUrl?: string;
}

let warnedNoSecret = false;

function resolveSecret(secret: VerifyTurnstileOptions["secret"]): string | undefined {
  if (typeof secret === "function") return secret();
  if (typeof secret === "string" && secret.length > 0) return secret;
  return process.env["TURNSTILE_SECRET_KEY"];
}

function readToken(req: Request, bodyField: string): string | null {
  const body = req.body as Record<string, unknown> | undefined;
  const fromBody = body && typeof body[bodyField] === "string" ? (body[bodyField] as string) : null;
  if (fromBody && fromBody.trim().length > 0) return fromBody.trim();
  const header = req.header("x-turnstile-token");
  if (header && header.trim().length > 0) return header.trim();
  return null;
}

function clientIp(req: Request): string | undefined {
  // `req.ip` honours the configured `trust proxy` setting.
  return req.ip || req.socket?.remoteAddress || undefined;
}

export function verifyTurnstile(options: VerifyTurnstileOptions = {}): RequestHandler {
  const bodyField = options.bodyField ?? "turnstileToken";
  const verifyUrl = options.verifyUrl ?? TURNSTILE_VERIFY_URL;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const secret = resolveSecret(options.secret);

    if (!secret) {
      if (!warnedNoSecret) {
        warnedNoSecret = true;
        logger.warn(
          "TURNSTILE_SECRET_KEY is not set — captcha verification is DISABLED. Set it in production to block automated abuse.",
        );
      }
      next();
      return;
    }

    const token = readToken(req, bodyField);
    if (!token) {
      logger.warn({ ip: clientIp(req) }, "Turnstile token missing");
      res.status(403).json({
        error: "請先完成人機驗證再送出生成請求。",
      });
      return;
    }

    const params = new URLSearchParams();
    params.set("secret", secret);
    params.set("response", token);
    const ip = clientIp(req);
    if (ip) params.set("remoteip", ip);

    let result: TurnstileVerifyResponse;
    try {
      const upstream = await fetch(verifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      result = (await upstream.json()) as TurnstileVerifyResponse;
    } catch (err) {
      logger.error({ err }, "Turnstile verification request failed");
      res.status(503).json({
        error: "人機驗證服務暫時無法連線，請稍後再試一次。",
      });
      return;
    }

    if (!result.success) {
      const codes = result["error-codes"] ?? [];
      logger.warn(
        { ip, codes },
        "Turnstile verification rejected",
      );
      const expired = codes.some((c) =>
        c === "timeout-or-duplicate" || c === "invalid-input-response",
      );
      res.status(403).json({
        error: expired
          ? "人機驗證已過期，請重新驗證後再送出。"
          : "人機驗證未通過，請重新整理頁面後再試一次。",
      });
      return;
    }

    next();
  };
}
