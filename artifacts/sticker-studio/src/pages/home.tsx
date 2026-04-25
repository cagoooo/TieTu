import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Heart } from "lucide-react";
import { StickerGenerator, type StickerGeneratorHandle } from "@/components/sticker-generator";
import { StickerResult } from "@/components/sticker-result";
import { StickerHistory } from "@/components/sticker-history";
import { useGenerateStickerSheet, ApiError } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { addHistoryEntry, type HistoryEntry } from "@/lib/sticker-history";

type AppState = "upload" | "loading" | "result";

export default function Home() {
  const [appState, setAppState] = useState<AppState>("upload");
  const [sheetBase64, setSheetBase64] = useState<string | null>(null);
  const [currentTexts, setCurrentTexts] = useState<string[]>([]);
  const [loadingHints, setLoadingHints] = useState(0);

  const { toast } = useToast();
  const generateMutation = useGenerateStickerSheet();
  const generatorRef = useRef<StickerGeneratorHandle>(null);

  const hints = [
    "正在分析你的完美角度...",
    "捏捏臉頰，加上 Q 版魔法...",
    "畫上粗白邊，看起來更立體！",
    "填上專屬文字...",
    "快好了快好了，打個蝴蝶結...",
    "最後的魔法點綴 ✨..."
  ];

  const handleGenerate = (
    photoBase64: string,
    theme: string | null,
    texts: string[],
    turnstileToken: string | null,
  ) => {
    setAppState("loading");
    setCurrentTexts(texts);
    
    // Cycle hints
    const hintInterval = setInterval(() => {
      setLoadingHints(prev => (prev + 1) % hints.length);
    }, 5000);

    generateMutation.mutate(
      { data: { photoBase64, theme, texts, turnstileToken } },
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
          addHistoryEntry({
            theme,
            texts,
            sheetBase64: data.imageBase64,
          }).catch((err) => console.error("Failed to add history", err));
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

  const handleOpenHistory = (entry: HistoryEntry) => {
    setSheetBase64(entry.sheetBase64);
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
        
        <header className="w-full flex justify-center mb-8 md:mb-12">
          <div className="flex items-center gap-2 font-bold text-2xl text-foreground">
            <div className="w-10 h-10 bg-primary text-white rounded-2xl flex items-center justify-center rotate-3 shadow-md">
              <Sparkles className="w-6 h-6" />
            </div>
            <span>貼圖工作室</span>
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

            {appState === "loading" && (
              <motion.div
                key="loading"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                transition={{ duration: 0.4 }}
                className="w-full flex flex-col items-center justify-center py-20"
              >
                <div className="relative w-32 h-32 mb-8">
                  <div className="absolute inset-0 border-4 border-primary/20 rounded-full animate-ping" style={{ animationDuration: '3s' }} />
                  <div className="absolute inset-2 border-4 border-primary/40 rounded-full animate-spin" style={{ animationDuration: '2s' }} />
                  <div className="absolute inset-4 bg-primary rounded-full flex items-center justify-center shadow-lg animate-pulse">
                    <Sparkles className="w-10 h-10 text-white" />
                  </div>
                </div>
                
                <h2 className="text-3xl font-bold mb-4 text-foreground">魔法施展中...</h2>
                
                <AnimatePresence mode="wait">
                  <motion.p
                    key={loadingHints}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="text-lg text-muted-foreground flex items-center gap-2"
                  >
                    {hints[loadingHints]}
                  </motion.p>
                </AnimatePresence>

                <p className="mt-8 text-sm text-muted-foreground/60 max-w-sm text-center">
                  這大約需要 30 到 90 秒，可以先去泡杯茶或伸個懶腰。
                </p>
              </motion.div>
            )}

            {appState === "result" && sheetBase64 && (
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
            )}

          </AnimatePresence>
        </div>
        
        <footer className="w-full mt-auto pt-12 pb-4 text-center text-sm text-muted-foreground flex items-center justify-center gap-1">
          用 <Heart className="w-3 h-3 text-red-400" /> 為每一位喜歡貼圖的你打造
        </footer>

      </main>
    </div>
  );
}
