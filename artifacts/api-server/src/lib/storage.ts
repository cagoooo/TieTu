import { Storage, type Bucket } from "@google-cloud/storage";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { logger } from "./logger";

// Lazy singleton — Storage() picks up Application Default Credentials at
// first use, which is what Cloud Functions provides for the runtime SA
// (303602485107-compute@developer.gserviceaccount.com). Locally you'd run
// `gcloud auth application-default login` once if you ever want to test.
let _bucket: Bucket | null = null;

function getBucket(): Bucket | null {
  if (_bucket) return _bucket;
  const bucketName = process.env["STORAGE_BUCKET"]?.trim();
  if (!bucketName) return null;
  _bucket = new Storage().bucket(bucketName);
  return _bucket;
}

/**
 * Uploads a generated sticker-sheet PNG to GCS and returns a public URL.
 *
 * Returns `null` when STORAGE_BUCKET is not configured (e.g. local dev) —
 * callers should fall back to the embedded base64 in the response. Throws
 * only on hard upload failure; the api-server route catches and downgrades
 * to "base64 only" so a flaky bucket never breaks generation.
 */
export async function uploadSheetPng(buffer: Buffer): Promise<string | null> {
  const bucket = getBucket();
  if (!bucket) return null;

  // Path layout: sheets/<unix-ms>-<8-byte-random>.png
  // - sheets/ prefix matches the lifecycle rule scope.
  // - 8-byte random tail prevents collisions when two generations land in
  //   the same millisecond (rare but possible with concurrency=80).
  const id = randomBytes(8).toString("hex");
  const filename = `sheets/${Date.now()}-${id}.png`;
  const file = bucket.file(filename);

  await file.save(buffer, {
    contentType: "image/png",
    metadata: {
      // Browser + Hosting CDN can cache for 7 days; bucket lifecycle deletes
      // at 7 days too so the URL becomes 404 around that time anyway.
      cacheControl: "public, max-age=604800, immutable",
    },
    // Skip the read-after-write existence check; we just wrote it.
    validation: false,
    resumable: false,
  });

  // Bucket has uniform IAM with allUsers:objectViewer, so the canonical
  // public URL works without a signing roundtrip.
  return `https://storage.googleapis.com/${bucket.name}/${filename}`;
}

/**
 * One-line helper for the route handler — never throws, returns null on
 * any failure (logged at warn level so it shows up in Cloud Logging
 * without spamming Sentry as an error).
 */
export async function tryUploadSheetPng(buffer: Buffer): Promise<string | null> {
  try {
    return await uploadSheetPng(buffer);
  } catch (err) {
    logger.warn({ err }, "[storage] sheet upload failed; falling back to base64 only");
    return null;
  }
}
