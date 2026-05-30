// gacha/carton.tsx — 盲盒包裝盒外殼，框住每個畫面。
// 來源：design_handoff_gacha_redesign/prototype/ss-shell.jsx
//
// 結構：四角裁切標記 + 頂部標籤列（logo / 系列 / 登入）+ 步驟 ribbon
//       （投幣設定 → 轉動生成 → 開盒收圖）+ body（children）+ 條碼頁尾。

import type { ReactNode } from "react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { RegMark, Barcode } from "./primitives";

const STEP_LABELS = ["投幣設定", "轉動生成", "開盒收圖"] as const;

interface CartonProps {
  children: ReactNode;
  /** 目前步驟：0 投幣設定 / 1 轉動生成 / 2 開盒收圖；null 不顯示 ribbon。 */
  step?: number | null;
  /** 右上角登入區（注入真實 AuthPill）。 */
  authSlot?: ReactNode;
  series?: string;
  className?: string;
}

export function Carton({ children, step = null, authSlot, series = "SERIES 01", className }: CartonProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[28px] border-[3px] border-ink bg-cream text-ink",
        className,
      )}
      style={{ boxShadow: "14px 14px 0 rgba(0,0,0,.20)" }}
    >
      <RegMark className="left-[11px] top-[11px]" />
      <RegMark className="right-[11px] top-[11px] -scale-x-100" />
      <RegMark className="bottom-[11px] left-[11px] -scale-y-100" />
      <RegMark className="bottom-[11px] right-[11px] -scale-100" />

      {/* ── 頂部標籤列 ── */}
      <div className="flex items-center justify-between gap-3 border-b-[3px] border-ink bg-paper px-4 py-3 sm:px-[30px] sm:py-[15px]">
        <div className="flex items-center gap-[11px]">
          <div
            className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[13px] border-[2.5px] border-ink text-xl"
            style={{
              background: "conic-gradient(#FF7EB6,#FFC94D,#5FCFBE,#B59CFF,#FF7EB6)",
              transform: "rotate(-6deg)",
              boxShadow: "2px 2px 0 rgba(0,0,0,.18)",
            }}
            aria-hidden="true"
          >
            🥚
          </div>
          <div>
            <div className="font-display text-[21px] font-bold leading-none">貼圖工作室</div>
            <div className="mt-[3px] text-[10px] font-bold tracking-[0.22em] text-coral">
              STICKER GACHA STUDIO
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden font-display text-[12px] font-semibold leading-tight tracking-[0.2em] text-coral sm:block">
            {series}
          </div>
          {authSlot}
        </div>
      </div>

      {/* ── 步驟 ribbon ── */}
      {step != null && <StepRibbon step={step} />}

      {/* ── body ── */}
      <div className="relative">{children}</div>

      {/* ── 條碼頁尾 ── */}
      <div className="flex items-center justify-between gap-3 border-t-[3px] border-ink bg-paper px-4 py-3 sm:px-[30px]">
        <Barcode />
        <div className="font-display flex items-center gap-1 text-right text-[10px] font-medium leading-snug tracking-[0.12em] text-[#9a8f84] sm:text-[12px] sm:tracking-[0.16em]">
          <span className="hidden sm:inline">MADE WITH</span>
          <Heart className="hidden h-3 w-3 fill-coral text-coral sm:inline" aria-hidden="true" />
          <span>BY 阿凱老師 · FREE · 不留存你的照片</span>
        </div>
      </div>
    </div>
  );
}

// 步驟進度條：投幣 → 轉動 → 開盒。目前步驟珊瑚橘、已完成綠勾。
function StepRibbon({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center border-b-2 border-dashed border-[#e3d9c9] bg-white px-3 py-[11px] sm:px-[30px]">
      {STEP_LABELS.map((label, i) => {
        const on = i === step;
        const done = i < step;
        return (
          <div key={label} className="flex items-center">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 font-display text-[12px] font-bold",
                  on
                    ? "border-coral bg-coral text-white"
                    : done
                      ? "border-cap-green bg-cap-green text-white"
                      : "border-[#ddd] bg-white text-[#bbb]",
                )}
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-[12px] sm:text-[13.5px]",
                  on ? "font-extrabold text-ink" : "font-semibold text-[#b3a99e]",
                )}
              >
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div
                className={cn(
                  "mx-2 h-0.5 w-6 sm:mx-[14px] sm:w-[54px]",
                  done ? "bg-cap-green" : "bg-[#e3d9c9]",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
