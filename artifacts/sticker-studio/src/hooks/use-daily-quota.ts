import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { customFetch } from "@workspace/api-client-react";

/** 每個帳號每天能生成幾次（以後端回傳為準，這裡只是還沒查到時的預設值） */
export const DEFAULT_DAILY_LIMIT = 3;

export interface DailyQuota {
  /** 今天還能生成幾次；null＝還沒查到（沒登入或讀取中） */
  remaining: number | null;
  limit: number;
  refresh: () => void;
  /** 生成成功／失敗後用後端回傳的值直接更新，不必再查一次 */
  setRemaining: (n: number) => void;
}

/**
 * 讀「今天還可以生成幾次」（GET /api/stickers/quota，只查不扣）。
 * 登入狀態改變、切回分頁（可能跨過台北午夜）都會重新查。
 */
export function useDailyQuota(user: User | null): DailyQuota {
  const [remaining, setRemainingState] = useState<number | null>(null);
  const [limit, setLimit] = useState(DEFAULT_DAILY_LIMIT);
  const uid = user && !user.isAnonymous ? user.uid : null;
  const seq = useRef(0);

  const refresh = useCallback(() => {
    if (!uid) {
      setRemainingState(null);
      return;
    }
    const mine = ++seq.current;
    customFetch<{ dailyLimit: number; dailyRemaining: number }>("/api/stickers/quota", {
      method: "GET",
    })
      .then((data) => {
        if (mine !== seq.current) return;
        if (typeof data?.dailyLimit === "number") setLimit(data.dailyLimit);
        if (typeof data?.dailyRemaining === "number") setRemainingState(data.dailyRemaining);
      })
      .catch(() => {
        /* 讀不到就維持原本顯示，按下生成時後端仍會把關 */
      });
  }, [uid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const setRemaining = useCallback((n: number) => {
    seq.current++; // 讓還在路上的舊查詢結果作廢
    setRemainingState(Math.max(0, n));
  }, []);

  return { remaining: uid ? remaining : null, limit, refresh, setRemaining };
}
