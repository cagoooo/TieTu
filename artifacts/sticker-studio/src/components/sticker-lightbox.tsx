import { useCallback, useEffect } from "react";
import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface StickerLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tiles: string[];
  texts: string[];
  index: number | null;
  onIndexChange: (next: number) => void;
  adjustedSet: Set<number>;
  onEdit?: (index: number) => void;
}

export function StickerLightbox({
  open,
  onOpenChange,
  tiles,
  texts,
  index,
  onIndexChange,
  adjustedSet,
  onEdit,
}: StickerLightboxProps) {
  const total = tiles.length;
  const safeIndex = index ?? 0;
  const hasTiles = total > 0 && index !== null && index >= 0 && index < total;

  const goPrev = useCallback(() => {
    if (total === 0 || index === null) return;
    onIndexChange((index - 1 + total) % total);
  }, [index, total, onIndexChange]);

  const goNext = useCallback(() => {
    if (total === 0 || index === null) return;
    onIndexChange((index + 1) % total);
  }, [index, total, onIndexChange]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, goPrev, goNext]);

  const tileSrc = hasTiles ? tiles[safeIndex] : undefined;
  const tileText = hasTiles ? texts[safeIndex] ?? "" : "";
  const tileNumber = safeIndex + 1;
  const isAdjusted = hasTiles && adjustedSet.has(safeIndex);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl p-0 overflow-hidden bg-background"
        data-testid="sticker-lightbox"
      >
        <DialogTitle className="sr-only">
          {hasTiles
            ? `第 ${tileNumber} 張${tileText ? `「${tileText}」` : ""} 放大檢視`
            : "貼圖放大檢視"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          使用左右鍵或下方按鈕在 {total} 張之間切換，按 ESC 或點擊外部關閉。
        </DialogDescription>

        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground" data-testid="lightbox-index">
                第 {tileNumber} / {total} 張
              </p>
              <p
                className="text-xs text-muted-foreground truncate"
                data-testid="lightbox-label"
                title={tileText}
              >
                {tileText ? `「${tileText}」` : "（這張沒有文字）"}
                {isAdjusted && (
                  <span className="ml-2 inline-block rounded-full bg-primary/15 text-primary px-1.5 py-0.5 text-[10px] font-bold align-middle">
                    已微調
                  </span>
                )}
              </p>
            </div>
            {onEdit && hasTiles && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onEdit(safeIndex)}
                className="rounded-full shrink-0"
                data-testid="lightbox-edit"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
                微調這張
              </Button>
            )}
          </div>

          <div className="relative bg-[#7F7F7F] mx-5 mb-3 rounded-2xl overflow-hidden">
            <div className="aspect-square w-full flex items-center justify-center">
              {tileSrc ? (
                <img
                  src={tileSrc}
                  alt={tileText || `Sticker ${tileNumber}`}
                  className="max-w-full max-h-full object-contain"
                  style={{ imageRendering: "pixelated" }}
                  data-testid="lightbox-image"
                />
              ) : null}
            </div>
            {total > 1 && (
              <>
                <button
                  type="button"
                  onClick={goPrev}
                  aria-label="上一張"
                  className="absolute left-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-10 h-10 rounded-full bg-black/40 text-white hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  data-testid="lightbox-prev"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  aria-label="下一張"
                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-10 h-10 rounded-full bg-black/40 text-white hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  data-testid="lightbox-next"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </>
            )}
          </div>

          <p className="px-5 pb-5 text-[11px] text-muted-foreground text-center leading-relaxed">
            可用 ← / → 切換，按 ESC 或點擊外部關閉。預覽顯示的是切割後的完整像素，下載 ZIP 會輸出相同內容。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
