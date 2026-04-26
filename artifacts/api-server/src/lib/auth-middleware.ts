import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import type { Request, RequestHandler } from "express";
import { logger } from "./logger";

// Symbol-keyed slot on req so we don't collide with anything else mutating
// the request and don't have to fight TS module-augmentation across the
// firebase-admin / @types/express duplicated dependency tree.
const TIETU_USER_KEY = Symbol.for("tietu.firebaseUser");

interface RequestWithUser {
  [TIETU_USER_KEY]?: DecodedIdToken;
}

/** Read the verified Firebase user from a request, if attachFirebaseUser ran
 *  and the client supplied a valid ID token. Undefined for guest requests. */
export function getRequestUser(req: Request): DecodedIdToken | undefined {
  return (req as unknown as RequestWithUser)[TIETU_USER_KEY];
}

function setRequestUser(req: Request, user: DecodedIdToken): void {
  (req as unknown as RequestWithUser)[TIETU_USER_KEY] = user;
}

// Idempotent firebase-admin init — Cloud Functions provides Application
// Default Credentials via the runtime SA, so we don't need a service account
// JSON locally either (just `gcloud auth application-default login` once).
function ensureAdminApp(): void {
  if (getApps().length === 0) {
    try {
      initializeApp({ credential: applicationDefault() });
    } catch (err) {
      logger.warn({ err }, "[auth] firebase-admin init failed; ID token verification will be disabled");
    }
  }
}

/**
 * Express middleware that *opportunistically* attaches the verified Firebase
 * user to req.user when the client sent a valid `Authorization: Bearer <id>`
 * header. Anonymous requests (no header / invalid token) pass through with
 * req.user undefined — the callers decide whether to gate features.
 *
 * Why opportunistic vs strict: the SPA must keep working without an account
 * (Plan A). When the user is signed in we *do* want to log uid + tag GCS
 * uploads to them, but we never want to 401 a guest who's allowed to
 * generate stickers anonymously.
 */
export function attachFirebaseUser(): RequestHandler {
  ensureAdminApp();
  return async (req, _res, next) => {
    const header =
      req.header("authorization") ?? req.header("Authorization") ?? "";
    if (!header.startsWith("Bearer ")) {
      return next();
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token) return next();

    try {
      const decoded = await getAuth().verifyIdToken(token);
      setRequestUser(req, decoded);
    } catch (err) {
      // Bad / expired / forged token — degrade to anonymous, never 401.
      // We log at debug level so production noise stays low; bump to warn
      // if you start seeing token forgery patterns.
      logger.debug(
        { err: err instanceof Error ? err.message : err },
        "[auth] ID token verification failed; treating request as anonymous",
      );
    }
    next();
  };
}
