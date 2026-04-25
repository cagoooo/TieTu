import { useCallback, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDefaultGuides, toImageDataUrl, type Guides } from "@/lib/sticker-utils";

const MIN_GAP = 0.01;

interface StickerCropperProps {
  sheetBase64: string;
  guides: Guides;
  onGuidesChange: (g: Guides) => void;
  resetCols?: number;
  resetRows?: number;
}

type Axis = "x" | "y";

interface DragState {
  axis: Axis;
  index: number;
}

export function StickerCropper({
  sheetBase64,
  guides,
  onGuidesChange,
  resetCols,
  resetRows,
}: StickerCropperProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);

  const updateCut = useCallback(
    (axis: Axis, index: number, rawValue: number) => {
      const arr = axis === "x" ? [...guides.xCuts] : [...guides.yCuts];
      const lower = index === 0 ? 0 : arr[index - 1] + MIN_GAP;
      const upper = index === arr.length - 1 ? 1 : arr[index + 1] - MIN_GAP;
      const clamped = Math.max(lower, Math.min(upper, rawValue));
      arr[index] = clamped;
      onGuidesChange(axis === "x" ? { ...guides, xCuts: arr } : { ...guides, yCuts: arr });
    },
    [guides, onGuidesChange],
  );

  const handlePointerDown = (axis: Axis, index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    setDragging({ axis, index });
  };

  const handlePointerMove = (axis: Axis, index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || dragging.axis !== axis || dragging.index !== index) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const value =
      axis === "x"
        ? (e.clientX - rect.left) / rect.width
        : (e.clientY - rect.top) / rect.height;
    updateCut(axis, index, value);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    setDragging(null);
  };

  const handleKeyDown = (axis: Axis, index: number) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!naturalSize) return;
    const dim = axis === "x" ? naturalSize.w : naturalSize.h;
    if (dim <= 0) return;
    const step = 1 / dim;
    const big = step * 10;
    const cur = axis === "x" ? guides.xCuts[index] : guides.yCuts[index];

    let delta = 0;
    if (axis === "x") {
      if (e.key === "ArrowLeft") delta = e.shiftKey ? -big : -step;
      else if (e.key === "ArrowRight") delta = e.shiftKey ? big : step;
    } else {
      if (e.key === "ArrowUp") delta = e.shiftKey ? -big : -step;
      else if (e.key === "ArrowDown") delta = e.shiftKey ? big : step;
    }

    if (delta !== 0) {
      e.preventDefault();
      updateCut(axis, index, cur + delta);
    }
  };

  const reset = () => onGuidesChange(getDefaultGuides(resetCols, resetRows));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          拖曳格線即可調整切割位置；點選後可用方向鍵微調 1px（按住 Shift 一次移動 10px）。
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={reset}
          className="rounded-full"
          data-testid="button-reset-guides"
        >
          <RotateCcw className="w-3 h-3 mr-2" />
          重設為平均切割
        </Button>
      </div>

      <div
        ref={containerRef}
        className="relative w-full select-none rounded-2xl overflow-hidden bg-[#7F7F7F] shadow-inner"
        style={{ touchAction: "none" }}
        data-testid="sticker-cropper-canvas"
      >
        <img
          src={toImageDataUrl(sheetBase64)}
          alt="貼圖整張預覽"
          className="block w-full h-auto pointer-events-none"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
          }}
        />

        {guides.xCuts.map((x, i) => {
          const isEdge = i === 0 || i === guides.xCuts.length - 1;
          const active = dragging?.axis === "x" && dragging?.index === i;
          const label = isEdge ? (i === 0 ? "左邊界" : "右邊界") : `垂直切割線 ${i}`;
          return (
            <div
              key={`x-${i}`}
              role="slider"
              aria-label={label}
              aria-orientation="vertical"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(x * 1000) / 10}
              tabIndex={0}
              onPointerDown={handlePointerDown("x", i)}
              onPointerMove={handlePointerMove("x", i)}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onKeyDown={handleKeyDown("x", i)}
              className="absolute top-0 bottom-0 cursor-ew-resize group focus:outline-none"
              style={{ left: `${x * 100}%`, width: 18, transform: "translateX(-50%)" }}
              data-testid={`guide-x-${i}`}
            >
              <div
                className={`absolute inset-y-0 left-1/2 -translate-x-1/2 transition-all ${
                  active
                    ? "w-1 bg-primary"
                    : "w-0.5 bg-white/85 group-hover:w-1 group-hover:bg-primary group-focus:w-1 group-focus:bg-primary"
                } shadow-[0_0_0_1px_rgba(0,0,0,0.45)]`}
              />
              <div
                className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow transition-all ${
                  active ? "w-5 h-5" : "w-3.5 h-3.5 opacity-80 group-hover:opacity-100 group-focus:opacity-100"
                }`}
              />
            </div>
          );
        })}

        {guides.yCuts.map((y, i) => {
          const isEdge = i === 0 || i === guides.yCuts.length - 1;
          const active = dragging?.axis === "y" && dragging?.index === i;
          const label = isEdge ? (i === 0 ? "上邊界" : "下邊界") : `水平切割線 ${i}`;
          return (
            <div
              key={`y-${i}`}
              role="slider"
              aria-label={label}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(y * 1000) / 10}
              tabIndex={0}
              onPointerDown={handlePointerDown("y", i)}
              onPointerMove={handlePointerMove("y", i)}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onKeyDown={handleKeyDown("y", i)}
              className="absolute left-0 right-0 cursor-ns-resize group focus:outline-none"
              style={{ top: `${y * 100}%`, height: 18, transform: "translateY(-50%)" }}
              data-testid={`guide-y-${i}`}
            >
              <div
                className={`absolute inset-x-0 top-1/2 -translate-y-1/2 transition-all ${
                  active
                    ? "h-1 bg-primary"
                    : "h-0.5 bg-white/85 group-hover:h-1 group-hover:bg-primary group-focus:h-1 group-focus:bg-primary"
                } shadow-[0_0_0_1px_rgba(0,0,0,0.45)]`}
              />
              <div
                className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow transition-all ${
                  active ? "w-5 h-5" : "w-3.5 h-3.5 opacity-80 group-hover:opacity-100 group-focus:opacity-100"
                }`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
