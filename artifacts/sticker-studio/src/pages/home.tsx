import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Heart, Upload, Brain, Wand2, Loader2, Github, ExternalLink } from "lucide-react";
import { StickerGenerator, type StickerGeneratorHandle } from "@/components/sticker-generator";
import { StickerHistory } from "@/components/sticker-history";
import { AuthPill } from "@/components/auth-pill";
import { Carton } from "@/components/gacha/carton";
import { GachaLoading } from "@/components/gacha/loading-machine";
import { useGenerateStickerSheet, ApiError } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { addHistoryEntry, type HistoryEntry } from "@/lib/sticker-history";
import { useStickerHistoryStorageNotices } from "@/hooks/use-sticker-history-storage";
import { DEFAULT_TEXTS, type StickerStyleId } from "@/lib/sticker-utils";
import { GeminiSkillCard } from "@/components/gemini-skill-card";
import { useAuth } from "@/hooks/use-auth";
import { useDailyQuota } from "@/hooks/use-daily-quota";
import { useGenerationStatus } from "@/hooks/use-generation-status";
import { IN_APP_BROWSER_SIGNIN_CODE } from "@/lib/firebase";

// Code-split the entire result-screen subtree (sticker-result + cropper +
// lightbox + tile editor + line export dialog). Upload-only users never
// download this code. The import promise is also kicked off pre-emptively
// in handleGenerate(...) so the chunk lands while the AI runs (30–90s),
// keeping the upload→result transition snappy.
const StickerResult = lazy(() =>
  import("@/components/sticker-result").then((m) => ({ default: m.StickerResult })),
);

function preloadResultChunk(): void {
  // Best-effort prefetch — failure here is fine, real Suspense path will
  // re-import on render.
  void import("@/components/sticker-result").catch(() => undefined);
}

function ResultLoadingFallback() {
  return (
    <div className="w-full flex flex-col items-center justify-center py-20">
      <div className="relative w-20 h-20 mb-6">
        <div className="absolute inset-0 border-4 border-primary/20 rounded-full animate-ping" style={{ animationDuration: "2s" }} />
        <div className="absolute inset-2 bg-primary/10 rounded-full flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">正在載入編輯介面…</p>
    </div>
  );
}

type AppState = "upload" | "loading" | "result";

// Synthetic generation stages for the loading screen. Gemini doesn't expose
// real-time progress, so we time these against the typical 30–90s wallclock
// observed in production and let the progress bar climb to 95% asymptotically
// (the last 5% lands when the response actually arrives).
const STAGES = [
  { id: "uploading",  label: "上傳照片中",   icon: Upload,   sec: 2 },
  { id: "thinking",   label: "AI 分析五官",  icon: Brain,    sec: 8 },
  { id: "generating", label: "生成 24 張貼圖", icon: Sparkles, sec: 50 },
  { id: "polishing",  label: "最後潤飾",     icon: Wand2,    sec: 10 },
] as const;
const TOTAL_ESTIMATE_SEC = STAGES.reduce((s, st) => s + st.sec, 0); // 70s
const PROGRESS_CEILING = 95; // the last 5% comes from the actual response

export default function Home() {
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const uid = user?.uid ?? null;
  const signedIn = Boolean(user && !user.isAnonymous);
  const quota = useDailyQuota(user);
  const generation = useGenerationStatus();
  const [appState, setAppState] = useState<AppState>("upload");
  const [sheetBase64, setSheetBase64] = useState<string | null>(null);
  const [currentTexts, setCurrentTexts] = useState<string[]>([]);
  // N3: keep the metadata around so the result page's "分享" button knows the
  // theme + style + Cloud Storage URL of the current sheet without us having
  // to thread it through the API response again on the share request.
  const [currentTheme, setCurrentTheme] = useState<string | null>(null);
  const [currentStyleId, setCurrentStyleId] = useState<StickerStyleId>("pop-mart-3d");
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);
  // 盲盒改版：把使用者上傳的大頭照（data URL）留著，loading 扭蛋機把它貼成投幣。
  const [currentPhoto, setCurrentPhoto] = useState<string | null>(null);
  const [loadingHints, setLoadingHints] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const loadingStartRef = useRef<number | null>(null);

  const { toast } = useToast();
  const generateMutation = useGenerateStickerSheet();
  const generatorRef = useRef<StickerGeneratorHandle>(null);

  useStickerHistoryStorageNotices();

  const hints = [
    "正在分析你的完美角度...",
    "捏捏臉頰，加上 Q 版魔法...",
    "畫上粗白邊，看起來更立體！",
    "填上專屬文字...",
    "快好了快好了，打個蝴蝶結...",
    "最後的魔法點綴 ✨..."
  ];

  // Tick a 100ms timer while loading so the progress bar / stage indicator
  // can do their thing. Stops automatically when appState leaves "loading".
  useEffect(() => {
    if (appState !== "loading") {
      loadingStartRef.current = null;
      setElapsedSec(0);
      return;
    }
    loadingStartRef.current = Date.now();
    setElapsedSec(0);
    const id = window.setInterval(() => {
      if (loadingStartRef.current === null) return;
      setElapsedSec((Date.now() - loadingStartRef.current) / 1000);
    }, 100);
    return () => window.clearInterval(id);
  }, [appState]);

  const handleRequestSignIn = async () => {
    try {
      const u = await signInWithGoogle();
      toast({
        title: `歡迎，${u.displayName ?? "使用者"}！`,
        description: `登入成功，每個帳號每天可以生成 ${quota.limit} 次。`,
      });
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      // App 內建瀏覽器：已跳提醒改用瀏覽器開啟，不是登入失敗
      if (code === IN_APP_BROWSER_SIGNIN_CODE || code === "auth/popup-closed-by-user") return;
      toast({
        title: "登入失敗",
        description:
          code === "auth/popup-blocked"
            ? "瀏覽器擋住了登入視窗，請允許彈出視窗後再試。"
            : "請稍後再試一次。",
        variant: "destructive",
      });
    }
  };

  const handleGenerate = (
    photoBase64: string,
    theme: string | null,
    texts: string[],
    turnstileToken: string | null,
    style: StickerStyleId,
  ) => {
    setAppState("loading");
    setCurrentTexts(texts);
    setCurrentTheme(theme);
    setCurrentStyleId(style);
    setCurrentPhoto(photoBase64); // 投幣動畫用
    setCurrentImageUrl(null); // reset until /generate returns the GCS URL

    // Race the result-page chunk against the 30–90s Gemini call. By the time
    // generateMutation resolves the chunk is almost certainly cached.
    preloadResultChunk();

    // Cycle hints
    const hintInterval = setInterval(() => {
      setLoadingHints(prev => (prev + 1) % hints.length);
    }, 5000);

    // `style` is not in the auto-generated zod schema (we deliberately
    // skipped re-running orval codegen for this small additive change).
    // The api-server reads it directly off req.body, so we cast through
    // unknown to satisfy TS.
    generateMutation.mutate(
      { data: { photoBase64, theme, texts, turnstileToken, style } as unknown as Parameters<typeof generateMutation.mutate>[0]["data"] },
      {
        onSuccess: (data) => {
          clearInterval(hintInterval);
          setSheetBase64(data.imageBase64);
          setAppState("result");
          // Captcha tokens are single-use; reset for next generation.
          generatorRef.current?.resetCaptcha();
          toast({
            title: "生成成功！🎉",
            description: "你的專屬 3D Q版貼圖已經準備好囉！",
          });
          // imageUrl is added by api-server when GCS upload succeeds
          // (P2-2). The auto-generated zod schema doesn't yet know about
          // it — read defensively via cast.
          const imageUrl = (data as { imageUrl?: string }).imageUrl;
          setCurrentImageUrl(imageUrl ?? null);
          const left = (data as { dailyRemaining?: number }).dailyRemaining;
          if (typeof left === "number") quota.setRemaining(left);
          else quota.refresh();
          addHistoryEntry(
            {
              theme,
              texts,
              sheetBase64: data.imageBase64,
              imageUrl,
            },
            uid,
          ).catch((err) =>
            console.error("[home] Failed to add history", err),
          );
        },
        onError: (error) => {
          clearInterval(hintInterval);
          setAppState("upload");
          // Always reset the captcha after a failed attempt — the token is
          // either consumed (single-use) or invalid, so the user needs a
          // fresh challenge before retrying.
          generatorRef.current?.resetCaptcha();

          // 以後端記帳為準：成功、失敗退回、被擋都更新一次剩餘次數
          const errData =
            error instanceof ApiError
              ? (error.data as { dailyRemaining?: number; refunded?: boolean; code?: string } | null)
              : null;
          if (typeof errData?.dailyRemaining === "number") quota.setRemaining(errData.dailyRemaining);
          else quota.refresh();
          const refundNote = errData?.refunded ? "（這次沒有扣掉今天的次數）" : "";

          if (error instanceof ApiError && error.status === 401) {
            const data = error.data as { error?: string } | null;
            toast({
              title: "請先用 Google 帳號登入",
              description: data?.error ?? "登入後才能生成貼圖。",
              variant: "destructive",
            });
            return;
          }

          if (error instanceof ApiError && error.status === 403) {
            const data = error.data as { error?: string } | null;
            toast({
              title: "請完成人機驗證",
              description:
                data?.error ??
                "人機驗證未通過或已過期，請重新驗證後再試一次。",
              variant: "destructive",
            });
            return;
          }

          if (error instanceof ApiError && error.status === 429) {
            const data = error.data as
              | {
                  error?: string;
                  scope?: "minute" | "day";
                  retryAfterSeconds?: number;
                }
              | null;
            const scope = data?.scope;
            const description =
              data?.error ??
              "目前生成需求很多，請稍等一下再試一次。";
            toast({
              title:
                errData?.code === "quota/daily-limit"
                  ? `今天的 ${quota.limit} 次用完囉`
                  : scope === "day"
                  ? "今天的額度用完囉"
                  : "生成太頻繁啦",
              description,
              variant: "destructive",
            });
            return;
          }

          // Classified errors from the api-server — see api-server/src/routes/
          // stickers.ts (StickerGenerationError mapping). Pick a title +
          // description per code so the user sees an actionable message
          // instead of one generic "生成失敗".
          if (error instanceof ApiError) {
            const data = error.data as
              | { error?: string; code?: string }
              | null;
            const code = data?.code ?? "";
            const serverMsg = data?.error;

            const titleByCode: Record<string, string> = {
              safety_block: "AI 拒絕了這張照片",
              billing_required: "AI 生圖服務暫停中",
              generation_paused: "AI 生圖暫停中",
              quota_exhausted: "今天 AI 額度用完了",
              model_not_found: "AI 模型暫時無法使用",
              max_tokens: "AI 輸出被截斷",
              no_image: "AI 沒輸出圖片",
              network: "AI 服務連線異常",
            };
            const title = titleByCode[code];
            if (title && serverMsg) {
              toast({
                title,
                description: serverMsg + refundNote,
                variant: "destructive",
                duration: 8000, // longer than default — these messages are dense
              });
              return;
            }
          }

          toast({
            title: "生成失敗",
            description: "抱歉，魔法暫時失靈了，請稍後再試！" + refundNote,
            variant: "destructive",
          });
        }
      }
    );
  };

  /** 使用者上傳自己用 Gemini 畫好的貼圖表 → 直接進結果頁切圖（不呼叫 AI） */
  const handleSheetUploaded = (dataUrl: string) => {
    preloadResultChunk();
    setSheetBase64(dataUrl);
    setCurrentTexts([...DEFAULT_TEXTS]);
    setCurrentTheme(null);
    setCurrentStyleId("pop-mart-3d");
    setCurrentImageUrl(null);
    setAppState("result");
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleBack = () => {
    setAppState("upload");
    setSheetBase64(null);
  };

  const handleOpenHistory = async (entry: HistoryEntry) => {
    // Prefer the GCS URL when present (P2-2): the IndexedDB entry doesn't
    // carry the full sheet bytes, only the thumbnail + this URL. We fetch
    // the original PNG and turn it into a data URL so sticker-result's
    // loadImage() works the same as for fresh generations.
    let sheet = entry.sheetBase64;
    if (entry.imageUrl) {
      try {
        const response = await fetch(entry.imageUrl, {
          mode: "cors",
          cache: "force-cache",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        sheet = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        console.error("[home] Failed to fetch history sheet from GCS", err);
        if (!entry.sheetBase64) {
          // No URL fetch + no local copy → can't recover; tell the user.
          toast({
            title: "歷史貼圖已過期",
            description: "雲端儲存最多保留 7 天,這份貼圖已被自動清除。請重新生成一組。",
            variant: "destructive",
          });
          return;
        }
        // Else fall through and use the local sheetBase64 fallback.
      }
    }
    setSheetBase64(sheet);
    setCurrentTexts(entry.texts);
    setCurrentTheme(entry.theme ?? null);
    setCurrentStyleId(((entry as { styleId?: StickerStyleId }).styleId ?? "pop-mart-3d") as StickerStyleId);
    setCurrentImageUrl(entry.imageUrl ?? null);
    setAppState("result");
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // 步驟 ribbon 綁定 AppState：投幣設定 0 / 轉動生成 1 / 開盒收圖 2。
  const stepIndex = appState === "upload" ? 0 : appState === "loading" ? 1 : 2;

  return (
    <div className="gacha-page-bg min-h-[100dvh] w-full overflow-x-hidden selection:bg-coral/20">
      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1200px] flex-col px-3 py-6 sm:px-5 sm:py-10">
        <Carton step={stepIndex} authSlot={<AuthPill />}>
          <AnimatePresence mode="wait">
            
            {appState === "upload" && (
              <motion.div
                key="upload"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3 }}
                className="w-full"
              >
                {generation.paused && (
                  <div
                    role="status"
                    data-testid="generation-paused-banner"
                    className="mb-5 flex items-start gap-3 rounded-[18px] border-[3px] border-ink bg-[#FFF4D6] px-4 py-3 text-ink sm:items-center sm:px-5"
                    style={{ boxShadow: "0 5px 0 #221B1C" }}
                  >
                    <span className="text-[26px] leading-none" aria-hidden="true">
                      ⏸️
                    </span>
                    <div className="text-[14px] font-bold leading-relaxed sm:text-[15px]">
                      {generation.message ?? "測試期間 AI 生圖暫停中，暫時無法生成貼圖。"}
                    </div>
                  </div>
                )}
                <GeminiSkillCard onSheetUploaded={handleSheetUploaded} />
                <StickerGenerator
                  ref={generatorRef}
                  onSubmit={handleGenerate}
                  isPending={generateMutation.isPending}
                  signedIn={signedIn}
                  authLoading={authLoading}
                  quotaRemaining={quota.remaining}
                  quotaLimit={quota.limit}
                  generationPaused={generation.paused}
                  onRequestSignIn={() => void handleRequestSignIn()}
                />
              </motion.div>
            )}

            {appState === "loading" && (() => {
              // Compute the active stage based on cumulative seconds. Anything
              // past the planned total parks at the last stage so the UI keeps
              // making sense when generation runs long.
              let cumulative = 0;
              let activeIndex = STAGES.length - 1;
              for (let i = 0; i < STAGES.length; i++) {
                cumulative += STAGES[i].sec;
                if (elapsedSec < cumulative) {
                  activeIndex = i;
                  break;
                }
              }
              const ratio = Math.min(1, elapsedSec / TOTAL_ESTIMATE_SEC);
              // Logarithmic-ish curve so the bar moves fast early and slow
              // late — feels honest when overruns happen.
              const progressPct = Math.min(
                PROGRESS_CEILING,
                Math.round(PROGRESS_CEILING * (1 - Math.pow(1 - ratio, 1.4))),
              );

              return (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="w-full"
                >
                  <GachaLoading
                    stages={STAGES}
                    activeIndex={activeIndex}
                    progressPct={progressPct}
                    hint={hints[loadingHints]}
                    hintKey={loadingHints}
                    elapsedSec={elapsedSec}
                    photo={currentPhoto}
                  />
                </motion.div>
              );
            })()}

            {appState === "result" && sheetBase64 && (
              <Suspense fallback={<ResultLoadingFallback />}>
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.5, type: "spring", bounce: 0.3 }}
                className="w-full"
              >
                <StickerResult
                  sheetBase64={sheetBase64}
                  texts={currentTexts}
                  theme={currentTheme}
                  styleId={currentStyleId}
                  imageUrl={currentImageUrl}
                  onBack={handleBack}
                  onOpenHistory={handleOpenHistory}
                />
              </motion.div>
              </Suspense>
            )}

          </AnimatePresence>
        </Carton>

        {appState === "upload" && (
          <div className="mx-auto mt-8 w-full max-w-4xl">
            <StickerHistory onOpen={handleOpenHistory} />
          </div>
        )}

        <footer className="w-full mt-auto pt-16 pb-8" data-testid="site-footer">
          <div className="mx-auto max-w-3xl">
            <div className="flex flex-col items-center gap-5 px-4">
              {/* 主品牌列 */}
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <span>Made with</span>
                <Heart className="w-4 h-4 text-red-400 fill-red-400 animate-pulse" style={{ animationDuration: "2s" }} />
                <span>by</span>
                <a
                  href="https://cagoooo.github.io/Akai/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-foreground hover:text-primary transition-colors underline-offset-4 hover:underline inline-flex items-center gap-1 group"
                  data-testid="footer-author-link"
                >
                  阿凱老師
                  <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                </a>
                <span>製作</span>
              </div>

              {/* 連結列 */}
              <div className="flex flex-wrap items-center justify-center gap-2">
                <a
                  href="https://cagoooo.github.io/Akai/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="
                    group relative inline-flex items-center gap-1.5 rounded-full
                    bg-gradient-to-r from-pink-400 via-fuchsia-400 to-amber-400
                    bg-[length:200%_auto] bg-left
                    hover:bg-right hover:scale-105 active:scale-95
                    px-4 py-2 text-xs font-extrabold text-white
                    shadow-md shadow-pink-300/40
                    hover:shadow-lg hover:shadow-fuchsia-400/50
                    ring-1 ring-white/30
                    transition-[background-position,transform,box-shadow] duration-500
                  "
                  data-testid="footer-school-link"
                >
                  <Sparkles className="w-3.5 h-3.5 animate-pulse" style={{ animationDuration: "2s" }} />
                  <span className="tracking-wide">阿凱老師其他作品</span>
                  <ExternalLink className="w-3 h-3 opacity-90 group-hover:translate-x-0.5 transition-transform" />
                </a>
                <a
                  href="https://github.com/cagoooo/TieTu"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background hover:bg-muted hover:border-foreground/30 transition-all px-3 py-1.5 text-xs font-medium text-foreground/80 hover:text-foreground shadow-sm"
                  data-testid="footer-github-link"
                >
                  <Github className="w-3.5 h-3.5" />
                  GitHub 原始碼
                  <ExternalLink className="w-3 h-3 opacity-50" />
                </a>
                <a
                  href="https://creator.line.me/zh-hant/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#06C755]/30 bg-[#06C755]/5 hover:bg-[#06C755]/10 transition-all px-3 py-1.5 text-xs font-medium text-[#06C755] shadow-sm"
                  data-testid="footer-line-link"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  LINE 個人原創市集
                  <ExternalLink className="w-3 h-3 opacity-50" />
                </a>
              </div>

              {/* 細節列 */}
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground/70">
                <span>由 Google Gemini 2.5 / 3.1 image 模型驅動</span>
                <span aria-hidden="true">·</span>
                <span>免費使用,不留照片</span>
                <span aria-hidden="true">·</span>
                <a
                  href="https://github.com/cagoooo/TieTu/issues/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors underline-offset-2 hover:underline"
                >
                  回報問題
                </a>
              </div>
            </div>
          </div>
        </footer>

      </main>
    </div>
  );
}
