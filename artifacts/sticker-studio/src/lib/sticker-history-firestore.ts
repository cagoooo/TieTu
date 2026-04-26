import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { getFirebaseApp } from "./firebase";
import type { HistoryEntry } from "./sticker-history";

// Firestore document layout (Phase 2B):
//   /users/{uid}/tietu_history/{entryId}
// Doc fields match HistoryEntry minus the runtime-only `id` (which is the
// Firestore doc id) and minus `sheetBase64` (we never store the multi-MB
// PNG; the user fetches it back via imageUrl on history reopen — same
// strategy IndexedDB is using since P2-2). thumbnailDataUrl IS stored so
// the history grid can render instantly without a network roundtrip.
const PER_USER_HISTORY_LIMIT = 5;
const HISTORY_SUBCOLLECTION = "tietu_history";

interface FirestoreHistoryDoc {
  createdAt: number;
  theme: string | null;
  texts: string[];
  thumbnailDataUrl: string;
  imageUrl?: string;
  styleId?: string;
}

function userHistoryCol(uid: string) {
  const db = getFirestore(getFirebaseApp());
  return collection(db, "users", uid, HISTORY_SUBCOLLECTION);
}

export async function listFirestoreHistory(uid: string): Promise<HistoryEntry[]> {
  const q = query(
    userHistoryCol(uid),
    orderBy("createdAt", "desc"),
    limit(PER_USER_HISTORY_LIMIT * 2), // fetch a few extra so trim still works
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => {
    const data = d.data() as FirestoreHistoryDoc;
    return {
      id: d.id,
      createdAt: data.createdAt,
      theme: data.theme,
      texts: data.texts,
      // sheetBase64 is intentionally empty for Firestore-backed entries —
      // home.tsx's handleOpenHistory will fetch the imageUrl on demand.
      sheetBase64: "",
      thumbnailDataUrl: data.thumbnailDataUrl,
      ...(data.imageUrl ? { imageUrl: data.imageUrl } : {}),
    } satisfies HistoryEntry;
  });
}

export async function addFirestoreHistory(
  uid: string,
  input: {
    theme: string | null;
    texts: string[];
    thumbnailDataUrl: string;
    imageUrl?: string;
    styleId?: string;
  },
): Promise<HistoryEntry> {
  // Use a client-generated id so the SPA can optimistically render the new
  // entry before the round-trip lands.
  const id = generateId();
  const docRef = doc(userHistoryCol(uid), id);
  const docData: FirestoreHistoryDoc = {
    createdAt: Date.now(),
    theme: input.theme,
    texts: input.texts,
    thumbnailDataUrl: input.thumbnailDataUrl,
    ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
    ...(input.styleId ? { styleId: input.styleId } : {}),
  };
  await setDoc(docRef, docData);

  // Trim oldest entries past the per-user limit. Best-effort — failing to
  // trim doesn't break the create.
  void trimFirestoreHistory(uid).catch(() => undefined);

  return {
    id,
    createdAt: docData.createdAt,
    theme: input.theme,
    texts: input.texts,
    sheetBase64: "",
    thumbnailDataUrl: input.thumbnailDataUrl,
    ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
  };
}

export async function deleteFirestoreHistory(uid: string, entryId: string): Promise<void> {
  await deleteDoc(doc(userHistoryCol(uid), entryId));
}

export async function clearFirestoreHistory(uid: string): Promise<void> {
  const snapshot = await getDocs(userHistoryCol(uid));
  if (snapshot.empty) return;
  // Firestore batch limit is 500 ops; per-user history caps at 5 so this
  // is fine without chunking.
  const batch = writeBatch(getFirestore(getFirebaseApp()));
  snapshot.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

async function trimFirestoreHistory(uid: string): Promise<number> {
  const snapshot = await getDocs(
    query(userHistoryCol(uid), orderBy("createdAt", "desc")),
  );
  if (snapshot.size <= PER_USER_HISTORY_LIMIT) return 0;
  const toDelete = snapshot.docs.slice(PER_USER_HISTORY_LIMIT);
  const batch = writeBatch(getFirestore(getFirebaseApp()));
  toDelete.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return toDelete.length;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
