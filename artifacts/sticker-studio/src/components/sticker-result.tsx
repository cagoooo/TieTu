import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Download,
  FileArchive,
  Loader2,
  Minus,
  Plus,
  PackageCheck,
  ZoomIn,
  CheckCircle2,
  ExternalLink,
  ScanText,
  AlertTriangle,
  Share2,
  Copy,
  Check,
} from "lucide-react";
import { customFetch, ApiError } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  splitImageWithGuides,
  downloadZip,
  downloadSheet,
  buildLineStickerPackage,
  downloadLineStickerZip,
  getDefaultGuides,
  getGuideDimensions,
  loadImage,
  isTileAdjustmentDefault,
  clampMatteTolerance,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  MIN_COLS,
  MAX_COLS,
  MIN_ROWS,
  MAX_ROWS,
  LINE_STICKER_COUNT,
  LINE_TILE_W,
  LINE_TILE_H,
  LINE_MAIN_SIZE,
  LINE_TAB_W,
  LINE_TAB_H,
  DEFAULT_MATTE_TOLERANCE,
  MATTE_TOLERANCE_MIN,
  MATTE_TOLERANCE_MAX,
  type Guides,
  type TileAdjustment,
  type TileAdjustments,
} from "@/lib/sticker-utils";
import { STICKER_STYLES } from "@/lib/sticker-utils";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/gacha/primitives";
import { capColor } from "@/components/gacha/tokens";
import { StickerCropper } from "./sticker-cropper";
import { StickerHistory } from "./sticker-history";
import { StickerLightbox } from "./sticker-lightbox";
import { StickerLineExportDialog } from "./sticker-line-export-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { StickerTileEditor, type TileSourceRect } from "./sticker-tile-editor";
import { useToast } from "@/hooks/use-toast";
import type { HistoryEntry } from "@/lib/sticker-history";

interface StickerResultProps {
  sheetBase64: string;
  texts: string[];
  /** Theme used to generate this sheet — passed to /api/stickers/share so the
   *  public share page can show "主題:XX" alongside the image. */
  theme?: string | null;
  /** Style id used to generate this sheet (pop-mart-3d / clay / pixel /
   *  anime-2d / watercolor). */
  styleId?: string;
  /** Cloud Storage public URL of the rendered sheet (P2-2). When null the
   *  share button is disabled — the share entry needs a permanent URL, not
   *  the in-memory base64. */
  imageUrl?: string | null;
  onBack: () => void;
  onOpenHistory: (entry: HistoryEntry) => void;
}

// Local types for the AI 文字準確度檢查 result. Mirrors the shape the deprecated
// lib/sticker-ocr.ts module used to export, so the rendering code below didn't
// need to change. Server now does the actual recognition (Gemini Vision); the
// client computes the per-cell mismatch list against `texts`.
interface OcrMismatch {
  index: number;
  expected: string;
  recognized: string;
  similarity: number;
}
interface OcrVerificationResult {
  mismatches: OcrMismatch[];
  totalChecked: number;
  averageSimilarity: number;
  recognizedByIndex: Record<number, string>;
}

const VERIFY_SIMILARITY_THRESHOLD = 0.5;

/** Same Jaccard-on-character-set the server uses, so the client and server
 *  agree on what counts as a "mismatch" without an extra round-trip. */
function characterSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.replace(/[\s\p{P}]/gu, "");
  const aN = norm(a);
  const bN = norm(b);
  if (aN.length === 0 && bN.length === 0) return 1;
  if (aN.length === 0 || bN.length === 0) return 0;
  const aSet = new Set(aN.split(""));
  const bSet = new Set(bN.split(""));
  const intersection = [...aSet].filter((c) => bSet.has(c)).length;
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
}

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  testIdPrefix: string;
}

function Stepper({ label, value, min, max, onChange, testIdPrefix }: StepperProps) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-foreground/80 w-10">{label}</span>
      <div className="flex items-center rounded-full border border-border bg-background overflow-hidden">
        <button
          type="button"
          onClick={dec}
          disabled={value <= min}
          aria-label={`減少${label}`}
          className="px-2 py-1 hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          data-testid={`${testIdPrefix}-decrement`}
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span
          className="px-3 py-1 min-w-[2.5rem] text-center font-bold tabular-nums text-sm"
          data-testid={`${testIdPrefix}-value`}
        >
          {value}
        </span>
        <button
          type="button"
          onClick={inc}
          disabled={value >= max}
          aria-label={`增加${label}`}
          className="px-2 py-1 hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          data-testid={`${testIdPrefix}-increment`}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// 盲盒改版的下載 / 動作按鈕（粗框 + 主鈕硬陰影，對應 ss-result.jsx 的 Action）。
interface GachaActionProps {
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** 主鈕：珊瑚橘填色 + 0 5px 0 ink 硬陰影。 */
  primary?: boolean;
  /** 幽靈鈕：白底（分享卡用）。預設奶油底。 */
  ghost?: boolean;
  icon: ReactNode;
  children: ReactNode;
  sub?: ReactNode;
  title?: string;
  testId?: string;
}

function GachaAction({ onClick, disabled, loading, primary, ghost, icon, children, sub, title, testId }: GachaActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
      className={cn(
        "flex w-full items-center gap-3 rounded-[15px] border-[3px] border-ink px-4 py-[13px] text-left transition active:translate-y-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        primary ? "text-white" : ghost ? "bg-white text-ink" : "bg-cream text-ink",
      )}
      style={primary ? { background: "#FF5A4D", boxShadow: "0 5px 0 #221B1C" } : undefined}
    >
      <span className="grid h-6 w-6 shrink-0 place-items-center">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : icon}
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-extrabold">{children}</span>
        {sub && <span className="mt-px block text-[11.5px] font-medium opacity-80">{sub}</span>}
      </span>
    </button>
  );
}

export function StickerResult({
  sheetBase64,
  texts,
  theme,
  styleId,
  imageUrl,
  onBack,
  onOpenHistory,
}: StickerResultProps) {
  const [cols, setCols] = useState<number>(DEFAULT_COLS);
  const [rows, setRows] = useState<number>(DEFAULT_ROWS);
  const [guides, setGuides] = useState<Guides>(() => getDefaultGuides(DEFAULT_COLS, DEFAULT_ROWS));
  const [tiles, setTiles] = useState<string[]>([]);
  const [tileAdjustments, setTileAdjustments] = useState<TileAdjustments>({});
  const [editingTileIndex, setEditingTileIndex] = useState<number | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [isSplitting, setIsSplitting] = useState(true);
  const [isZipping, setIsZipping] = useState(false);
  const [isLineExporting, setIsLineExporting] = useState(false);
  const [lineExportOpen, setLineExportOpen] = useState(false);
  // 一鍵去背:套用到切割預覽 + 下載 ZIP / 整張 PNG。LINE 上架版有自己的
  // 進階對話框,使用各自的 tolerance(因為每張 LINE tile 規格 370×320,
  // 不同於這裡的原始切割大小)。
  const [matteEnabled, setMatteEnabled] = useState(false);
  const [matteTolerance, setMatteTolerance] = useState(DEFAULT_MATTE_TOLERANCE);
  const effectiveMatte = matteEnabled ? matteTolerance : 0;

  // 文字準確度檢查(opt-in):送整張 sheet 到 /api/stickers/verify-text,後端用
  // gemini-2.5-flash 多模態一次讀回 24 格。取代了原本 lazy-loaded 的
  // tesseract.js + chi_tra(8 MB 語言包),因為對藝術字辨識率太低(67% 誤判),
  // 而且 chi_tra 不支援英文(Hi / YA → 空白)。Gemini Vision 的 free tier 大,
  // 一次驗證 = 1 次 gemini-2.5-flash 呼叫,在 1500 RPD 內不會收費。
  const [ocrState, setOcrState] = useState<"idle" | "loading" | "done">("idle");
  const [ocrResult, setOcrResult] = useState<OcrVerificationResult | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  // Tracks whether the auto-verify on first sheet load has fired. The user
  // can still click 重新檢查 manually (clears this so a follow-up auto-fire
  // would be possible if sheetBase64 changed, e.g. they go back and regen).
  const autoVerifiedKeyRef = useRef<string | null>(null);
  const cachedImageRef = useRef<HTMLImageElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const splitVersionRef = useRef(0);
  const { toast } = useToast();

  const tileCount = cols * rows;
  const isLineEligible = tileCount === LINE_STICKER_COUNT;

  useEffect(() => {
    setCols(DEFAULT_COLS);
    setRows(DEFAULT_ROWS);
    setGuides(getDefaultGuides(DEFAULT_COLS, DEFAULT_ROWS));
    setTileAdjustments({});
    setEditingTileIndex(null);
    setLightboxIndex(null);
    cachedImageRef.current = null;
    setImageReady(false);
    let cancelled = false;
    loadImage(sheetBase64)
      .then((img) => {
        if (!cancelled) {
          cachedImageRef.current = img;
          setImageReady(true);
        }
      })
      .catch((err) => console.error("Failed to load sheet image", err));
    return () => {
      cancelled = true;
    };
  }, [sheetBase64]);

  useEffect(() => {
    const dims = getGuideDimensions(guides);
    if (dims.cols !== cols || dims.rows !== rows) {
      setGuides(getDefaultGuides(cols, rows));
      setTileAdjustments({});
      setEditingTileIndex(null);
      setLightboxIndex(null);
    }
  }, [cols, rows]);

  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    setIsSplitting(true);
    const myVersion = ++splitVersionRef.current;
    debounceRef.current = window.setTimeout(async () => {
      try {
        const result = await splitImageWithGuides(
          sheetBase64,
          guides,
          cachedImageRef.current ?? undefined,
          tileAdjustments,
          effectiveMatte,
        );
        if (splitVersionRef.current === myVersion) {
          setTiles(result);
        }
      } catch (error) {
        console.error("Failed to split image", error);
      } finally {
        if (splitVersionRef.current === myVersion) {
          setIsSplitting(false);
        }
      }
    }, 150);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [sheetBase64, guides, tileAdjustments, effectiveMatte]);

  const handleTileAdjustmentChange = useCallback(
    (index: number, next: TileAdjustment) => {
      setTileAdjustments((prev) => {
        if (isTileAdjustmentDefault(next)) {
          if (!(index in prev)) return prev;
          const rest = { ...prev };
          delete rest[index];
          return rest;
        }
        const cur = prev[index];
        if (
          cur &&
          cur.rotation === next.rotation &&
          cur.offsetX === next.offsetX &&
          cur.offsetY === next.offsetY &&
          cur.scale === next.scale
        ) {
          return prev;
        }
        return { ...prev, [index]: next };
      });
    },
    [],
  );

  const editingSourceRect = useMemo<TileSourceRect | null>(() => {
    if (editingTileIndex === null) return null;
    const img = cachedImageRef.current;
    if (!img) return null;
    const col = editingTileIndex % cols;
    const row = Math.floor(editingTileIndex / cols);
    if (col >= cols || row >= rows) return null;
    const sx = guides.xCuts[col] * img.width;
    const sy = guides.yCuts[row] * img.height;
    const sw = (guides.xCuts[col + 1] - guides.xCuts[col]) * img.width;
    const sh = (guides.yCuts[row + 1] - guides.yCuts[row]) * img.height;
    return { sx, sy, sw, sh };
  }, [editingTileIndex, cols, rows, guides, imageReady]);

  const editingAdjustment =
    editingTileIndex !== null
      ? tileAdjustments[editingTileIndex] ?? { rotation: 0, offsetX: 0, offsetY: 0, scale: 1 }
      : { rotation: 0, offsetX: 0, offsetY: 0, scale: 1 };

  const adjustedTileCount = useMemo(
    () => Object.values(tileAdjustments).filter((a) => !isTileAdjustmentDefault(a)).length,
    [tileAdjustments],
  );

  const adjustedTileSet = useMemo(() => {
    const set = new Set<number>();
    for (const [key, adj] of Object.entries(tileAdjustments)) {
      if (!isTileAdjustmentDefault(adj)) set.add(Number(key));
    }
    return set;
  }, [tileAdjustments]);

  useEffect(() => {
    if (lightboxIndex === null) return;
    if (lightboxIndex >= tiles.length) {
      setLightboxIndex(tiles.length > 0 ? tiles.length - 1 : null);
    }
  }, [lightboxIndex, tiles.length]);

  const handleDownloadZip = async () => {
    setIsZipping(true);
    try {
      const fresh = await splitImageWithGuides(
        sheetBase64,
        guides,
        cachedImageRef.current ?? undefined,
        tileAdjustments,
        effectiveMatte,
      );
      await downloadZip(fresh, texts);
      if (effectiveMatte > 0) {
        toast({
          title: "已下載去背版 ZIP",
          description: `已套用去背強度 ${effectiveMatte},適合直接上傳 LINE 個人原創貼圖。`,
        });
      }
    } catch (error) {
      console.error("Zip failed", error);
    } finally {
      setIsZipping(false);
    }
  };

  const handleVerifyOcr = useCallback(async (opts?: { silentSuccess?: boolean }) => {
    if (!sheetBase64) {
      toast({
        title: "尚未載入貼圖",
        description: "請等預覽載入後再試。",
        variant: "destructive",
      });
      return;
    }
    setOcrState("loading");
    setOcrError(null);
    setOcrResult(null);
    try {
      // Strip the data URL prefix (`data:image/png;base64,`) before sending —
      // the server's decodePhoto() also accepts data URLs but raw base64 is
      // smaller on the wire.
      const commaIdx = sheetBase64.indexOf(",");
      const sheetPayload = commaIdx >= 0 ? sheetBase64.slice(commaIdx + 1) : sheetBase64;

      const { recognizedTexts, averageSimilarity } = await customFetch<{
        recognizedTexts: string[];
        averageSimilarity: number;
      }>("/api/stickers/verify-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetBase64: sheetPayload, expectedTexts: texts }),
      });

      const totalChecked = Math.min(recognizedTexts.length, texts.length);
      const recognizedByIndex: Record<number, string> = {};
      const mismatches: OcrMismatch[] = [];
      for (let i = 0; i < totalChecked; i++) {
        const expected = texts[i] ?? "";
        const recognized = recognizedTexts[i] ?? "";
        recognizedByIndex[i] = recognized;
        const sim = characterSimilarity(expected, recognized);
        if (sim < VERIFY_SIMILARITY_THRESHOLD) {
          mismatches.push({ index: i, expected, recognized, similarity: sim });
        }
      }

      const result: OcrVerificationResult = {
        mismatches,
        totalChecked,
        averageSimilarity,
        recognizedByIndex,
      };
      setOcrResult(result);
      setOcrState("done");

      const matchPct = Math.round(result.averageSimilarity * 100);
      if (result.mismatches.length === 0) {
        // Auto-runs suppress the "all-clear" toast — surprise positive toasts
        // when the user didn't ask for it feel noisy. Manual button still
        // fires the toast so re-checking has visible feedback.
        if (!opts?.silentSuccess) {
          toast({
            title: "文字辨識準確 ✅",
            description: `檢查 ${result.totalChecked} 張,平均相似度 ${matchPct}%。可放心下載。`,
          });
        }
      } else {
        // Mismatch toasts always fire — this is the whole point of auto-verify:
        // proactively warn the user before they download a sheet with errors.
        toast({
          title: `偵測到 ${result.mismatches.length} 處可能錯字`,
          description: `平均相似度 ${matchPct}%。請查看下方清單,可手動修文字後重新生成。`,
          variant: "destructive",
          duration: 8000,
        });
      }
    } catch (error) {
      console.error("Verify-text failed", error);
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "AI 文字辨識失敗。";
      setOcrError(message);
      setOcrState("idle");
      // Auto-runs swallow error toasts — the verify panel still shows the
      // error inline, and we don't want to hijack the user's first-glance UX
      // with "驗證失敗" before they've even seen the sticker. They can hit
      // the manual button to retry.
      if (!opts?.silentSuccess) {
        toast({
          title: "AI 文字辨識失敗",
          description: `${message}(請稍後再試,或確認網路是否暢通。)`,
          variant: "destructive",
        });
      }
    }
  }, [sheetBase64, texts, toast]);

  // N2 — auto-verify on first load. Runs once per distinct sheetBase64 (so
  // navigating back, regenerating, then returning re-fires; opening the same
  // sheet from history doesn't re-fire if we already verified it). Manual
  // 重新檢查 button stays available either way.
  useEffect(() => {
    if (!sheetBase64) return;
    if (autoVerifiedKeyRef.current === sheetBase64) return;
    autoVerifiedKeyRef.current = sheetBase64;
    // Tiny defer so the result page's main render happens first — the user
    // should see their sticker before we kick off a 3-second background API.
    const timer = window.setTimeout(() => {
      void handleVerifyOcr({ silentSuccess: true });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [sheetBase64, handleVerifyOcr]);

  // ---------------- N3 — Sharing ----------------
  // Auth check via useAuth so we can show "請先登入才能分享" when guest, and
  // the share button hits the API endpoint that requires uid.
  const { user } = useAuth();
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  const canShare = Boolean(user && imageUrl);

  const handleShare = useCallback(async () => {
    if (!user) {
      toast({
        title: "請先登入才能分享",
        description: "右上角點頭像登入 Google 帳號,就能建立分享連結。",
        variant: "destructive",
      });
      return;
    }
    if (!imageUrl) {
      toast({
        title: "雲端儲存還沒準備好",
        description: "貼圖剛生成時還在上傳到雲端,請等幾秒再試一次。若 GCS 上傳失敗(極少數)就無法分享。",
        variant: "destructive",
      });
      return;
    }
    setShareLoading(true);
    setShareUrl(null);
    setShareCopied(false);
    try {
      const { shortCode } = await customFetch<{ shortCode: string }>(
        "/api/stickers/share",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            texts,
            theme: theme ?? null,
            styleId: styleId ?? "pop-mart-3d",
            sheetUrl: imageUrl,
          }),
        },
      );
      // Always build the share URL pointing at the canonical Firebase Hosting
      // domain — even if the user is on the GitHub Pages mirror, the share
      // link should be the cleaner *.web.app form so OG meta works
      // consistently.
      const url = `https://tietu.web.app/share/${shortCode}`;
      setShareUrl(url);
      setShareModalOpen(true);
    } catch (error) {
      console.error("Share creation failed", error);
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "分享連結建立失敗。";
      toast({
        title: "分享建立失敗",
        description: message,
        variant: "destructive",
      });
    } finally {
      setShareLoading(false);
    }
  }, [user, imageUrl, texts, theme, styleId, toast]);

  const handleCopyShareUrl = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // Older browsers / non-secure contexts fall back to selection.
      toast({
        title: "複製失敗",
        description: "請手動選取網址後 Ctrl+C / ⌘+C 複製。",
        variant: "destructive",
      });
    }
  }, [shareUrl, toast]);

  const lineShareUrl = useMemo(() => {
    if (!shareUrl) return null;
    return `https://line.me/R/msg/text/?${encodeURIComponent(`我用 TieTu 做了一組 Q版貼圖,來看看! ${shareUrl}`)}`;
  }, [shareUrl]);
  const fbShareUrl = useMemo(() => {
    if (!shareUrl) return null;
    return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
  }, [shareUrl]);

  const handleDownloadSheet = async () => {
    try {
      await downloadSheet(sheetBase64, effectiveMatte);
      if (effectiveMatte > 0) {
        toast({
          title: "已下載透明背景整張 PNG",
          description: `已套用去背強度 ${effectiveMatte},整張 4×6 灰底已轉透明。`,
        });
      }
    } catch (error) {
      console.error("Sheet download failed", error);
      toast({
        title: "下載失敗",
        description: "整張 PNG 去背時發生錯誤,請改用無去背模式或重新整理頁面再試。",
        variant: "destructive",
      });
    }
  };

  const handleOpenLineExport = () => {
    setLineExportOpen(true);
  };

  const handleConfirmLineExport = async (
    mainTileIndex: number,
    tabTileIndex: number,
    tolerance: number,
  ) => {
    setIsLineExporting(true);
    try {
      const pkg = await buildLineStickerPackage(
        sheetBase64,
        guides,
        cachedImageRef.current ?? undefined,
        tileAdjustments,
        mainTileIndex,
        tabTileIndex,
        tolerance,
      );
      await downloadLineStickerZip(pkg);
      const sameAsMain = mainTileIndex === tabTileIndex;
      toast({
        title: "LINE 上架版已下載",
        description: `已輸出 ${LINE_STICKER_COUNT} 張 ${LINE_TILE_W}×${LINE_TILE_H} 透明 PNG。主圖使用第 ${mainTileIndex + 1} 張，分頁圖${sameAsMain ? "沿用主圖" : `使用第 ${tabTileIndex + 1} 張`}。`,
      });
      setLineExportOpen(false);
    } catch (error) {
      console.error("LINE export failed", error);
      toast({
        title: "無法輸出 LINE 上架版",
        description:
          error instanceof Error
            ? error.message
            : `請確認切割數量為剛好 ${LINE_STICKER_COUNT} 張後再試。`,
        variant: "destructive",
      });
    } finally {
      setIsLineExporting(false);
    }
  };

  const previewGridStyle = useMemo(
    () => ({ gridTemplateColumns: `repeat(${Math.max(1, cols)}, minmax(0, 1fr))` }),
    [cols],
  );

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.02 },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 10, scale: 0.95 },
    show: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { type: "spring" as const, stiffness: 300, damping: 24 },
    },
  };

  const styleLabel = (STICKER_STYLES.find((s) => s.id === styleId) || STICKER_STYLES[0]).label;

  return (
    <div className="w-full pb-2">
      {/* ── 開盒標頭 ── */}
      <div className="mb-[18px] flex flex-wrap items-end justify-between gap-3 px-5 pt-6 sm:px-[30px]">
        <div className="min-w-0">
          <div className="font-display mb-3 inline-flex items-center gap-2 rounded-full border-[2.5px] border-ink bg-cap-green px-[14px] py-[5px] text-[12.5px] font-semibold tracking-[0.06em] text-white">
            ✓ 開盒成功！24 張全部到手
          </div>
          <h2 className="font-display text-[32px] font-bold leading-none sm:text-[42px]">
            你的<span className="text-coral">貼圖收藏</span>
          </h2>
          <div className="mt-[11px] flex flex-wrap gap-2">
            <span className="rounded-full border-2 border-ink bg-cream px-3 py-[5px] text-[12.5px] font-bold">
              🎁 {styleLabel}
            </span>
            {theme && (
              <span
                className="rounded-full border-2 border-ink px-3 py-[5px] text-[12.5px] font-bold"
                style={{ background: "#ECE5FF" }}
              >
                # {theme}
              </span>
            )}
            <span
              className="rounded-full border-2 border-ink px-3 py-[5px] text-[12.5px] font-bold"
              style={{ background: "#DDF4EF" }}
            >
              {tileCount} / 24 {isLineEligible ? "✓" : ""}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* 一鍵去背 toggle（開啟＝薰衣草） */}
          <button
            type="button"
            onClick={() => setMatteEnabled((v) => !v)}
            aria-pressed={matteEnabled}
            data-testid="matte-toggle"
            className={cn(
              "flex items-center gap-2.5 rounded-[14px] border-[3px] border-ink px-4 py-2.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral",
              matteEnabled ? "text-white" : "bg-white text-ink",
            )}
            style={matteEnabled ? { background: "#B59CFF" } : undefined}
          >
            <span
              className="relative inline-block h-[22px] w-[38px] rounded-full transition-colors"
              style={{ background: matteEnabled ? "#221B1C" : "#ddd" }}
            >
              <span
                className="absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white transition-all"
                style={{ left: matteEnabled ? 18 : 2 }}
              />
            </span>
            <span className="text-[14px] font-extrabold">一鍵去背</span>
          </button>
          <button
            type="button"
            onClick={onBack}
            data-testid="button-back"
            className="font-display rounded-[14px] border-[3px] border-ink bg-white px-5 py-2.5 text-[15px] font-semibold text-ink transition active:translate-y-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
          >
            ↻ 再扭一組
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-[22px] px-5 pb-6 sm:px-[30px] lg:grid-cols-[1fr_300px] lg:items-start">
        {/* ── 左：膠囊貼圖 grid + 切割線 + OCR ── */}
        <div className="flex min-w-0 flex-col gap-[18px]">
          {/* 24 張膠囊貼圖（主角） */}
          <Panel className="!p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-[17px] font-bold">開出 {tileCount} 張貼圖</h3>
              <div className="flex items-center gap-3">
                {matteEnabled && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-ink/60">去背強度</span>
                    <Slider
                      min={MATTE_TOLERANCE_MIN}
                      max={MATTE_TOLERANCE_MAX}
                      step={1}
                      value={[matteTolerance]}
                      onValueChange={(v) => setMatteTolerance(clampMatteTolerance(v[0]))}
                      className="w-24"
                      data-testid="matte-tolerance-slider"
                    />
                    <span className="w-6 text-right text-[11px] font-bold tabular-nums" data-testid="matte-tolerance-value">
                      {matteTolerance}
                    </span>
                  </div>
                )}
                {isSplitting && (
                  <span className="flex items-center gap-1 text-[11px] text-ink/50">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    更新中
                  </span>
                )}
              </div>
            </div>

            <div
              className="rounded-[14px] p-3"
              style={
                matteEnabled
                  ? {
                      // 去背棋盤格（透明示意）
                      background:
                        "conic-gradient(#eee 90deg, #fff 90deg 180deg, #eee 180deg 270deg, #fff 270deg) 0 0 / 22px 22px",
                    }
                  : { backgroundColor: "#FFF6EC" }
              }
            >
              <motion.div
                variants={container}
                initial="hidden"
                animate="show"
                className="grid gap-[11px]"
                style={previewGridStyle}
                data-testid="tile-preview-grid"
              >
                {tiles.map((tile, i) => {
                  const adjusted = !isTileAdjustmentDefault(tileAdjustments[i]);
                  return (
                    <motion.div key={i} variants={item} className="relative">
                      <button
                        type="button"
                        onClick={() => setLightboxIndex(i)}
                        className={cn(
                          "group relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[13px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2",
                          matteEnabled ? "" : "border-[2.5px] border-ink bg-white",
                        )}
                        style={matteEnabled ? undefined : { boxShadow: "0 2px 0 rgba(0,0,0,.12)" }}
                        aria-label={`放大檢視第 ${i + 1} 張${texts[i] ? `「${texts[i]}」` : ""}`}
                        data-testid={`tile-preview-${i}`}
                      >
                        <span
                          className="font-display absolute left-1.5 top-1.5 z-[2] grid h-[18px] w-[18px] place-items-center rounded-[6px] border-[1.5px] border-ink text-[10px] font-semibold text-white"
                          style={{ background: capColor(i) }}
                          aria-hidden="true"
                        >
                          {i + 1}
                        </span>
                        <img
                          src={tile}
                          alt={texts[i] || `Sticker ${i + 1}`}
                          className="h-full w-full object-contain p-1"
                          data-testid={`tile-${i}`}
                        />
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
                          <span className="font-display inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-[10px] font-bold text-ink opacity-0 shadow transition-opacity group-hover:opacity-100">
                            <ZoomIn className="h-3 w-3" />
                            放大
                          </span>
                        </span>
                        {adjusted && (
                          <span
                            className="absolute right-1 top-1 rounded-full bg-coral px-1.5 py-0.5 text-[10px] font-bold text-white shadow"
                            data-testid={`tile-adjusted-badge-${i}`}
                          >
                            已微調
                          </span>
                        )}
                      </button>
                    </motion.div>
                  );
                })}
                {tiles.length === 0 && (
                  <div
                    className="flex h-32 items-center justify-center text-sm text-ink/50"
                    style={{ gridColumn: `span ${Math.max(1, cols)} / span ${Math.max(1, cols)}` }}
                  >
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    正在裁切貼圖...
                  </div>
                )}
              </motion.div>
            </div>
            <p className="mt-3 text-center text-[11px] leading-relaxed text-ink/50">
              點任一張可放大檢視，並可在彈窗內進入單張微調。
              {adjustedTileCount > 0 && (
                <>
                  <br />
                  <span data-testid="adjusted-summary">
                    已微調 {adjustedTileCount} 張，下載時會一起套用。
                  </span>
                </>
              )}
            </p>
          </Panel>

          {/* 調整切割線（進階：拖曳格線 + 欄列數） */}
          <Panel className="!p-4 sm:!p-5">
            <div
              className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              data-testid="grid-controls"
            >
              <div>
                <h3 className="font-display text-[16px] font-bold">調整切割線</h3>
                <p className="mt-0.5 text-[11px] text-ink/50">
                  生成結果若有歪斜或邊距不均，可拖曳格線校正後再下載。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Stepper label="欄" value={cols} min={MIN_COLS} max={MAX_COLS} onChange={setCols} testIdPrefix="cols-stepper" />
                <Stepper label="列" value={rows} min={MIN_ROWS} max={MAX_ROWS} onChange={setRows} testIdPrefix="rows-stepper" />
                <span className="text-[11px] tabular-nums text-ink/50" data-testid="grid-summary">
                  = {tileCount} 張
                </span>
              </div>
            </div>
            <StickerCropper
              sheetBase64={sheetBase64}
              guides={guides}
              onGuidesChange={setGuides}
              resetCols={cols}
              resetRows={rows}
            />
          </Panel>

          {/* AI 文字準確度檢查（Gemini Vision） */}
          <Panel className="!p-4 sm:!p-5" data-testid="ocr-controls">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ScanText className="h-4 w-4 text-coral" />
                  <span className="font-display text-[15px] font-bold">AI 文字準確度檢查</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleVerifyOcr()}
                  disabled={ocrState === "loading" || !sheetBase64}
                  data-testid="ocr-verify-button"
                  className="inline-flex h-8 items-center gap-1 rounded-full border-2 border-ink px-3 text-[12px] font-bold text-ink transition hover:bg-ink/5 disabled:opacity-50"
                >
                  {ocrState === "loading" ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      AI 辨識中...
                    </>
                  ) : ocrResult ? (
                    <>
                      <ScanText className="h-3 w-3" />
                      重新檢查
                    </>
                  ) : (
                    <>
                      <ScanText className="h-3 w-3" />
                      檢查文字準確度
                    </>
                  )}
                </button>
              </div>
              <p className="text-[12px] leading-relaxed text-ink/55">
                AI 偶爾會把中文寫成形似的錯字。<strong>貼圖完成後會自動用 Gemini Vision 驗證一次</strong>,結果直接顯示在下方。你也可以隨時點「重新檢查」再跑一次。中英文混合(Hi、YA)都能辨識。
              </p>
              {ocrError && (
                <p className="pt-1 text-[11px] font-medium leading-relaxed text-destructive">錯誤:{ocrError}</p>
              )}
              {ocrResult && (
                <div className="mt-2 space-y-2 rounded-[12px] border-2 border-ink/15 bg-cream/60 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    {ocrResult.mismatches.length === 0 ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-cap-green" />
                        <span className="font-bold text-ink">全部正確!</span>
                        <span className="text-ink/55">
                          檢查 {ocrResult.totalChecked} 張,平均相似度 {Math.round(ocrResult.averageSimilarity * 100)}%。
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        <span className="font-bold text-ink">{ocrResult.mismatches.length} 處可能寫錯</span>
                        <span className="text-ink/55">
                          (檢查 {ocrResult.totalChecked} 張,平均相似度 {Math.round(ocrResult.averageSimilarity * 100)}%)
                        </span>
                      </>
                    )}
                  </div>
                  {ocrResult.mismatches.length > 0 && (
                    <ul className="space-y-1 pt-1">
                      {ocrResult.mismatches.map((m) => (
                        <li key={m.index} className="flex items-center gap-2 text-xs text-ink/90">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/15 font-bold text-amber-700">
                            {m.index + 1}
                          </span>
                          <span>
                            期待<strong>「{m.expected}」</strong>,但 AI 看到
                            <strong className="text-amber-700">「{m.recognized || "(空白)"}」</strong>
                            <span className="ml-1 text-ink/50">({Math.round(m.similarity * 100)}% 相符)</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {ocrResult.mismatches.length > 0 && (
                    <p className="pt-1 text-[11px] leading-relaxed text-ink/55">
                      建議:點「再扭一組」回上頁,把錯誤的格子文字稍微改寫(如加標點、換同義詞),再重新生成。
                    </p>
                  )}
                </div>
              )}
            </div>
          </Panel>
        </div>

        {/* ── 右：下載 rail + 分享（sticky） ── */}
        <div className="flex flex-col gap-3 lg:sticky lg:top-4">
          <Panel className="!p-4" style={{ background: "#FFFDF8" }}>
            <div className="font-display mb-1 text-[17px] font-bold">帶走你的貼圖</div>
            <div className="mb-3.5 text-[12px] text-ink/50">
              {matteEnabled ? "已套用透明背景 ✓" : "灰底版 · 開「一鍵去背」可輸出透明背景"}
            </div>
            <div className="flex flex-col gap-2.5">
              <GachaAction
                primary
                icon={<Download className="h-5 w-5" />}
                sub="一張大圖含 24 格"
                onClick={handleDownloadSheet}
                testId="button-download-sheet"
              >
                下載整張貼圖
              </GachaAction>
              <GachaAction
                icon={<FileArchive className="h-5 w-5" />}
                sub={`${tileCount} 張單張 PNG`}
                onClick={handleDownloadZip}
                loading={isZipping}
                disabled={isZipping || tiles.length === 0}
                testId="button-download-zip"
              >
                下載 {tileCount} 張 (ZIP)
              </GachaAction>
              <GachaAction
                icon={<PackageCheck className="h-5 w-5 text-[#06C755]" />}
                sub="main / tab / 24 張 + README"
                onClick={handleOpenLineExport}
                loading={isLineExporting}
                disabled={isLineExporting || !isLineEligible || tiles.length === 0}
                title={
                  isLineEligible
                    ? `挑選 LINE 主圖與分頁圖，輸出符合規格的素材包（${LINE_TILE_W}×${LINE_TILE_H}、主圖 ${LINE_MAIN_SIZE}×${LINE_MAIN_SIZE}、分頁圖 ${LINE_TAB_W}×${LINE_TAB_H}）`
                    : `LINE 規格需要剛好 ${LINE_STICKER_COUNT} 張，目前為 ${tileCount} 張。`
                }
                testId="button-download-line"
              >
                下載 LINE 上架版
              </GachaAction>
            </div>
            {!isLineEligible ? (
              <p className="mt-3 text-[11px] leading-relaxed text-ink/50" data-testid="line-eligibility-note">
                想輸出 LINE 上架版？請將切割數量調整為剛好 {LINE_STICKER_COUNT} 張（目前 {tileCount} 張）。
              </p>
            ) : (
              <a
                href="https://creator.line.me/zh-hant/"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="line-creator-link"
                className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-bold text-[#06C755] hover:text-[#05B14C]"
              >
                前往 LINE 個人原創市集
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </Panel>

          <Panel className="!p-4">
            <div className="font-display mb-2.5 text-[16px] font-bold">分享給朋友</div>
            <GachaAction
              ghost
              icon={<Share2 className="h-5 w-5" />}
              onClick={handleShare}
              loading={shareLoading}
              disabled={shareLoading || !canShare}
              title={
                !user
                  ? "請先登入才能分享(右上角頭像)"
                  : !imageUrl
                    ? "貼圖正在上傳到雲端,請稍後再試"
                    : "建立公開分享連結,任何人點都看得到這組貼圖"
              }
              testId="button-share"
            >
              建立分享連結
            </GachaAction>
            <p className="mt-3 text-[11px] leading-relaxed text-ink/50">
              💡 連結永久有效，雲端檔案保留 7 天，想長期保存請下載 ZIP 留底。
            </p>
          </Panel>
        </div>
      </div>

      <StickerLightbox
        open={lightboxIndex !== null}
        onOpenChange={(open) => {
          if (!open) setLightboxIndex(null);
        }}
        tiles={tiles}
        texts={texts}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        adjustedSet={adjustedTileSet}
        onEdit={(i) => {
          setLightboxIndex(null);
          setEditingTileIndex(i);
        }}
      />

      <StickerTileEditor
        open={editingTileIndex !== null}
        onOpenChange={(open) => {
          if (!open) setEditingTileIndex(null);
        }}
        tileIndex={editingTileIndex}
        totalTiles={tileCount}
        label={editingTileIndex !== null ? texts[editingTileIndex] : undefined}
        sourceImage={imageReady ? cachedImageRef.current : null}
        sourceRect={editingSourceRect}
        adjustment={editingAdjustment}
        onChange={(next) => {
          if (editingTileIndex !== null) {
            handleTileAdjustmentChange(editingTileIndex, next);
          }
        }}
      />

      {/* N3 — Share modal */}
      <Dialog open={shareModalOpen} onOpenChange={setShareModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="w-4 h-4 text-primary" />
              分享你的貼圖
            </DialogTitle>
            <DialogDescription>
              這個連結是公開的 — 任何人點開都能看到這組貼圖,但 <strong>看不到</strong> 你的原始大頭照。每次點擊會記錄一次瀏覽數。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
              <input
                type="text"
                readOnly
                value={shareUrl ?? ""}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 bg-transparent text-xs sm:text-sm outline-none truncate font-mono"
                data-testid="share-url-input"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCopyShareUrl}
                disabled={!shareUrl}
                className="rounded-md h-8 px-2"
                data-testid="button-share-copy"
              >
                {shareCopied ? (
                  <>
                    <Check className="w-3.5 h-3.5 mr-1 text-[#06C755]" />
                    <span className="text-xs">已複製</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 mr-1" />
                    <span className="text-xs">複製</span>
                  </>
                )}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (lineShareUrl) window.open(lineShareUrl, "_blank", "noopener,noreferrer");
                }}
                disabled={!lineShareUrl}
                className="rounded-full font-bold border-[#06C755]/30 hover:bg-[#06C755]/10 text-[#06C755]"
                data-testid="button-share-line"
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                分享到 LINE
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (fbShareUrl) window.open(fbShareUrl, "_blank", "noopener,noreferrer");
                }}
                disabled={!fbShareUrl}
                className="rounded-full font-bold border-[#1877F2]/30 hover:bg-[#1877F2]/10 text-[#1877F2]"
                data-testid="button-share-fb"
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                分享到 Facebook
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              💡 提示:這個連結永久有效,但雲端儲存中的貼圖檔案保留 7 天後會自動清除。如果想長期保存,請務必下載 ZIP 留底。
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <StickerLineExportDialog
        open={lineExportOpen}
        onOpenChange={(open) => {
          if (!isLineExporting) setLineExportOpen(open);
        }}
        tiles={tiles}
        texts={texts}
        sheetBase64={sheetBase64}
        guides={guides}
        adjustments={tileAdjustments}
        sourceImage={imageReady ? cachedImageRef.current : null}
        isExporting={isLineExporting}
        onConfirm={handleConfirmLineExport}
      />

      <div className="mt-10">
        <StickerHistory onOpen={onOpenHistory} />
      </div>
    </div>
  );
}
