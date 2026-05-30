// gacha/loading-machine.tsx — 畫面 2：轉動生成（扭蛋機運轉中）。
// 來源：design_handoff_gacha_redesign/prototype/ss-loading.jsx
//
// 資料沿用 home.tsx 既有的 STAGES（含 lucide icon、秒數）、hints（6 條）、
// 進度演算法（asymptotic to 95%）。本元件只負責「視覺」，不自造資料。

import type { ComponentType } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
import { capColor } from "./tokens";

interface StageItem {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface GachaLoadingProps {
  stages: readonly StageItem[];
  activeIndex: number;
  progressPct: number;
  hint: string;
  hintKey: number;
  elapsedSec: number;
  /** 使用者上傳的大頭照（data URL）— 貼在機身當投幣，純裝飾。 */
  photo?: string | null;
}

// 玻璃罩內翻滾的膠囊（位置以 % 表示，隨罩體寬度縮放）。
const TUMBLERS = Array.from({ length: 9 }).map((_, i) => ({
  color: capColor(i),
  leftPct: ((14 + ((i * 31) % 270)) / 330) * 100,
  dur: 2.2 + (i % 4) * 0.5,
  delay: (i * 0.27) % 2,
  size: 52 + (i % 3) * 10,
}));

export function GachaLoading({
  stages,
  activeIndex,
  progressPct,
  hint,
  hintKey,
  elapsedSec,
  photo,
}: GachaLoadingProps) {
  return (
    <div className="grid grid-cols-1 items-center gap-8 px-5 py-8 sm:px-[30px] sm:py-9 md:grid-cols-[1fr_1.05fr] md:gap-[34px]">
      {/* ── 左：扭蛋機 ── */}
      <div className="flex justify-center" data-testid="gacha-machine">
        <div className="relative mx-auto w-[300px] max-w-full">
          {/* 玻璃半球罩 */}
          <div
            className="relative h-[280px] overflow-hidden border-[3px] border-ink"
            style={{
              borderRadius: "50% 50% 38% 38%",
              background: "radial-gradient(130% 100% at 50% 18%, #ffffff, #eaf4ff 72%, #d6e9fb)",
              boxShadow:
                "inset 0 -16px 30px rgba(120,150,180,.3), inset 14px 10px 26px rgba(255,255,255,.85)",
            }}
          >
            {/* 高光 */}
            <div
              className="absolute left-[42px] top-6 h-[120px] w-20 rounded-[50%] bg-white/55 blur-[7px]"
              style={{ transform: "rotate(20deg)" }}
            />
            {/* 翻滾膠囊 */}
            {TUMBLERS.map((c, i) => (
              <div
                key={i}
                className="absolute rounded-full border-2 border-black/[0.07]"
                style={{
                  left: `${c.leftPct}%`,
                  bottom: 10,
                  width: c.size,
                  height: c.size,
                  background: `linear-gradient(165deg,#fff 28%,${c.color})`,
                  boxShadow: "inset 0 -6px 10px rgba(255,255,255,.6)",
                  animation: `ssTumble ${c.dur}s ease-in-out ${c.delay}s infinite`,
                }}
              >
                <span className="absolute inset-x-0 top-[46%] h-[1.5px] bg-black/[0.08]" />
              </div>
            ))}
          </div>

          {/* 機身底座 */}
          <div
            className="relative -mt-1.5 flex h-[118px] items-center justify-center border-[3px] border-ink bg-coral"
            style={{ borderRadius: "0 0 22px 22px", boxShadow: "0 8px 0 #221B1C" }}
          >
            {/* 中央旋轉把手 */}
            <div className="absolute left-1/2 top-[18px] -translate-x-1/2">
              <div
                className="grid h-[66px] w-[66px] place-items-center rounded-full border-[3px] border-ink bg-white"
                style={{
                  animation: "ssSpin 1.6s linear infinite",
                  boxShadow: "inset 0 -4px 8px rgba(0,0,0,.12)",
                }}
              >
                <span className="h-[30px] w-2 rounded bg-ink" />
                <span className="absolute h-2 w-[30px] rounded bg-ink" />
              </div>
            </div>
            {/* 出口槽 */}
            <div className="absolute bottom-[14px] h-[30px] w-24 rounded-b-[10px] bg-ink/85" />
            {/* 使用者大頭照當投幣 */}
            {photo && (
              <img
                src={photo}
                alt=""
                className="absolute right-[18px] top-5 h-[46px] w-[46px] rounded-full border-[3px] border-white object-cover"
                style={{ boxShadow: "0 3px 0 rgba(0,0,0,.25)" }}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── 右：狀態 ── */}
      <div className="min-w-0">
        <div className="font-display mb-[14px] inline-block whitespace-nowrap rounded-full border-[2.5px] border-ink bg-cream px-[15px] py-[5px] text-[12.5px] font-semibold tracking-[0.1em]">
          🥚 GACHA IN PROGRESS
        </div>
        <h2 className="font-display mb-1 text-[34px] font-bold leading-[1.05] sm:text-[40px]" data-testid="loading-stage-label">
          魔法生成中<span className="text-coral">…</span>
        </h2>
        <p className="mb-[22px] text-[15px] font-medium text-[#7c7173]">
          機器正在努力扭出你的專屬貼圖，平均約 30–90 秒。
          <span className="ml-1 tabular-nums text-ink/40">已過 {Math.floor(elapsedSec)} 秒</span>
        </p>

        {/* 4 階段清單 */}
        <div className="mb-[22px] flex flex-col gap-[9px]">
          {stages.map((s, i) => {
            const done = i < activeIndex;
            const on = i === activeIndex;
            const Icon = s.icon;
            return (
              <div
                key={s.id}
                className={[
                  "flex items-center gap-3 rounded-[13px] border-[2.5px] px-[14px] py-[10px] transition-all",
                  on ? "border-ink bg-white" : done ? "border-[#e7ddcf] bg-cream" : "border-[#e7ddcf] bg-white opacity-50",
                ].join(" ")}
              >
                <span
                  className={[
                    "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] text-white",
                    done ? "bg-cap-green" : on ? "bg-coral" : "bg-[#eee]",
                  ].join(" ")}
                >
                  {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </span>
                <span className={["text-[15.5px]", on ? "font-extrabold text-ink" : "font-semibold text-[#8a8076]"].join(" ")}>
                  {s.label}
                </span>
                {on && (
                  <span className="ml-auto flex gap-1">
                    {[0, 1, 2].map((d) => (
                      <span
                        key={d}
                        className="h-1.5 w-1.5 rounded-full bg-coral"
                        style={{ animation: `ssBlink 1s ${d * 0.2}s infinite` }}
                      />
                    ))}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* 進度條 */}
        <div className="mb-2 flex items-center justify-between">
          <span className="font-display text-[13px] font-semibold tracking-[0.1em] text-[#9a8f84]">PROGRESS</span>
          <span className="font-display text-[20px] font-bold text-coral tabular-nums" data-testid="loading-progress-value">
            {Math.round(progressPct)}%
          </span>
        </div>
        <div
          className="h-5 overflow-hidden rounded-full border-[2.5px] border-ink bg-white p-0.5"
          role="progressbar"
          aria-valuenow={Math.round(progressPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="生成進度"
        >
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{
              width: `${progressPct}%`,
              background: "repeating-linear-gradient(45deg, #FF5A4D 0 12px, #FF7EB6 12px 24px)",
              backgroundSize: "34px 34px",
              animation: "ssStripe 1s linear infinite",
            }}
            data-testid="loading-progress-bar"
          />
        </div>

        {/* 輪播提示 */}
        <div className="mt-[18px] flex min-h-6 items-center gap-2.5 text-[14.5px] font-semibold text-[#6b6058]">
          <span className="text-lg">💡</span>
          <AnimatePresence mode="wait">
            <motion.span
              key={hintKey}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
            >
              {hint}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
