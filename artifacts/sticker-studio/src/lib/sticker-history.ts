import { loadImage, toImageDataUrl } from "./sticker-utils";

const DB_NAME = "sticker-studio";
const DB_VERSION = 1;
const STORE_NAME = "history";
export const HISTORY_LIMIT = 5;
export const HISTORY_EVENT = "sticker-history-changed";
export const HISTORY_STORAGE_NOTICE_EVENT = "sticker-history-storage-notice";

const SHEET_MAX_DIMENSION = 1280;
const SHEET_JPEG_QUALITY = 0.85;
// Per the task spec we evict the oldest entry then retry once. A single retry
// is enough in practice because the new entry is already aggressively
// compressed before this point, and being more aggressive would silently throw
// away large chunks of the user's history.
const QUOTA_RETRY_LIMIT = 1;

export interface HistoryEntry {
  id: string;
  createdAt: number;
  theme: string | null;
  texts: string[];
  /**
   * Compressed JPEG of the sheet (~100–300 KB) embedded as a data URL.
   * Empty string when {@link imageUrl} is present — that means the full
   * sheet lives in GCS and we re-download on demand to save IndexedDB space.
   */
  sheetBase64: string;
  thumbnailDataUrl: string;
  /**
   * Optional public CDN URL of the original sheet PNG (multi-MB).
   * When present, the entry skips storing the compressed JPEG and
   * sticker-result re-fetches this URL on history reopen.
   * URL expires after 7 days (bucket lifecycle); reopens after that
   * fall back to a "請重新生成" toast in home.tsx.
   */
  imageUrl?: string;
}

export type HistoryStorageNoticeKind = "evicted" | "quota-exceeded" | "save-failed";

export interface HistoryStorageNotice {
  kind: HistoryStorageNoticeKind;
  evictedCount?: number;
}

export interface AddHistoryResult {
  status: "saved" | "saved-after-eviction" | "quota-exceeded" | "unsupported" | "error";
  entry: HistoryEntry | null;
  evictedCount: number;
}

function isIndexedDbAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function isQuotaExceededError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException) {
    return (
      error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      // Legacy/edge spec codes
      error.code === 22 ||
      error.code === 1014
    );
  }
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name?: string }).name;
    return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
  }
  return false;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        let result: T;
        Promise.resolve(fn(store))
          .then((value) => {
            result = value;
          })
          .catch(reject);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

function notifyChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(HISTORY_EVENT));
  }
}

function notifyStorageNotice(notice: HistoryStorageNotice) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<HistoryStorageNotice>(HISTORY_STORAGE_NOTICE_EVENT, {
      detail: notice,
    }),
  );
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function makeThumbnail(
  sheetBase64: string,
  maxSize = 320,
): Promise<string> {
  const img = await loadImage(sheetBase64);
  const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * ratio));
  const h = Math.max(1, Math.round(img.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return toImageDataUrl(sheetBase64);
  }
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.78);
}

/**
 * Compress the full sticker sheet for long-term storage. Converts the
 * original (potentially multi-megabyte) PNG to a resized JPEG so the entry
 * fits comfortably within the browser's IndexedDB quota.
 */
export async function compressSheetForStorage(
  sheetBase64: string,
  maxDimension = SHEET_MAX_DIMENSION,
  quality = SHEET_JPEG_QUALITY,
): Promise<string> {
  try {
    const img = await loadImage(sheetBase64);
    const longEdge = Math.max(img.width, img.height);
    const ratio = longEdge > 0 ? Math.min(1, maxDimension / longEdge) : 1;
    const w = Math.max(1, Math.round(img.width * ratio));
    const h = Math.max(1, Math.round(img.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return toImageDataUrl(sheetBase64);
    }
    // Flatten transparency onto white so JPEG output stays clean.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } catch (error) {
    console.warn(
      "[sticker-history] Failed to compress sheet for storage, falling back to original",
      error,
    );
    return toImageDataUrl(sheetBase64);
  }
}

export async function listHistory(): Promise<HistoryEntry[]> {
  if (!isIndexedDbAvailable()) return [];
  try {
    const entries = await withStore("readonly", (store) => {
      return new Promise<HistoryEntry[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as HistoryEntry[]) ?? []);
        req.onerror = () => reject(req.error);
      });
    });
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  } catch (error) {
    console.error("[sticker-history] Failed to load history", error);
    return [];
  }
}

function putEntry(entry: HistoryEntry): Promise<void> {
  return withStore("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const req = store.add(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

async function evictOldestEntry(): Promise<boolean> {
  const entries = await listHistory();
  if (entries.length === 0) return false;
  const oldest = entries[entries.length - 1];
  try {
    await withStore("readwrite", (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.delete(oldest.id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
    return true;
  } catch (error) {
    console.error(
      "[sticker-history] Failed to evict oldest entry while freeing space",
      error,
    );
    return false;
  }
}

export async function addHistoryEntry(
  input: Omit<HistoryEntry, "id" | "createdAt" | "thumbnailDataUrl"> & {
    thumbnailDataUrl?: string;
  },
): Promise<AddHistoryResult> {
  if (!isIndexedDbAvailable()) {
    return { status: "unsupported", entry: null, evictedCount: 0 };
  }
  let entry: HistoryEntry;
  try {
    // When the api-server included a public GCS URL we skip storing the
    // multi-MB JPEG copy in IndexedDB — the URL is < 100 bytes and the
    // bucket has a 7-day lifecycle so the data eventually self-deletes.
    // The thumbnail is *always* stored (it's only ~50 KB) so the history
    // panel can render instantly without a network request.
    const useRemote = typeof input.imageUrl === "string" && input.imageUrl.length > 0;
    const compressedSheet = useRemote
      ? ""
      : await compressSheetForStorage(input.sheetBase64);
    const thumbnailDataUrl =
      input.thumbnailDataUrl ??
      (await makeThumbnail(useRemote ? input.sheetBase64 : compressedSheet));
    entry = {
      id: generateId(),
      createdAt: Date.now(),
      theme: input.theme,
      texts: input.texts,
      sheetBase64: compressedSheet,
      thumbnailDataUrl,
      ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
    };
  } catch (error) {
    console.error(
      "[sticker-history] Failed to prepare history entry for storage",
      error,
    );
    notifyStorageNotice({ kind: "save-failed" });
    return { status: "error", entry: null, evictedCount: 0 };
  }

  let evictedCount = 0;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= QUOTA_RETRY_LIMIT; attempt += 1) {
    try {
      await putEntry(entry);
      try {
        evictedCount += await trimHistory();
      } catch (trimError) {
        console.warn(
          "[sticker-history] Saved entry but trimming history failed",
          trimError,
        );
      }
      notifyChange();
      if (evictedCount > 0) {
        notifyStorageNotice({ kind: "evicted", evictedCount });
        return {
          status: "saved-after-eviction",
          entry,
          evictedCount,
        };
      }
      return { status: "saved", entry, evictedCount: 0 };
    } catch (error) {
      lastError = error;
      if (!isQuotaExceededError(error)) {
        break;
      }
      console.warn(
        `[sticker-history] Quota exceeded saving history (attempt ${attempt + 1}); evicting oldest entry to free space.`,
        error,
      );
      const evicted = await evictOldestEntry();
      if (!evicted) {
        // Nothing left to free; further retries will not help.
        break;
      }
      evictedCount += 1;
    }
  }

  if (isQuotaExceededError(lastError)) {
    console.error(
      "[sticker-history] Browser storage is full; could not save the latest sticker history entry even after freeing space.",
      lastError,
    );
    notifyStorageNotice({ kind: "quota-exceeded", evictedCount });
    if (evictedCount > 0) {
      // Make sure listeners refresh after we removed older entries.
      notifyChange();
    }
    return { status: "quota-exceeded", entry: null, evictedCount };
  }

  console.error("[sticker-history] Failed to save history entry", lastError);
  notifyStorageNotice({ kind: "save-failed" });
  return { status: "error", entry: null, evictedCount };
}

async function trimHistory(): Promise<number> {
  const entries = await listHistory();
  if (entries.length <= HISTORY_LIMIT) return 0;
  const excess = entries.slice(HISTORY_LIMIT);
  await withStore("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      let remaining = excess.length;
      if (remaining === 0) {
        resolve();
        return;
      }
      excess.forEach((entry) => {
        const req = store.delete(entry.id);
        req.onsuccess = () => {
          remaining -= 1;
          if (remaining === 0) resolve();
        };
        req.onerror = () => reject(req.error);
      });
    });
  });
  return excess.length;
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    await withStore("readwrite", (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
    notifyChange();
  } catch (error) {
    console.error("[sticker-history] Failed to delete history entry", error);
  }
}

export async function clearHistory(): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    await withStore("readwrite", (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
    notifyChange();
  } catch (error) {
    console.error("[sticker-history] Failed to clear history", error);
  }
}
