import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Heart, Upload, Brain, Wand2, Check, Loader2, Github, GraduationCap, ExternalLink } from "lucide-react";
import { StickerGenerator, type StickerGeneratorHandle } from "@/components/sticker-generator";
import { StickerHistory } from "@/components/sticker-history";
import { AuthPill } from "@/components/auth-pill";
import { useGenerateStickerSheet, ApiError } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { addHistoryEntry, type HistoryEntry } from "@/lib/sticker-history";
import { useStickerHistoryStorageNotices } from "@/hooks/use-sticker-history-storage";
import type { StickerStyleId } from "@/lib/sticker-utils";
import { useAuth } from "@/hooks/use-auth";

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
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [appState, setAppState] = useState<AppState>("upload");
  const [sheetBase64, setSheetBase64] = useState<string | null>(null);
  const [currentTexts, setCurrentTexts] = useState<string[]>([]);
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

  const handleGenerate = (
    photoBase64: string,
    theme: string | null,
    texts: string[],
    turnstileToken: string | null,
    style: StickerStyleId,
  ) => {
    setAppState("loading");
    setCurrentTexts(texts);

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
                scope === "day"
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
                description: serverMsg,
                variant: "destructive",
                duration: 8000, // longer than default — these messages are dense
              });
              return;
            }
          }

          toast({
            title: "生成失敗",
            description: "抱歉，魔法暫時失靈了，請稍後再試！",
            variant: "destructive",
          });
        }
      }
    );
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
    setAppState("result");
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-background overflow-x-hidden selection:bg-primary/20">
      {/* Decorative background blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[50%] h-[50%] rounded-full bg-secondary/10 blur-3xl" />
      </div>

      <main className="relative z-10 container mx-auto px-4 py-8 md:py-12 min-h-screen flex flex-col items-center">
        
        <header className="w-full flex items-center justify-between mb-8 md:mb-12 gap-4">
          {/* Spacer to keep brand centred when auth pill is wider */}
          <div className="w-[80px] sm:w-[120px]" aria-hidden="true" />
          <div className="flex items-center gap-2 font-bold text-2xl text-foreground">
            <div className="w-10 h-10 bg-primary text-white rounded-2xl flex items-center justify-center rotate-3 shadow-md">
              <Sparkles className="w-6 h-6" />
            </div>
            <span>貼圖工作室</span>
          </div>
          <div className="w-[80px] sm:w-[120px] flex justify-end">
            <AuthPill />
          </div>
        </header>

        <div className="w-full max-w-6xl mx-auto flex-1 flex flex-col justify-center">
          <AnimatePresence mode="wait">
            
            {appState === "upload" && (
              <motion.div
                key="upload"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="w-full space-y-10"
              >
                <StickerGenerator 
                  ref={generatorRef}
                  onSubmit={handleGenerate} 
                  isPending={generateMutation.isPending} 
                />
                <div className="max-w-4xl mx-auto w-full">
                  <StickerHistory onOpen={handleOpenHistory} />
                </div>
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
              const ActiveIcon = STAGES[activeIndex].icon;

              return (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.1 }}
                  transition={{ duration: 0.4 }}
                  className="w-full flex flex-col items-center justify-center py-12 md:py-16"
                >
                  <div className="relative w-32 h-32 mb-6">
                    <div className="absolute inset-0 border-4 border-primary/20 rounded-full animate-ping" style={{ animationDuration: '3s' }} />
                    <div className="absolute inset-2 border-4 border-primary/40 rounded-full animate-spin" style={{ animationDuration: '2s' }} />
                    <div className="absolute inset-4 bg-primary rounded-full flex items-center justify-center shadow-lg animate-pulse">
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={STAGES[activeIndex].id}
                          initial={{ scale: 0.6, opacity: 0, rotate: -20 }}
                          animate={{ scale: 1, opacity: 1, rotate: 0 }}
                          exit={{ scale: 0.6, opacity: 0, rotate: 20 }}
                          transition={{ duration: 0.25 }}
                        >
                          <ActiveIcon className="w-10 h-10 text-white" />
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  </div>

                  <AnimatePresence mode="wait">
                    <motion.h2
                      key={STAGES[activeIndex].id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25 }}
                      className="text-2xl md:text-3xl font-bold mb-1 text-foreground text-center"
                      data-testid="loading-stage-label"
                    >
                      {STAGES[activeIndex].label}
                    </motion.h2>
                  </AnimatePresence>
                  <p className="text-xs text-muted-foreground mb-6 tabular-nums">
                    階段 {activeIndex + 1} / {STAGES.length} · 已過 {Math.floor(elapsedSec)} 秒
                  </p>

                  {/* Progress bar */}
                  <div
                    className="w-full max-w-md h-3 rounded-full bg-muted overflow-hidden mb-3 shadow-inner"
                    role="progressbar"
                    aria-valuenow={progressPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="生成進度"
                  >
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-primary/80 via-primary to-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${progressPct}%` }}
                      transition={{ duration: 0.4, ease: "easeOut" }}
                      data-testid="loading-progress-bar"
                    />
                  </div>
                  <p className="text-xs font-bold tabular-nums text-primary mb-6" data-testid="loading-progress-value">
                    {progressPct}%
                  </p>

                  {/* Stage indicators */}
                  <div className="flex items-center gap-1 sm:gap-2 mb-6 flex-wrap justify-center max-w-md">
                    {STAGES.map((stage, idx) => {
                      const StageIcon = stage.icon;
                      const isDone = idx < activeIndex;
                      const isActive = idx === activeIndex;
                      return (
                        <div key={stage.id} className="flex items-center gap-1 sm:gap-2">
                          <div
                            className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                              isDone
                                ? "bg-primary text-primary-foreground"
                                : isActive
                                ? "bg-primary/15 text-primary ring-2 ring-primary"
                                : "bg-muted text-muted-foreground/50"
                            }`}
                            title={stage.label}
                          >
                            {isDone ? (
                              <Check className="w-4 h-4" />
                            ) : (
                              <StageIcon className="w-4 h-4" />
                            )}
                          </div>
                          {idx < STAGES.length - 1 && (
                            <div
                              className={`h-0.5 w-4 sm:w-8 rounded-full transition-colors ${
                                isDone ? "bg-primary" : "bg-muted"
                              }`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <AnimatePresence mode="wait">
                    <motion.p
                      key={loadingHints}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="text-sm text-muted-foreground/80 italic"
                    >
                      {hints[loadingHints]}
                    </motion.p>
                  </AnimatePresence>

                  <p className="mt-6 text-xs text-muted-foreground/60 max-w-sm text-center">
                    通常 30–90 秒,可以先去泡杯茶或伸個懶腰 ☕
                  </p>
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
                  onBack={handleBack}
                  onOpenHistory={handleOpenHistory}
                />
              </motion.div>
              </Suspense>
            )}

          </AnimatePresence>
        </div>
        
        <footer className="w-full mt-auto pt-16 pb-8" data-testid="site-footer">
          <div className="mx-auto max-w-3xl">
            <div className="flex flex-col items-center gap-5 px-4">
              {/* 主品牌列 */}
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <span>Made with</span>
                <Heart className="w-4 h-4 text-red-400 fill-red-400 animate-pulse" style={{ animationDuration: "2s" }} />
                <span>by</span>
                <a
                  href="https://www.smes.tyc.edu.tw/modules/tadnews/page.php?ncsn=11&nsn=16#a5"
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
                  href="https://www.smes.tyc.edu.tw/modules/tadnews/page.php?ncsn=11&nsn=16#a5"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background hover:bg-muted hover:border-primary/40 transition-all px-3 py-1.5 text-xs font-medium text-foreground/80 hover:text-foreground shadow-sm"
                  data-testid="footer-school-link"
                >
                  <GraduationCap className="w-3.5 h-3.5 text-primary" />
                  阿凱老師其他作品
                  <ExternalLink className="w-3 h-3 opacity-50" />
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
