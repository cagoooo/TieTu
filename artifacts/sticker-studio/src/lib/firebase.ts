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
  apiKey: "AIzaSyACBFKgIWgpHIq_CbvYU564xTzhHNBxOpk",
  authDomain: "zhuyin-challenge-v3-4cd2b.firebaseapp.com",
  projectId: "zhuyin-challenge-v3-4cd2b",
  storageBucket: "zhuyin-challenge-v3-4cd2b.firebasestorage.app",
  messagingSenderId: "303602485107",
  appId: "1:303602485107:web:79a2106da186bc98c4e706",
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
