import { useState, useRef, useImperativeHandle, forwardRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Upload, Image as ImageIcon, Wand2, ShieldCheck, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_TEXTS,
  fileToBase64,
  STICKER_STYLES,
  DEFAULT_STICKER_STYLE,
  type StickerStyleId,
} from "@/lib/sticker-utils";
import { customFetch, ApiError } from "@workspace/api-client-react";
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/turnstile-widget";
import { Capsule, CapsuleAvatar, StepBadge, Panel } from "@/components/gacha/primitives";
import { capColor, capSoft } from "@/components/gacha/tokens";

const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() || "";

const formSchema = z.object({
  theme: z.string().optional(),
  texts: z.array(z.string()).length(24, "必須剛好 24 個標籤"),
  style: z.enum([
    "pop-mart-3d",
    "clay",
    "pixel",
    "anime-2d",
    "watercolor",
  ]),
});

type FormValues = z.infer<typeof formSchema>;

interface StickerGeneratorProps {
  onSubmit: (
    photoBase64: string,
    theme: string | null,
    texts: string[],
    turnstileToken: string | null,
    style: StickerStyleId,
  ) => void;
  isPending: boolean;
  /** 已用 Google 帳號登入（2026-11-25 起生成必須登入） */
  signedIn: boolean;
  /** 還在確認登入狀態 */
  authLoading: boolean;
  /** 今天還可以生成幾次；null＝還沒查到 */
  quotaRemaining: number | null;
  quotaLimit: number;
  /** 叫出 Google 登入視窗 */
  onRequestSignIn: () => void;
}

export interface StickerGeneratorHandle {
  resetCaptcha: () => void;
}

export const StickerGenerator = forwardRef<StickerGeneratorHandle, StickerGeneratorProps>(
  function StickerGenerator(
    { onSubmit, isPending, signedIn, authLoading, quotaRemaining, quotaLimit, onRequestSignIn },
    ref,
  ) {
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  // True when <img> failed to load (corrupt blob, unsupported format) OR when
  // we proactively skipped rendering because we know the format won't work.
  // The most common trigger is iPhone HEIC photos — Chrome / Firefox / Edge
  // can't decode HEIC via <img>, only Safari can. The backend's magic-byte
  // sniffer accepts HEIC just fine, so the upload still works; we just
  // replace the broken <img> with a friendly file-info card.
  const [previewUnsupported, setPreviewUnsupported] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [isApplyingTheme, setIsApplyingTheme] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const { toast } = useToast();

  const captchaEnabled = TURNSTILE_SITE_KEY.length > 0;

  const resetCaptcha = () => {
    setTurnstileToken(null);
    setCaptchaError(null);
    turnstileRef.current?.reset();
  };

  useImperativeHandle(ref, () => ({ resetCaptcha }), []);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      theme: "",
      texts: [...DEFAULT_TEXTS],
      style: DEFAULT_STICKER_STYLE,
    },
  });

  const texts = form.watch("texts");
  const theme = form.watch("theme");
  const style = form.watch("style");

  // Detect formats that <img> can't render in non-Safari browsers. HEIC is
  // the big one (default iPhone format); HEIF/AVIF can also fall over on
  // older browsers. Check file.type AND filename extension because some
  // mobile pickers report empty type but keep the extension.
  const isUnpreviewableFormat = (file: File): boolean => {
    const t = file.type.toLowerCase();
    if (t.includes("heic") || t.includes("heif")) return true;
    const name = file.name.toLowerCase();
    return name.endsWith(".heic") || name.endsWith(".heif");
  };

  const acceptFile = (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "檔案過大",
        description: "請上傳小於 10MB 的圖片",
        variant: "destructive",
      });
      return;
    }
    setPhotoFile(file);
    const url = URL.createObjectURL(file);
    setPhotoPreview(url);
    // Skip the <img> render entirely for known-unpreviewable formats so we
    // don't briefly flash the browser's broken-image icon before the
    // onError handler fires.
    setPreviewUnsupported(isUnpreviewableFormat(file));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) acceptFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    // file.type can be empty for HEIC files dragged from Finder; relax the
    // image/* gate by also accepting .heic/.heif filenames.
    if (
      file &&
      (file.type.startsWith("image/") ||
        /\.(heic|heif)$/i.test(file.name))
    ) {
      acceptFile(file);
    }
  };

  const handleApplyTheme = async () => {
    if (!signedIn) {
      toast({
        title: "請先用 Google 帳號登入",
        description: "登入後才能使用 AI 依主題改寫。",
        variant: "destructive",
      });
      onRequestSignIn();
      return;
    }
    const trimmedTheme = (theme ?? "").trim();
    if (!trimmedTheme) {
      toast({
        title: "請先輸入主題",
        description: "在左側「設定主題」欄輸入關鍵字（例如「馬年祝賀」「太空人」），再按一次依主題改寫。",
        variant: "destructive",
      });
      return;
    }

    setIsApplyingTheme(true);
    try {
      const currentTexts = form.getValues("texts");
      const data = await customFetch<{ texts: string[] }>("/api/stickers/rewrite-texts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme: trimmedTheme,
          originalTexts: currentTexts,
        }),
      });

      if (!Array.isArray(data?.texts) || data.texts.length !== 24) {
        throw new Error("伺服器回傳的文字格式不對。");
      }

      form.setValue("texts", data.texts);
      toast({
        title: "已依主題改寫",
        description: `24 個貼圖文字都已換成「${trimmedTheme}」相關內容,可再手動微調。`,
      });
    } catch (error) {
      let description = "請稍後再試,或先點「恢復預設」重來。";
      if (error instanceof ApiError) {
        const data = error.data as { error?: string } | null;
        if (data?.error) {
          description = data.error;
        }
      } else if (error instanceof Error && error.message) {
        description = error.message;
      }
      toast({
        title: "主題改寫失敗",
        description,
        variant: "destructive",
      });
    } finally {
      setIsApplyingTheme(false);
    }
  };

  const handleResetTexts = () => {
    form.setValue("texts", [...DEFAULT_TEXTS]);
  };

  const handleSubmit = async (values: FormValues) => {
    // 沒登入直接擋在這裡，不送出任何請求
    if (!signedIn) {
      toast({
        title: "請先用 Google 帳號登入",
        description: `登入後每個帳號每天可以生成 ${quotaLimit} 次。`,
        variant: "destructive",
      });
      onRequestSignIn();
      return;
    }
    if (quotaRemaining === 0) {
      toast({
        title: `今天的 ${quotaLimit} 次用完囉`,
        description: "明天（台北時間午夜後）再來玩！",
        variant: "destructive",
      });
      return;
    }
    if (!photoFile) {
      toast({
        title: "請上傳照片",
        description: "需要一張大頭照來生成貼圖喔！",
        variant: "destructive",
      });
      return;
    }

    if (captchaEnabled && !turnstileToken) {
      setCaptchaError("請先完成下方的人機驗證再送出。");
      toast({
        title: "請先完成人機驗證",
        description: "勾選下方的「我不是機器人」後再試一次。",
        variant: "destructive",
      });
      return;
    }

    try {
      const base64 = await fileToBase64(photoFile);
      onSubmit(
        base64,
        values.theme || null,
        values.texts,
        captchaEnabled ? turnstileToken : null,
        values.style,
      );
    } catch (error) {
      toast({
        title: "圖片處理失敗",
        description: "請換一張圖片再試一次。",
        variant: "destructive",
      });
    }
  };

  // 上傳後且可預覽（非 HEIC）才把大頭照放進 hero 膠囊當 teaser；否則顯示盲盒「?」。
  const showAvatar = Boolean(photoPreview) && !previewUnsupported;
  const styleHint = STICKER_STYLES.find((s) => s.id === style)?.description ?? "";

  return (
    <div className="px-5 pb-7 pt-6 sm:px-[30px] sm:pb-[30px] sm:pt-[26px]">
      {/* ── hero：文案 + 塑膠開窗預覽 ── */}
      <div className="mb-[26px] flex flex-col gap-[26px] lg:flex-row lg:items-stretch">
        {/* 文案 */}
        <div className="flex flex-col justify-center lg:w-[400px] lg:shrink-0">
          <span className="font-display mb-4 inline-block self-start rounded-[7px] bg-ink px-[13px] py-[5px] text-[12px] font-semibold tracking-[0.16em] text-cream">
            BLIND BOX · GACHA · 24 SET
          </span>
          <h1 className="font-display text-[40px] font-bold leading-[0.96] tracking-[-0.01em] sm:text-[60px]">
            投一張自拍，
            <br />
            <span className="text-coral" style={{ WebkitTextStroke: "2px #221B1C" }}>
              轉出 24 顆
            </span>
            <br />
            公仔貼圖
          </h1>
          <p className="mt-[18px] max-w-[360px] text-[15px] font-medium leading-[1.65] text-[#5a4d4f] sm:text-[16px]">
            上傳大頭照 → 選風格、改文字 → 扭一下，AI 一次幫你捏出 24 張立體感十足的 Q 版貼圖。
          </p>
          <div className="mt-[22px] flex gap-[18px]">
            {([["24", "張一組"], ["~70s", "生成時間"], ["5", "種風格"]] as const).map(([n, l]) => (
              <div key={l}>
                <div className="font-display text-[26px] font-bold leading-none text-coral">{n}</div>
                <div className="mt-[3px] text-[12px] font-semibold text-[#9a8f84]">{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 塑膠開窗預覽（8 顆膠囊） */}
        <div
          className="relative flex-1 rounded-[20px] border-[3px] border-ink px-5 pb-[18px] pt-[26px]"
          style={{
            background: "radial-gradient(120% 120% at 50% 0%, #fff, #E1F1FF 130%)",
            boxShadow: "inset 0 0 0 6px #fff, inset 0 0 0 8px rgba(0,0,0,.07)",
          }}
        >
          <div className="font-display absolute -top-[13px] left-6 whitespace-nowrap rounded-[7px] border-[2.5px] border-ink bg-coral px-[13px] py-1 text-[12px] font-semibold tracking-[0.14em] text-white">
            產品預覽 · PREVIEW
          </div>
          <div className="grid grid-cols-4 justify-items-center gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Capsule key={i} index={i} className="w-full max-w-[108px]">
                {showAvatar ? <CapsuleAvatar src={photoPreview!} alt="" /> : undefined}
              </Capsule>
            ))}
          </div>
          <div className="font-display mt-[14px] flex justify-between whitespace-nowrap text-[11px] font-medium tracking-[0.08em] text-[#9a8f84]">
            <span>NO.01 — 08 / 24</span>
            <span>▮▮▯▯▯▯ 還有 16 款等你扭</span>
          </div>
        </div>
      </div>

      {/* ── 兩欄設定 ── */}
      <div className="grid grid-cols-1 gap-[22px] lg:grid-cols-[1fr_1.16fr]">
        {/* 左欄：上傳 / 主題 / 風格 */}
        <div className="flex flex-col gap-[18px]">
          {/* 1 上傳大頭照 */}
          <Panel>
            <StepBadge n={1} label="投入大頭照" className="mb-[14px]" />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              className="hidden"
              onChange={handleFileChange}
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              aria-label="點擊或拖曳上傳大頭照"
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              className={cn(
                "cursor-pointer rounded-[15px] border-[2.5px] border-dashed bg-cream text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2",
                isDragging ? "scale-[1.01] border-coral bg-coral/5" : "border-coral",
                photoPreview ? "p-2.5" : "px-3 py-[34px]",
              )}
            >
              {photoPreview ? (
                <div className="flex items-center gap-3.5">
                  {previewUnsupported ? (
                    <div className="grid h-[74px] w-[74px] shrink-0 place-items-center rounded-[13px] border-[2.5px] border-ink bg-amber-100 text-amber-700">
                      <ImageIcon className="h-7 w-7" />
                    </div>
                  ) : (
                    <img
                      src={photoPreview}
                      alt="預覽"
                      onError={() => setPreviewUnsupported(true)}
                      className="h-[74px] w-[74px] shrink-0 rounded-[13px] border-[2.5px] border-ink object-cover"
                    />
                  )}
                  <div className="text-left">
                    <div className="text-[16px] font-extrabold text-ink">照片已就緒 ✓</div>
                    <div className="mt-[3px] text-[12.5px] text-[#988]">
                      {previewUnsupported
                        ? `${photoFile?.name ?? "HEIC 檔"}・無法預覽但上傳沒問題`
                        : "點擊可更換其他照片"}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-[18px] border-[2.5px] border-ink bg-coral text-white"
                    style={{ boxShadow: "0 4px 0 rgba(0,0,0,.16)" }}
                  >
                    <Upload className="h-7 w-7" />
                  </div>
                  <div className="text-[17px] font-extrabold text-ink">點擊或拖曳上傳</div>
                  <div className="mt-1.5 text-[12.5px] text-[#988]">JPG / PNG / WEBP / HEIC（最高 10MB）</div>
                </>
              )}
            </div>
          </Panel>

          {/* 2 設定主題 */}
          <Panel>
            <StepBadge n={2} label="設定主題" hint="選填" className="mb-[14px]" />
            <input
              value={theme}
              onChange={(e) => form.setValue("theme", e.target.value)}
              placeholder="例如：馬年、太空人、社畜日常…"
              aria-label="貼圖主題"
              className="w-full rounded-[12px] border-[2.5px] border-ink bg-cream px-4 py-[13px] text-[15px] text-ink outline-none transition focus:ring-2 focus:ring-coral"
            />
          </Panel>

          {/* 3 選擇風格 */}
          <Panel>
            <StepBadge n={3} label="選擇風格" className="mb-[14px]" />
            <div className="grid grid-cols-5 gap-[9px]" role="radiogroup" aria-label="貼圖視覺風格">
              {STICKER_STYLES.map((opt) => {
                const active = style === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => form.setValue("style", opt.id)}
                    title={opt.description}
                    data-testid={`style-option-${opt.id}`}
                    className={cn(
                      "rounded-[13px] border-[2.5px] border-ink px-1 py-[11px] text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2",
                      active ? "bg-coral text-white" : "bg-white text-ink hover:-translate-y-px",
                    )}
                    style={active ? { boxShadow: "3px 3px 0 #221B1C", transform: "translate(-1px,-1px)" } : undefined}
                  >
                    <div className="text-[22px] leading-none" aria-hidden="true">
                      {opt.emoji}
                    </div>
                    <div className="mt-[5px] text-[11px] font-extrabold leading-tight">{opt.label}</div>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[#9a8f84]">{styleHint}</p>
          </Panel>
        </div>

        {/* 右欄：24 格文字 + 投幣生成 */}
        <Panel className="flex flex-col">
          <StepBadge
            n={4}
            label="自訂貼圖文字"
            className="mb-[14px]"
            actions={
              <>
                <button
                  type="button"
                  onClick={handleResetTexts}
                  disabled={isApplyingTheme}
                  className="rounded-full border-2 border-ink px-[13px] py-1.5 text-[12px] font-bold text-ink transition hover:bg-ink/5 disabled:opacity-50"
                >
                  恢復預設
                </button>
                <button
                  type="button"
                  onClick={handleApplyTheme}
                  disabled={!theme || isApplyingTheme}
                  data-testid="apply-theme-button"
                  className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-ink px-[13px] py-1.5 text-[12px] font-bold text-cream transition hover:bg-ink/90 disabled:opacity-50"
                >
                  {isApplyingTheme ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Wand2 className="h-3 w-3" />
                  )}
                  {isApplyingTheme ? "AI 改寫中…" : "✦ 依主題改寫"}
                </button>
              </>
            }
          />
          <div className="grid grid-cols-2 gap-[9px] sm:grid-cols-3 lg:grid-cols-4">
            {texts.map((text, i) => (
              <div key={i} className="relative">
                <span
                  className="font-display absolute -left-[7px] -top-[7px] z-[2] grid h-[19px] w-[19px] place-items-center rounded-[6px] border-2 border-ink text-[10px] font-semibold text-white"
                  style={{ background: capColor(i) }}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <input
                  value={text}
                  onChange={(e) => {
                    const newTexts = [...texts];
                    newTexts[i] = e.target.value;
                    form.setValue("texts", newTexts);
                  }}
                  aria-label={`貼圖文字 ${i + 1}`}
                  placeholder={`文字 ${i + 1}`}
                  className="h-[42px] w-full rounded-[11px] border-2 border-ink text-center text-[14.5px] font-bold text-ink outline-none transition focus:ring-2 focus:ring-coral"
                  style={{ background: i % 6 === 0 ? capSoft(i) : "#FFF6EC" }}
                />
              </div>
            ))}
          </div>

          <div className="mt-auto pt-[18px]">
            {captchaEnabled ? (
              <div className="mb-4 rounded-[12px] border-[2.5px] border-dashed border-ink bg-cream px-[14px] py-[11px]">
                <div className="mb-2 flex items-center gap-1.5 text-[13px] text-[#7c7173]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>請完成人機驗證，確認你是真人</span>
                </div>
                <TurnstileWidget
                  ref={turnstileRef}
                  siteKey={TURNSTILE_SITE_KEY}
                  onVerify={(token) => {
                    setTurnstileToken(token);
                    setCaptchaError(null);
                  }}
                  onError={() => {
                    setTurnstileToken(null);
                    setCaptchaError("人機驗證載入失敗，請稍後再試或重新整理頁面。");
                  }}
                  onExpire={() => {
                    setTurnstileToken(null);
                    setCaptchaError("人機驗證已過期，請重新驗證。");
                  }}
                />
                {captchaError && (
                  <p className="mt-2 text-[12px] font-medium text-destructive">{captchaError}</p>
                )}
              </div>
            ) : null}

            <button
              type="button"
              onClick={signedIn ? form.handleSubmit(handleSubmit) : onRequestSignIn}
              disabled={
                authLoading ||
                isPending ||
                (signedIn &&
                  (quotaRemaining === 0 || !photoFile || (captchaEnabled && !turnstileToken)))
              }
              data-testid="button-generate"
              className="font-display flex w-full items-center justify-center gap-3 rounded-[18px] border-[3px] border-ink py-[18px] text-[22px] font-bold text-white transition active:translate-y-[3px] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-coral/40 sm:text-[25px]"
              style={{
                background: "radial-gradient(140% 120% at 30% 25%, #ffffff55, transparent 45%), #FF5A4D",
                boxShadow: "0 8px 0 #221B1C",
              }}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin" />
                  魔法生成中…
                </>
              ) : !signedIn ? (
                <>
                  <span className="text-[26px]" aria-hidden="true">
                    🔐
                  </span>
                  先用 Google 登入再轉一下
                </>
              ) : quotaRemaining === 0 ? (
                <>
                  <span className="text-[26px]" aria-hidden="true">
                    🌙
                  </span>
                  今天的次數用完囉
                </>
              ) : (
                <>
                  <span className="text-[28px]" aria-hidden="true">
                    🥚
                  </span>
                  轉一下，生成 24 張貼圖
                </>
              )}
            </button>
            <p
              data-testid="quota-note"
              className={cn(
                "mt-2 text-center text-[13px] font-semibold",
                signedIn && quotaRemaining === 0 ? "text-destructive" : "text-[#7c7173]",
              )}
            >
              {!signedIn
                ? `需要 Google 登入，每個帳號每天可以生成 ${quotaLimit} 次`
                : quotaRemaining === null
                  ? `每個帳號每天可以生成 ${quotaLimit} 次`
                  : quotaRemaining === 0
                    ? `今天的 ${quotaLimit} 次已用完，明天（台北時間午夜後）再來`
                    : `今天還可以生成 ${quotaRemaining} / ${quotaLimit} 次（生成失敗不扣次數）`}
            </p>
            {signedIn && !photoFile && (
              <p className="mt-2 text-center text-[13px] font-medium text-destructive">
                請先上傳照片才能生成喔！
              </p>
            )}
            {signedIn && photoFile && captchaEnabled && !turnstileToken && (
              <p className="mt-2 text-center text-[13px] text-[#9a8f84]">完成人機驗證後即可生成。</p>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
});
