import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Download,
  FileArchive,
  ArrowLeft,
  Loader2,
  Minus,
  Plus,
  PackageCheck,
  ZoomIn,
  Eraser,
  CheckCircle2,
  ExternalLink,
  ScanText,
  AlertTriangle,
} from "lucide-react";
import { customFetch, ApiError } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
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
import { StickerCropper } from "./sticker-cropper";
import { StickerHistory } from "./sticker-history";
import { StickerLightbox } from "./sticker-lightbox";
import { StickerLineExportDialog } from "./sticker-line-export-dialog";
import { StickerTileEditor, type TileSourceRect } from "./sticker-tile-editor";
import { useToast } from "@/hooks/use-toast";
import type { HistoryEntry } from "@/lib/sticker-history";

interface StickerResultProps {
  sheetBase64: string;
  texts: string[];
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

export function StickerResult({ sheetBase64, texts, onBack, onOpenHistory }: StickerResultProps) {
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

  const handleVerifyOcr = async () => {
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
        toast({
          title: "文字辨識準確 ✅",
          description: `檢查 ${result.totalChecked} 張,平均相似度 ${matchPct}%。可放心下載。`,
        });
      } else {
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
      toast({
        title: "AI 文字辨識失敗",
        description: `${message}(請稍後再試,或確認網路是否暢通。)`,
        variant: "destructive",
      });
    }
  };

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

  return (
    <div className="w-full max-w-6xl mx-auto pb-20">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-4">
        <Button variant="ghost" onClick={onBack} className="rounded-full" data-testid="button-back">
          <ArrowLeft className="w-4 h-4 mr-2" />
          再做一組
        </Button>
        <div className="flex gap-3 flex-wrap justify-center">
          <Button
            variant="outline"
            onClick={handleDownloadSheet}
            className="rounded-full border-primary/20 hover:bg-primary/10 font-bold shadow-sm"
            data-testid="button-download-sheet"
          >
            <Download className="w-4 h-4 mr-2" />
            下載整張貼圖
          </Button>
          <Button
            onClick={handleDownloadZip}
            disabled={isZipping || tiles.length === 0}
            variant="outline"
            className="rounded-full border-primary/20 hover:bg-primary/10 font-bold shadow-sm"
            data-testid="button-download-zip"
          >
            {isZipping ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileArchive className="w-4 h-4 mr-2" />
            )}
            下載 {tileCount} 張單張 (ZIP)
          </Button>
          <Button
            onClick={handleOpenLineExport}
            disabled={isLineExporting || !isLineEligible || tiles.length === 0}
            title={
              isLineEligible
                ? `挑選 LINE 主圖與分頁圖，輸出符合規格的素材包（${LINE_TILE_W}×${LINE_TILE_H}、主圖 ${LINE_MAIN_SIZE}×${LINE_MAIN_SIZE}、分頁圖 ${LINE_TAB_W}×${LINE_TAB_H}）`
                : `LINE 規格需要剛好 ${LINE_STICKER_COUNT} 張，目前為 ${tileCount} 張。`
            }
            className="rounded-full font-bold shadow-md bg-[#06C755] hover:bg-[#05B14C] text-white"
            data-testid="button-download-line"
          >
            {isLineExporting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <PackageCheck className="w-4 h-4 mr-2" />
            )}
            下載 LINE 上架版 (ZIP)
          </Button>
        </div>
      </div>
      {!isLineEligible ? (
        <div className="-mt-4 mb-6 text-center">
          <p className="text-xs text-muted-foreground" data-testid="line-eligibility-note">
            想輸出 LINE 上架版？請將切割數量調整為剛好 {LINE_STICKER_COUNT} 張（目前為 {tileCount} 張）。
          </p>
        </div>
      ) : (
        <div className="-mt-4 mb-6 flex justify-center">
          <div
            className="max-w-md w-full rounded-2xl border border-[#06C755]/30 bg-[#06C755]/5 p-4"
            data-testid="line-upload-hint"
          >
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#06C755] shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <h4 className="font-bold text-sm text-foreground">如何上架？</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  下載 LINE 上架版 ZIP 後，直接前往 LINE Creators Market 上傳壓縮檔即可申請。
                </p>
                <a
                  href="https://creator.line.me/zh-hant/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-bold text-[#06C755] hover:text-[#05B14C] transition-colors"
                  data-testid="line-creator-link"
                >
                  前往 LINE 個人原創市集
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-7">
          <Card className="border-2 border-primary/15 shadow-xl rounded-3xl">
            <CardContent className="p-5 sm:p-6 space-y-4">
              <div>
                <h3 className="text-lg font-bold mb-1">調整切割線</h3>
                <p className="text-xs text-muted-foreground">
                  生成結果若有歪斜或邊距不均，可拖曳格線校正後再下載。
                </p>
              </div>

              <div
                className="rounded-2xl border border-border bg-muted/40 p-3 sm:p-4"
                data-testid="grid-controls"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-bold">切割數量</p>
                    <p className="text-xs text-muted-foreground">
                      若 AI 產出的張數與預設不同，可在這裡改成符合的欄列數。
                    </p>
                  </div>
                  <div className="flex items-center gap-4 flex-wrap">
                    <Stepper
                      label="欄"
                      value={cols}
                      min={MIN_COLS}
                      max={MAX_COLS}
                      onChange={setCols}
                      testIdPrefix="cols-stepper"
                    />
                    <Stepper
                      label="列"
                      value={rows}
                      min={MIN_ROWS}
                      max={MAX_ROWS}
                      onChange={setRows}
                      testIdPrefix="rows-stepper"
                    />
                    <span
                      className="text-xs text-muted-foreground tabular-nums"
                      data-testid="grid-summary"
                    >
                      = {tileCount} 張
                    </span>
                  </div>
                </div>
              </div>

              <StickerCropper
                sheetBase64={sheetBase64}
                guides={guides}
                onGuidesChange={setGuides}
                resetCols={cols}
                resetRows={rows}
              />
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-5">
          <Card className="border-2 border-primary/20 shadow-xl rounded-3xl lg:sticky lg:top-8">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">切割預覽（{tileCount} 張）</h3>
                {isSplitting && (
                  <span className="flex items-center text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    更新中
                  </span>
                )}
              </div>

              {/* 一鍵去背控制:影響預覽 + 下載 ZIP / 整張 PNG */}
              <div
                className="rounded-2xl border border-border bg-muted/40 p-3 sm:p-4 mb-4"
                data-testid="matte-controls"
              >
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="matte-toggle"
                    className="flex items-center justify-between gap-3 cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Eraser className="w-4 h-4 text-primary" />
                      <span className="text-sm font-bold">一鍵去背(LINE 適用)</span>
                    </div>
                    <Switch
                      id="matte-toggle"
                      checked={matteEnabled}
                      onCheckedChange={setMatteEnabled}
                      data-testid="matte-toggle"
                    />
                  </label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    開啟後將自動去除每張貼圖的灰色背景,讓下載的 24 張 PNG 直接是透明背景,適合上傳 LINE 個人原創貼圖。
                  </p>
                  {matteEnabled && (
                    <div className="flex items-center gap-3 pt-2">
                      <span className="text-xs font-medium text-foreground/80 w-12 shrink-0">
                        強度
                      </span>
                      <Slider
                        min={MATTE_TOLERANCE_MIN}
                        max={MATTE_TOLERANCE_MAX}
                        step={1}
                        value={[matteTolerance]}
                        onValueChange={(v) =>
                          setMatteTolerance(clampMatteTolerance(v[0]))
                        }
                        className="flex-1"
                        data-testid="matte-tolerance-slider"
                      />
                      <span
                        className="text-xs tabular-nums w-8 text-right font-bold"
                        data-testid="matte-tolerance-value"
                      >
                        {matteTolerance}
                      </span>
                    </div>
                  )}
                  {matteEnabled && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">
                      強度越高去得越乾淨,但角色邊緣可能被誤切。建議從預設 {DEFAULT_MATTE_TOLERANCE} 開始試。
                    </p>
                  )}
                </div>
              </div>

              {/* 文字準確度檢查 (Gemini Vision multimodal verification) */}
              <div
                className="rounded-2xl border border-border bg-muted/40 p-3 sm:p-4 mb-4"
                data-testid="ocr-controls"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <ScanText className="w-4 h-4 text-primary" />
                      <span className="text-sm font-bold">AI 文字準確度檢查</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleVerifyOcr}
                      disabled={ocrState === "loading" || !sheetBase64}
                      className="rounded-full text-xs h-8"
                      data-testid="ocr-verify-button"
                    >
                      {ocrState === "loading" ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          AI 辨識中...
                        </>
                      ) : ocrResult ? (
                        <>
                          <ScanText className="w-3 h-3 mr-1" />
                          重新檢查
                        </>
                      ) : (
                        <>
                          <ScanText className="w-3 h-3 mr-1" />
                          檢查文字準確度
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    AI 偶爾會把中文寫成形似的錯字。點上方按鈕會用 Gemini Vision 一次讀完整張 24 格,告訴你哪幾格可能寫錯了。中英文混合(Hi、YA)都能辨識。
                  </p>
                  {ocrError && (
                    <p className="text-[11px] text-destructive font-medium leading-relaxed pt-1">
                      錯誤:{ocrError}
                    </p>
                  )}
                  {ocrResult && (
                    <div className="mt-2 rounded-xl bg-background/80 border border-border p-3 space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        {ocrResult.mismatches.length === 0 ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-[#06C755]" />
                            <span className="font-bold text-foreground">全部正確!</span>
                            <span className="text-muted-foreground">
                              檢查 {ocrResult.totalChecked} 張,平均相似度 {Math.round(ocrResult.averageSimilarity * 100)}%。
                            </span>
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                            <span className="font-bold text-foreground">
                              {ocrResult.mismatches.length} 處可能寫錯
                            </span>
                            <span className="text-muted-foreground">
                              (檢查 {ocrResult.totalChecked} 張,平均相似度 {Math.round(ocrResult.averageSimilarity * 100)}%)
                            </span>
                          </>
                        )}
                      </div>
                      {ocrResult.mismatches.length > 0 && (
                        <ul className="space-y-1 pt-1">
                          {ocrResult.mismatches.map((m) => (
                            <li
                              key={m.index}
                              className="text-xs text-foreground/90 flex items-center gap-2"
                            >
                              <span className="inline-flex w-6 h-6 rounded-full bg-amber-500/15 text-amber-700 items-center justify-center font-bold">
                                {m.index + 1}
                              </span>
                              <span>
                                期待<strong>「{m.expected}」</strong>
                                ,但 AI 看到
                                <strong className="text-amber-700">「{m.recognized || "(空白)"}」</strong>
                                <span className="text-muted-foreground ml-1">
                                  ({Math.round(m.similarity * 100)}% 相符)
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {ocrResult.mismatches.length > 0 && (
                        <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">
                          建議:點「再做一組」回上頁,把錯誤的格子文字稍微改寫(如加標點、換同義詞),再重新生成。
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div
                className="rounded-2xl p-3"
                style={
                  matteEnabled
                    ? {
                        // 透明 checker pattern,讓使用者看清去背效果
                        backgroundColor: "#ffffff",
                        backgroundImage:
                          "linear-gradient(45deg, #d1d5db 25%, transparent 25%), linear-gradient(-45deg, #d1d5db 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d1d5db 75%), linear-gradient(-45deg, transparent 75%, #d1d5db 75%)",
                        backgroundSize: "16px 16px",
                        backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
                      }
                    : { backgroundColor: "#7F7F7F" }
                }
              >
                <motion.div
                  variants={container}
                  initial="hidden"
                  animate="show"
                  className="grid gap-2"
                  style={previewGridStyle}
                  data-testid="tile-preview-grid"
                >
                  {tiles.map((tile, i) => {
                    const adjusted = !isTileAdjustmentDefault(tileAdjustments[i]);
                    return (
                      <motion.div
                        key={i}
                        variants={item}
                        className="relative aspect-square rounded-lg overflow-hidden shadow bg-white/10"
                      >
                        <button
                          type="button"
                          onClick={() => setLightboxIndex(i)}
                          className="group relative block w-full h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#7F7F7F]"
                          aria-label={`放大檢視第 ${i + 1} 張${texts[i] ? `「${texts[i]}」` : ""}`}
                          data-testid={`tile-preview-${i}`}
                        >
                          <img
                            src={tile}
                            alt={texts[i] || `Sticker ${i + 1}`}
                            className="w-full h-full object-contain"
                            data-testid={`tile-${i}`}
                          />
                          <div className="pointer-events-none absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 rounded-full bg-white/95 text-foreground px-2 py-1 text-[10px] font-bold shadow">
                              <ZoomIn className="w-3 h-3" />
                              點擊放大
                            </span>
                          </div>
                          {adjusted && (
                            <span
                              className="absolute top-1 right-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 shadow"
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
                      className="h-32 flex items-center justify-center text-sm text-muted-foreground"
                      style={{ gridColumn: `span ${Math.max(1, cols)} / span ${Math.max(1, cols)}` }}
                    >
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      正在裁切貼圖...
                    </div>
                  )}
                </motion.div>
              </div>
              <p className="text-xs text-muted-foreground mt-4 text-center leading-relaxed">
                這份預覽會即時依照你調整的切割線更新；點任一張可放大檢視，並可在彈窗內進入單張微調。
                {adjustedTileCount > 0 && (
                  <>
                    <br />
                    <span data-testid="adjusted-summary">
                      已微調 {adjustedTileCount} 張，下載 ZIP 與 LINE 上架版時會一起套用。
                    </span>
                  </>
                )}
              </p>
            </CardContent>
          </Card>
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
