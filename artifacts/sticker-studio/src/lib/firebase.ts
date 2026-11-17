import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInWithPopup,
  signOut as fbSignOut,
  type Auth,
  type User,
} from "firebase/auth";

// ---------------------------------------------------------------------------
// Firebase Web App config — TieTu app inside the existing
// zhuyin-challenge-v3-4cd2b project.
//
// The apiKey here is a Firebase "Browser key" and is *designed to be public*
// (it ships in every Firebase Web SDK bundle). Security comes from:
//   1. Firebase Auth → Authorized Domains (only tietu.web.app + GitHub Pages
//      origins can complete sign-in)
//   2. Firestore / Storage Rules (server-side gates on read / write)
//   3. Optional HTTP referrer restrictions on the API key in GCP Console
//
// Pulled via: firebase apps:sdkconfig WEB 1:303602485107:web:79a2106da186bc98c4e706
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "__FIREBASE_API_KEY__",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "__FIREBASE_AUTH_DOMAIN__",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "__FIREBASE_PROJECT_ID__",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "__FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "__FIREBASE_MESSAGING_SENDER_ID__",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "__FIREBASE_APP_ID__",
} as const;

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!_app) {
    _app = initializeApp(firebaseConfig);
  }
  return _app;
}

export function getFirebaseAuth(): Auth {
  if (!_auth) {
    _auth = getAuth(getFirebaseApp());
    // Persist the session across browser restarts so users don't have to
    // sign in every visit. Falls back to in-memory if local storage is
    // unavailable (e.g. cookies disabled).
    void setPersistence(_auth, browserLocalPersistence).catch(() => undefined);
  }
  return _auth;
}

export async function signInWithGoogle(): Promise<User> {
  // App 內建瀏覽器（LINE／FB 等）：Google 禁止在此登入（403 disallowed_useragent）。
  // 頁首防護會自動跳轉／引導；使用者按「先不登入，繼續瀏覽」後又按登入時，在這裡再提醒一次，不開登入視窗。
  if (/FBAN|FBAV|FB_IAB|Instagram|Messenger|MicroMessenger|KAKAOTALK|\bLine\//i.test(navigator.userAgent || '')) {
    try { window.alert('您目前在 App 內建瀏覽器（LINE／FB 等）中，Google 基於安全政策禁止在此登入。\n\n請點右上／右下角「⋯」→ 選「用預設瀏覽器開啟」後再登入。'); } catch { }
    // 回傳型別是 User，無法回 null；丟出「使用者取消」錯誤碼，呼叫端（auth-pill.tsx）當成登入取消。
    throw Object.assign(new Error("in-app-browser"), { code: "auth/popup-closed-by-user" });
  }
  const provider = new GoogleAuthProvider();
  // Always show the account chooser so users on shared computers can pick
  // a different Google account if needed.
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(getFirebaseAuth(), provider);
  return result.user;
}

export async function signOut(): Promise<void> {
  await fbSignOut(getFirebaseAuth());
}

export type { User };
