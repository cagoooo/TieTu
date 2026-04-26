import { useState } from "react";
import { LogIn, LogOut, Loader2, User as UserIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

/**
 * Header-corner authentication pill.
 *  - 載入中     : 小 spinner
 *  - 未登入    : 「登入」按鈕(粉色 outline 風)
 *  - 已登入    : 頭像 + 名字 dropdown,內含登出 / Email
 *
 * Phase 1 of P3-1: this only surfaces the user identity. No feature gating
 * yet — everything still works without an account. Phase 2 will route
 * IndexedDB history → Firestore so the same account can see history across
 * devices, and Phase 3 (P3-2) will gate paid tiers behind the same login.
 */
export function AuthPill() {
  const { user, loading, signInWithGoogle, signOut } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState<"signin" | "signout" | null>(null);

  const handleSignIn = async () => {
    setBusy("signin");
    try {
      const u = await signInWithGoogle();
      toast({
        title: `歡迎,${u.displayName ?? "使用者"}!`,
        description: "登入成功。歷史紀錄之後會跨裝置同步(Phase 2 規劃中)。",
      });
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      const message =
        code === "auth/popup-closed-by-user"
          ? "登入已取消。"
          : code === "auth/unauthorized-domain"
          ? "此網域尚未授權登入。請在 Firebase Console → Authentication → Settings → Authorized domains 加入。"
          : code === "auth/popup-blocked"
          ? "瀏覽器擋住了登入彈窗,請允許彈窗後再試。"
          : code === "auth/operation-not-allowed"
          ? "Google 登入尚未在 Firebase Console 啟用。請至 Authentication → Sign-in method 啟用 Google provider。"
          : err instanceof Error
          ? err.message
          : "登入失敗,請稍後再試。";
      toast({
        title: "登入失敗",
        description: message,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleSignOut = async () => {
    setBusy("signout");
    try {
      await signOut();
      toast({ title: "已登出", description: "本機歷史紀錄仍會保留。" });
    } catch (err) {
      toast({
        title: "登出失敗",
        description: err instanceof Error ? err.message : "請稍後再試。",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 px-3 h-9 rounded-full text-xs text-muted-foreground"
        data-testid="auth-loading"
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {user ? (
        <motion.div
          key="signed-in"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 rounded-full px-2 gap-2 hover:bg-primary/10"
                data-testid="auth-user-trigger"
                aria-label={`已登入 ${user.displayName ?? user.email ?? ""}`}
              >
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt=""
                    className="w-7 h-7 rounded-full border border-border"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground inline-flex items-center justify-center">
                    <UserIcon className="w-4 h-4" />
                  </span>
                )}
                <span className="text-xs font-bold max-w-[100px] truncate hidden sm:inline">
                  {user.displayName ?? user.email ?? "已登入"}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col">
                  <span className="text-sm font-bold truncate">
                    {user.displayName ?? "未命名"}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {user.email ?? ""}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleSignOut}
                disabled={busy === "signout"}
                className="text-destructive focus:text-destructive"
                data-testid="auth-signout"
              >
                {busy === "signout" ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <LogOut className="w-4 h-4 mr-2" />
                )}
                登出
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </motion.div>
      ) : (
        <motion.div
          key="signed-out"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={handleSignIn}
            disabled={busy === "signin"}
            className="h-9 rounded-full text-xs font-bold border-primary/30 text-primary hover:bg-primary/10 gap-1.5"
            data-testid="auth-signin"
          >
            {busy === "signin" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <LogIn className="w-3.5 h-3.5" />
            )}
            登入
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
