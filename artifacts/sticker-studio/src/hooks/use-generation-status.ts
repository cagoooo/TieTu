import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";

export interface GenerationStatus {
  /** 後端說 AI 生圖暫停中 */
  paused: boolean;
  /** 暫停時給使用者看的說明 */
  message: string | null;
}

/**
 * 讀 GET /api/stickers/status（公開、不用登入），知道 AI 生圖是否暫停。
 * 讀不到就當作沒暫停——按下生成時後端仍會把關。
 */
export function useGenerationStatus(): GenerationStatus {
  const [status, setStatus] = useState<GenerationStatus>({ paused: false, message: null });

  useEffect(() => {
    let alive = true;
    customFetch<{ generationPaused?: boolean; message?: string | null }>("/api/stickers/status", {
      method: "GET",
    })
      .then((data) => {
        if (!alive) return;
        setStatus({ paused: data?.generationPaused === true, message: data?.message ?? null });
      })
      .catch(() => {
        /* 讀不到維持預設 */
      });
    return () => {
      alive = false;
    };
  }, []);

  return status;
}
