// gacha/primitives.tsx — 盲盒扭蛋改版的原語元件。
// 來源：design_handoff_gacha_redesign/prototype/ss-tokens.jsx
//
// 設計鐵則（寫成 Tailwind class，少數 gradient / 硬陰影用 inline style）：
//   · 粗描邊 border-[3px] border-ink（細版 2–2.5px）
//   · 立體硬陰影（非模糊）0 5–8px 0 ink ＝ 玩具感關鍵
//   · 膠囊質感 linear-gradient(165deg,#fff 26%,<色>) + 內白光 + 中線 seam + 反光

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { capColor } from "./tokens";

// ── 裁切標記（carton 四角的十字 registration mark）──────────────────────────
export function RegMark({ className }: { className?: string }) {
  return (
    <div
      className={cn("pointer-events-none absolute h-5 w-5 opacity-45", className)}
      aria-hidden="true"
    >
      <span className="absolute left-[9px] top-0 h-5 w-0.5 bg-ink" />
      <span className="absolute left-0 top-[9px] h-0.5 w-5 bg-ink" />
    </div>
  );
}

// ── 膠囊（扭蛋球）外殼。內容物由 children 提供（公仔 / 大頭照 / 文字）；
//    無 children 時顯示「?」盲盒未開封狀態。──────────────────────────────────
interface CapsuleProps {
  /** 取色用的序號（依 index % 5 對應五彩膠囊色） */
  index: number;
  /** 固定直徑（px）。省略時膠囊球填滿外層寬度（aspect-square），可隨 grid 縮放。 */
  size?: number;
  label?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** 膠囊球本體額外 class（例如響應式直徑上限） */
  ballClassName?: string;
}

export function Capsule({ index, size, label, children, className, ballClassName }: CapsuleProps) {
  const color = capColor(index);
  const fluid = size == null;
  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div
        className={cn(
          "relative aspect-square overflow-hidden rounded-full border-2 border-black/[0.06]",
          fluid && "w-full",
          ballClassName,
        )}
        style={{
          ...(fluid ? null : { width: size, height: size }),
          background: `linear-gradient(165deg, #fff 26%, ${color})`,
          boxShadow: "0 7px 0 rgba(0,0,0,.10), inset 0 -9px 16px rgba(255,255,255,.65)",
        }}
      >
        {/* 赤道接縫 */}
        <span className="absolute inset-x-0 top-[46%] h-0.5 bg-black/[0.08]" />
        {/* 左上反光 */}
        <span className="absolute left-[14%] top-[8%] h-[24%] w-[34%] rounded-full bg-white/70 blur-[2px]" />
        {children ?? (
          <span className="absolute inset-0 grid place-items-center font-display text-2xl font-bold text-ink/20">
            ?
          </span>
        )}
      </div>
      {label && (
        <div className="font-display text-[11px] font-semibold tracking-[0.06em] text-ink/70">{label}</div>
      )}
    </div>
  );
}

/** 膠囊內的「公仔 / 透明 PNG 貼圖」：坐在底部、86% 寬、帶投影。 */
export function CapsuleFigure({ src, alt = "" }: { src: string; alt?: string }) {
  return (
    <img
      src={src}
      alt={alt}
      className="absolute bottom-[4%] left-1/2 w-[86%] -translate-x-1/2"
      style={{ filter: "drop-shadow(0 3px 3px rgba(0,0,0,.22))" }}
    />
  );
}

/** 膠囊內的「大頭照」：圓形 cover 填滿（上傳後的 hero teaser）。 */
export function CapsuleAvatar({ src, alt = "" }: { src: string; alt?: string }) {
  return (
    <span className="absolute inset-[14%] overflow-hidden rounded-full border-2 border-white/80 shadow-inner">
      <img src={src} alt={alt} className="h-full w-full object-cover" />
    </span>
  );
}

// ── 條碼（carton 頁尾左側）──────────────────────────────────────────────────
const BARCODE_WIDTHS = [3, 1, 2, 1, 3, 2, 1, 1, 3, 1, 2, 3, 1, 2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 3, 1, 2, 1, 3];

export function Barcode({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-[26px] items-end gap-0.5", className)} aria-hidden="true">
      {BARCODE_WIDTHS.map((w, i) => (
        <span key={i} className="block h-[26px] bg-ink" style={{ width: w }} />
      ))}
    </div>
  );
}

// ── 編號步驟標題（「① 投入大頭照」）──────────────────────────────────────────
interface StepBadgeProps {
  n: number;
  label: ReactNode;
  hint?: ReactNode;
  /** 徽章底色 class（預設 coral）。 */
  badgeClassName?: string;
  className?: string;
  /** 右側附加內容（例如「恢復預設 / 依主題改寫」按鈕） */
  actions?: ReactNode;
}

export function StepBadge({ n, label, hint, badgeClassName, className, actions }: StepBadgeProps) {
  return (
    <div className={cn("flex items-center gap-[11px]", className)}>
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-[10px] font-display text-[17px] font-bold text-white",
          badgeClassName ?? "bg-coral",
        )}
        style={{ boxShadow: "0 3px 0 rgba(0,0,0,.18)" }}
        aria-hidden="true"
      >
        {n}
      </span>
      <span className="text-[18px] font-extrabold text-ink">{label}</span>
      {hint && <span className="text-[12.5px] font-semibold text-ink/40">{hint}</span>}
      {actions && <span className="ml-auto flex items-center gap-2">{actions}</span>}
    </div>
  );
}

// ── 包裝盒內的厚白卡片 ────────────────────────────────────────────────────────
type PanelProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "style" | "children">;

export function Panel({ children, className, style, ...rest }: PanelProps) {
  return (
    <div
      className={cn("rounded-[18px] border-[3px] border-ink bg-white p-[18px]", className)}
      style={style}
      {...rest}
    >
      {children}
    </div>
  );
}
