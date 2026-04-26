import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth, signInWithGoogle, signOut } from "@/lib/firebase";

interface AuthContextValue {
  /** Currently signed-in user, or null when signed out. */
  user: User | null;
  /** True until the first onAuthStateChanged fires (initial session check). */
  loading: boolean;
  /** Trigger a Google sign-in popup. Resolves to the signed-in user. */
  signInWithGoogle: () => Promise<User>;
  /** Sign out + clear local persistence. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // onAuthStateChanged fires synchronously with null on first call when
    // there's no cached session, then again with the user once the
    // persisted session has been rehydrated. We only consider "loading"
    // done after the first event.
    const auth = getFirebaseAuth();
    const unsubscribe = onAuthStateChanged(auth, (next) => {
      setUser(next);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      signInWithGoogle,
      signOut,
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
