import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, ExternalLink, Eye, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { customFetch, ApiError } from "@workspace/api-client-react";

interface SharePayload {
  shortCode: string;
  texts: string[];
  theme: string | null;
  styleId: string;
  sheetUrl: string;
  createdAt: number;
  viewCount: number;
}

const STYLE_LABELS: Record<string, string> = {
  "pop-mart-3d": "Pop Mart 3D",
  clay: "黏土風",
  pixel: "16-bit 像素",
  "anime-2d": "二次元動畫",
  watercolor: "水彩",
};

export default function SharePage() {
  const [match, params] = useRoute<{ code: string }>("/share/:code");
  const [data, setData] = useState<SharePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!match || !params?.code) return;
    const code = params.code.trim().toLowerCase();
    if (!/^[a-z0-9]{4,16}$/.test(code)) {
      setError("分享連結格式不正確。");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    customFetch<SharePayload>(`/api/stickers/shared/${code}`, {
      method: "GET",
    })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "讀取分享連結失敗。";
        setError(message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [match, params?.code]);

  if (!match) return null;

  const styleLabel = data?.styleId ? (STYLE_LABELS[data.styleId] ?? data.styleId) : "Pop Mart 3D";
  const createdAtLabel = data
    ? new Date(data.createdAt).toLocaleDateString("zh-Hant-TW", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/10 to-background flex flex-col">
      <div className="container mx-auto px-4 py-8 sm:py-12 flex-1">
        <header className="flex items-center justify-between mb-8 gap-4">
          <Link href="/">
            <Button variant="ghost" className="rounded-full" data-testid="share-back-home">
              <ArrowLeft className="w-4 h-4 mr-2" />
              回首頁
            </Button>
          </Link>
          <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            TieTu 分享頁
          </h1>
        </header>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, type: "spring", bounce: 0.3 }}
          className="max-w-3xl mx-auto"
        >
          <Card className="shadow-lg border-border/60">
            <CardContent className="p-6 sm:p-8 space-y-5">
              {loading && (
                <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>讀取分享連結中...</span>
                </div>
              )}

              {error && !loading && (
                <div className="text-center py-12 space-y-3">
                  <p className="text-lg font-bold text-destructive" data-testid="share-error">
                    {error}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    可能是連結打錯了,或是這份分享已被刪除。
                  </p>
                  <Link href="/">
                    <Button variant="outline" className="rounded-full">
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      回首頁自己做一組
                    </Button>
                  </Link>
                </div>
              )}

              {data && !loading && !error && (
                <>
                  <div className="flex items-center justify-between gap-3 flex-wrap text-xs sm:text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5" />
                        {data.viewCount} 次瀏覽
                      </span>
                      <span>·</span>
                      <span>{createdAtLabel}</span>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                      <Sparkles className="w-3 h-3" />
                      {styleLabel}
                    </span>
                  </div>

                  {data.theme && (
                    <p className="text-sm text-foreground/80">
                      主題:<strong>{data.theme}</strong>
                    </p>
                  )}

                  <div className="rounded-2xl overflow-hidden border border-border/60 bg-muted/20 shadow-inner">
                    {/* The 4×6 sheet from Cloud Storage. The bucket has public
                        read enabled by P2-2, so anonymous fetches just work. */}
                    <img
                      src={data.sheetUrl}
                      alt={data.theme ? `${data.theme} 主題的 24 張 Q版貼圖` : "TieTu 分享的 24 張 Q版貼圖"}
                      className="w-full h-auto"
                      loading="eager"
                      data-testid="share-sticker-image"
                    />
                  </div>

                  <details className="rounded-xl bg-muted/40 border border-border/60 p-3">
                    <summary className="cursor-pointer text-sm font-bold text-foreground/80 select-none">
                      📝 看 24 個文字標籤
                    </summary>
                    <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2 text-xs">
                      {data.texts.map((t, i) => (
                        <div
                          key={i}
                          className="rounded-md bg-background/80 border border-border/40 px-2 py-1.5 text-center font-medium"
                        >
                          <span className="text-muted-foreground mr-1">{i + 1}.</span>
                          {t || <span className="text-muted-foreground italic">空白</span>}
                        </div>
                      ))}
                    </div>
                  </details>

                  <div className="pt-2 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between border-t border-border/60">
                    <p className="text-sm text-muted-foreground">
                      喜歡嗎?自己也來生一組屬於你的 Q版貼圖!
                    </p>
                    <Link href="/">
                      <Button
                        className="rounded-full font-bold bg-primary hover:bg-primary/90 shadow-md w-full sm:w-auto"
                        data-testid="share-cta-create"
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        我也要做一組
                      </Button>
                    </Link>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <footer className="w-full pt-12 pb-8 text-center flex flex-col items-center gap-3" data-testid="share-footer">
        <p className="text-xs text-muted-foreground">
          Made with ❤️ by 阿凱老師
        </p>
        <a
          href="https://cagoooo.github.io/Akai/"
          target="_blank"
          rel="noopener noreferrer"
          className="
            group inline-flex items-center gap-1.5 rounded-full
            bg-gradient-to-r from-pink-400 via-fuchsia-400 to-amber-400
            bg-[length:200%_auto] bg-left
            hover:bg-right hover:scale-105 active:scale-95
            px-4 py-2 text-xs font-extrabold text-white
            shadow-md shadow-pink-300/40
            hover:shadow-lg hover:shadow-fuchsia-400/50
            ring-1 ring-white/30
            transition-[background-position,transform,box-shadow] duration-500
          "
          data-testid="share-author-link"
        >
          <Sparkles className="w-3.5 h-3.5 animate-pulse" style={{ animationDuration: "2s" }} />
          <span className="tracking-wide">阿凱老師其他作品</span>
          <ExternalLink className="w-3 h-3 opacity-90 group-hover:translate-x-0.5 transition-transform" />
        </a>
      </footer>
    </div>
  );
}
