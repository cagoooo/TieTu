import { loadImage, toImageDataUrl } from "./sticker-utils";

const DB_NAME = "sticker-studio";
const DB_VERSION = 1;
const STORE_NAME = "history";
export const HISTORY_LIMIT = 5;
export const HISTORY_EVENT = "sticker-history-changed";

export interface HistoryEntry {
  id: string;
  createdAt: number;
  theme: string | null;
  texts: string[];
  sheetBase64: string;
  thumbnailDataUrl: string;
}

function isIndexedDbAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
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
    console.error("Failed to load history", error);
    return [];
  }
}

export async function addHistoryEntry(
  input: Omit<HistoryEntry, "id" | "createdAt" | "thumbnailDataUrl"> & {
    thumbnailDataUrl?: string;
  },
): Promise<HistoryEntry | null> {
  if (!isIndexedDbAvailable()) return null;
  try {
    const thumbnailDataUrl =
      input.thumbnailDataUrl ?? (await makeThumbnail(input.sheetBase64));
    const entry: HistoryEntry = {
      id: generateId(),
      createdAt: Date.now(),
      theme: input.theme,
      texts: input.texts,
      sheetBase64: input.sheetBase64,
      thumbnailDataUrl,
    };

    await withStore("readwrite", (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.add(entry);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });

    await trimHistory();
    notifyChange();
    return entry;
  } catch (error) {
    console.error("Failed to save history", error);
    return null;
  }
}

async function trimHistory() {
  const entries = await listHistory();
  if (entries.length <= HISTORY_LIMIT) return;
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
    console.error("Failed to delete history entry", error);
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
    console.error("Failed to clear history", error);
  }
}
