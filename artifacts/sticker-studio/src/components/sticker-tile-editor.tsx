import { useEffect, useMemo, useRef, useState } from "react";
import { Move, RotateCw, ZoomIn, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  DEFAULT_TILE_ADJUSTMENT,
  TILE_OFFSET_MAX,
  TILE_ROTATION_MAX,
  TILE_SCALE_MAX,
  TILE_SCALE_MIN,
  clampTileAdjustment,
  drawAdjustedTile,
  isTileAdjustmentDefault,
  type TileAdjustment,
} from "@/lib/sticker-utils";

export interface TileSourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

interface StickerTileEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tileIndex: number | null;
  totalTiles: number;
  label?: string;
  sourceImage: HTMLImageElement | null;
  sourceRect: TileSourceRect | null;
  adjustment: TileAdjustment;
  onChange: (next: TileAdjustment) => void;
}

const OFFSET_PCT_MAX = Math.round(TILE_OFFSET_MAX * 100);
const PREVIEW_PX = 240;

export function StickerTileEditor({
  open,
  onOpenChange,
  tileIndex,
  totalTiles,
  label,
  sourceImage,
  sourceRect,
  adjustment,
  onChange,
}: StickerTileEditorProps) {
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragStartRef = useRef<
    | {
        pointerId: number;
        offsetX: number;
        offsetY: number;
        startX: number;
        startY: number;
      }
    | null
  >(null);
  const [draftAdjustment, setDraftAdjustment] = useState<TileAdjustment>(adjustment);

  useEffect(() => {
    if (open) setDraftAdjustment(adjustment);
  }, [open, adjustment]);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas || !sourceImage || !sourceRect) return;
    const { sx, sy, sw, sh } = sourceRect;
    if (sw <= 0 || sh <= 0) return;
    const aspect = sw / sh;
    const outW = aspect >= 1 ? PREVIEW_PX : Math.round(PREVIEW_PX * aspect);
    const outH = aspect >= 1 ? Math.round(PREVIEW_PX / aspect) : PREVIEW_PX;
    const rendered = drawAdjustedTile(sourceImage, sx, sy, sw, sh, outW, outH, draftAdjustment);
    canvas.width = rendered.width;
    canvas.height = rendered.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(rendered, 0, 0);
  }, [open, sourceImage, sourceRect, draftAdjustment]);

  const apply = (next: TileAdjustment) => {
    const clamped = clampTileAdjustment(next);
    setDraftAdjustment(clamped);
    onChange(clamped);
  };

  const handleReset = () => {
    apply({ ...DEFAULT_TILE_ADJUSTMENT });
  };

  const handlePreviewPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!previewWrapRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = {
      pointerId: e.pointerId,
      offsetX: draftAdjustment.offsetX,
      offsetY: draftAdjustment.offsetY,
      startX: e.clientX,
      startY: e.clientY,
    };
  };

  const handlePreviewPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== e.pointerId) return;
    const rect = previewWrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const dx = (e.clientX - start.startX) / rect.width;
    const dy = (e.clientY - start.startY) / rect.height;
    apply({
      ...draftAdjustment,
      offsetX: start.offsetX + dx,
      offsetY: start.offsetY + dy,
    });
  };

  const handlePreviewPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    if (e.currentTarget.hasPointerCapture(start.pointerId)) {
      e.currentTarget.releasePointerCapture(start.pointerId);
    }
    dragStartRef.current = null;
  };

  const isDirty = !isTileAdjustmentDefault(draftAdjustment);
  const tileNumber = tileIndex !== null ? tileIndex + 1 : 0;

  const aspectStyle = useMemo(() => {
    if (!sourceRect || sourceRect.sw <= 0 || sourceRect.sh <= 0) return undefined;
    return { aspectRatio: `${sourceRect.sw} / ${sourceRect.sh}` };
  }, [sourceRect]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg" data-testid="single-tile-editor">
        <DialogHeader>
          <DialogTitle>
            微調第 {tileNumber} 張{label ? `「${label}」` : ""}
          </DialogTitle>
          <DialogDescription>
            如果這張貼圖有點歪斜或位置不齊，可在這裡稍微旋轉、平移幾個像素或微縮放。平移百分比是以這張貼圖的寬高為基準（例如 1% 約等於幾個像素）。原本拖曳整張的切割線功能不受影響。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            ref={previewWrapRef}
            className="relative mx-auto w-full max-w-[240px] rounded-2xl overflow-hidden bg-[#7F7F7F] shadow-inner touch-none cursor-grab active:cursor-grabbing"
            style={aspectStyle ?? { aspectRatio: "1 / 1" }}
            onPointerDown={handlePreviewPointerDown}
            onPointerMove={handlePreviewPointerMove}
            onPointerUp={handlePreviewPointerUp}
            onPointerCancel={handlePreviewPointerUp}
            data-testid="single-tile-editor-preview"
          >
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
              aria-label={`第 ${tileNumber} 張預覽`}
            />
            <div className="pointer-events-none absolute inset-0 border border-white/20" />
            <div className="pointer-events-none absolute left-1/2 top-0 bottom-0 w-px bg-white/15" />
            <div className="pointer-events-none absolute top-1/2 left-0 right-0 h-px bg-white/15" />
          </div>

          <div className="space-y-3">
            <SliderRow
              icon={<RotateCw className="w-3.5 h-3.5" />}
              label="旋轉"
              suffix="°"
              value={draftAdjustment.rotation}
              min={-TILE_ROTATION_MAX}
              max={TILE_ROTATION_MAX}
              step={1}
              onChange={(v) => apply({ ...draftAdjustment, rotation: v })}
              testId="single-tile-rotation"
            />
            <SliderRow
              icon={<Move className="w-3.5 h-3.5" />}
              label="左右平移"
              suffix="%"
              value={Math.round(draftAdjustment.offsetX * 100)}
              min={-OFFSET_PCT_MAX}
              max={OFFSET_PCT_MAX}
              step={1}
              onChange={(v) => apply({ ...draftAdjustment, offsetX: v / 100 })}
              testId="single-tile-offset-x"
            />
            <SliderRow
              icon={<Move className="w-3.5 h-3.5 rotate-90" />}
              label="上下平移"
              suffix="%"
              value={Math.round(draftAdjustment.offsetY * 100)}
              min={-OFFSET_PCT_MAX}
              max={OFFSET_PCT_MAX}
              step={1}
              onChange={(v) => apply({ ...draftAdjustment, offsetY: v / 100 })}
              testId="single-tile-offset-y"
            />
            <SliderRow
              icon={<ZoomIn className="w-3.5 h-3.5" />}
              label="縮放"
              suffix="%"
              value={Math.round(draftAdjustment.scale * 100)}
              min={Math.round(TILE_SCALE_MIN * 100)}
              max={Math.round(TILE_SCALE_MAX * 100)}
              step={1}
              onChange={(v) => apply({ ...draftAdjustment, scale: v / 100 })}
              testId="single-tile-scale"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            提示：直接拖曳上方預覽也能微調位置。第 {tileNumber} / {totalTiles} 張，套用後會反映到單張預覽與下載 ZIP。
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={handleReset}
            disabled={!isDirty}
            className="rounded-full"
            data-testid="single-tile-reset"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            還原這張
          </Button>
          <Button
            onClick={() => onOpenChange(false)}
            className="rounded-full"
            data-testid="single-tile-done"
          >
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SliderRowProps {
  icon: React.ReactNode;
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  testId: string;
}

function SliderRow({ icon, label, suffix, value, min, max, step, onChange, testId }: SliderRowProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-foreground/80 font-medium">
          {icon}
          {label}
        </span>
        <span className="tabular-nums text-muted-foreground" data-testid={`${testId}-value`}>
          {value}
          {suffix}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0] ?? 0)}
        data-testid={testId}
      />
    </div>
  );
}
