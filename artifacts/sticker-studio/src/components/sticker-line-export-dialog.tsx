import { useEffect, useRef, useState } from "react";
import { Loader2, PackageCheck, Check, RotateCcw, Eraser } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  buildLineTilePreview,
  clampMatteTolerance,
  DEFAULT_MATTE_TOLERANCE,
  LINE_MAIN_SIZE,
  LINE_TAB_W,
  LINE_TAB_H,
  MATTE_TOLERANCE_MAX,
  MATTE_TOLERANCE_MIN,
  type Guides,
  type TileAdjustments,
} from "@/lib/sticker-utils";

interface StickerLineExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tiles: string[];
  texts: string[];
  sheetBase64: string;
  guides: Guides;
  adjustments: TileAdjustments;
  sourceImage: HTMLImageElement | null;
  isExporting: boolean;
  onConfirm: (mainTileIndex: number, tabTileIndex: number, tolerance: number) => void;
}

const CHECKER_BG =
  "repeating-conic-gradient(#e5e7eb 0% 25%, #ffffff 0% 50%) 50% / 16px 16px";

export function StickerLineExportDialog({
  open,
  onOpenChange,
  tiles,
  texts,
  sheetBase64,
  guides,
  adjustments,
  sourceImage,
  isExporting,
  onConfirm,
}: StickerLineExportDialogProps) {
  const [mainIndex, setMainIndex] = useState(0);
  const [tabFollowsMain, setTabFollowsMain] = useState(true);
  const [tabIndex, setTabIndex] = useState(0);
  const [tolerance, setTolerance] = useState<number>(DEFAULT_MATTE_TOLERANCE);
  const [mainPreview, setMainPreview] = useState<string | null>(null);
  const [tabPreview, setTabPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewVersionRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setMainIndex((prev) => (prev >= tiles.length ? 0 : prev));
    setTabIndex((prev) => (prev >= tiles.length ? 0 : prev));
  }, [open, tiles.length]);

  const effectiveTabIndex = tabFollowsMain ? mainIndex : tabIndex;
  const isToleranceDefault = tolerance === DEFAULT_MATTE_TOLERANCE;

  useEffect(() => {
    if (!open) {
      // Bumping the version invalidates any in-flight preview run from a
      // previous open so that its late `setPreviewLoading(false)` is skipped,
      // and we clear the spinner immediately so reopening starts clean.
      previewVersionRef.current += 1;
      setPreviewLoading(false);
      return;
    }
    if (!sourceImage) {
      setMainPreview(null);
      setTabPreview(null);
      setPreviewLoading(false);
      return;
    }
    const myVersion = ++previewVersionRef.current;
    setPreviewLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const main = await buildLineTilePreview(
          sheetBase64,
          guides,
          mainIndex,
          LINE_MAIN_SIZE,
          LINE_MAIN_SIZE,
          sourceImage,
          adjustments[mainIndex],
          tolerance,
        );
        const tab = await buildLineTilePreview(
          sheetBase64,
          guides,
          effectiveTabIndex,
          LINE_TAB_W,
          LINE_TAB_H,
          sourceImage,
          adjustments[effectiveTabIndex],
          tolerance,
        );
        if (cancelled || previewVersionRef.current !== myVersion) return;
        setMainPreview(main);
        setTabPreview(tab);
      } catch (err) {
        console.error("Failed to build LINE preview", err);
      } finally {
        if (previewVersionRef.current === myVersion) {
          setPreviewLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sourceImage, sheetBase64, guides, adjustments, mainIndex, effectiveTabIndex, tolerance]);

  const mainText = texts[mainIndex] ?? "";
  const tabText = texts[effectiveTabIndex] ?? "";

  const renderTileGrid = (
    selectedIndex: number,
    onSelect: (i: number) => void,
    testIdPrefix: string,
    disabled = false,
  ) => (
    <div
      className="grid grid-cols-6 gap-1.5 p-2 rounded-xl bg-[#7F7F7F] max-h-64 overflow-y-auto"
      data-testid={`${testIdPrefix}-grid`}
    >
      {tiles.map((src, i) => {
        const selected = i === selectedIndex;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            disabled={disabled}
            className={`relative aspect-square rounded-md overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#7F7F7F] transition-all ${
              selected
                ? "ring-2 ring-primary scale-[1.04] shadow-md"
                : "ring-1 ring-white/20 hover:ring-white/60"
            } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
            data-testid={`${testIdPrefix}-option-${i}`}
            aria-label={`選擇第 ${i + 1} 張${texts[i] ? `「${texts[i]}」` : ""}`}
            aria-pressed={selected}
            title={texts[i] || `第 ${i + 1} 張`}
          >
            <img
              src={src}
              alt={texts[i] || `Sticker ${i + 1}`}
              className="w-full h-full object-contain"
            />
            <span className="absolute bottom-0 left-0 right-0 text-[9px] font-bold text-white bg-black/50 px-1 py-0.5 leading-none truncate">
              {i + 1}
            </span>
            {selected && (
              <span
                className="absolute top-0.5 right-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground shadow"
                data-testid={`${testIdPrefix}-selected-marker`}
              >
                <Check className="w-3 h-3" strokeWidth={3} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  const previewBox = (
    <div
      className="rounded-xl border-2 border-dashed border-border p-3 flex flex-col items-center gap-2"
      data-testid="line-export-preview"
    >
      <p className="text-xs font-bold text-foreground/80">輸出預覽</p>
      <div className="flex items-end gap-4 flex-wrap justify-center">
        <div className="flex flex-col items-center gap-1">
          <div
            className="rounded-lg overflow-hidden shadow-sm border border-border flex items-center justify-center"
            style={{
              width: LINE_MAIN_SIZE / 2,
              height: LINE_MAIN_SIZE / 2,
              background: CHECKER_BG,
            }}
            data-testid="preview-main"
          >
            {mainPreview ? (
              <img
                src={mainPreview}
                alt="主圖預覽"
                className="w-full h-full object-contain"
              />
            ) : (
              <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            主圖 {LINE_MAIN_SIZE}×{LINE_MAIN_SIZE}
          </p>
          <p
            className="text-[10px] text-muted-foreground max-w-[120px] truncate text-center"
            title={mainText}
          >
            {mainText ? `「${mainText}」` : "（無文字）"}
          </p>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div
            className="rounded-lg overflow-hidden shadow-sm border border-border flex items-center justify-center"
            style={{
              width: LINE_TAB_W,
              height: LINE_TAB_H,
              background: CHECKER_BG,
            }}
            data-testid="preview-tab"
          >
            {tabPreview ? (
              <img
                src={tabPreview}
                alt="分頁圖預覽"
                className="w-full h-full object-contain"
              />
            ) : (
              <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            分頁圖 {LINE_TAB_W}×{LINE_TAB_H}
          </p>
          <p
            className="text-[10px] text-muted-foreground max-w-[140px] truncate text-center"
            title={tabText}
          >
            {tabText ? `「${tabText}」` : "（無文字）"}
          </p>
        </div>
      </div>
      {previewLoading && (
        <p className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          產生預覽中…
        </p>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[92vh] overflow-y-auto"
        data-testid="line-export-dialog"
      >
        <DialogHeader>
          <DialogTitle>選擇 LINE 主圖與分頁圖</DialogTitle>
          <DialogDescription>
            主圖（{LINE_MAIN_SIZE}×{LINE_MAIN_SIZE}）會顯示在 LINE 商店與貼圖選擇器，分頁圖（
            {LINE_TAB_W}×{LINE_TAB_H}）會顯示在聊天室分頁。請從 {tiles.length} 張中各挑一張。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h4 className="text-sm font-bold">主圖</h4>
              <span className="text-xs text-muted-foreground" data-testid="main-selected-label">
                目前選擇：第 {mainIndex + 1} 張{mainText ? `「${mainText}」` : ""}
              </span>
            </div>
            {renderTileGrid(mainIndex, setMainIndex, "main-tile")}
          </section>

          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h4 className="text-sm font-bold">分頁圖</h4>
              <div className="flex items-center gap-2">
                <Switch
                  id="tab-follows-main"
                  checked={tabFollowsMain}
                  onCheckedChange={setTabFollowsMain}
                  data-testid="switch-tab-follows-main"
                />
                <Label htmlFor="tab-follows-main" className="text-xs cursor-pointer">
                  與主圖相同
                </Label>
              </div>
            </div>
            <p
              className="text-xs text-muted-foreground"
              data-testid="tab-selected-label"
            >
              目前選擇：第 {effectiveTabIndex + 1} 張{tabText ? `「${tabText}」` : ""}
              {tabFollowsMain && "（沿用主圖）"}
            </p>
            {!tabFollowsMain && renderTileGrid(tabIndex, setTabIndex, "tab-tile")}
          </section>

          <section className="space-y-2 rounded-xl border border-border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Eraser className="w-4 h-4 text-foreground/70" />
                <h4 className="text-sm font-bold">自動去背強度</h4>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-bold tabular-nums w-9 text-right"
                  data-testid="tolerance-value"
                >
                  {tolerance}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => setTolerance(DEFAULT_MATTE_TOLERANCE)}
                  disabled={isToleranceDefault}
                  className="rounded-full h-7 px-2 text-xs"
                  data-testid="tolerance-reset"
                >
                  <RotateCcw className="w-3 h-3 mr-1" />
                  預設
                </Button>
              </div>
            </div>
            <Slider
              value={[tolerance]}
              min={MATTE_TOLERANCE_MIN}
              max={MATTE_TOLERANCE_MAX}
              step={1}
              onValueChange={(values) => {
                if (values.length > 0) setTolerance(clampMatteTolerance(values[0]));
              }}
              data-testid="tolerance-slider"
              aria-label="自動去背強度"
            />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              拉高可以把更深的灰底一起去乾淨；若邊緣出現缺角或角色變透明，請往低調整。預設值 {DEFAULT_MATTE_TOLERANCE} 適合大多數情況。
            </p>
          </section>

          {previewBox}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isExporting}
            className="rounded-full"
            data-testid="line-export-cancel"
          >
            取消
          </Button>
          <Button
            onClick={() => onConfirm(mainIndex, effectiveTabIndex, tolerance)}
            disabled={isExporting || tiles.length === 0}
            className="rounded-full font-bold bg-[#06C755] hover:bg-[#05B14C] text-white"
            data-testid="line-export-confirm"
          >
            {isExporting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <PackageCheck className="w-4 h-4 mr-2" />
            )}
            確認下載
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
