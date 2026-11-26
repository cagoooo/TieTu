import { useRef } from "react";
import { Download, ExternalLink, ImageUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/** 技能檔放在 public/skills/，跟著 Vite base（GitHub Pages 是 /TieTu/）走 */
const SKILL_URL = `${import.meta.env.BASE_URL}skills/line-sticker-24-grid/SKILL.md`;
const MAX_SHEET_BYTES = 20 * 1024 * 1024;

interface GeminiSkillCardProps {
  /** 使用者上傳 Gemini 畫好的貼圖表（data URL），交給結果頁切圖 */
  onSheetUploaded: (dataUrl: string) => void;
}

/**
 * 「用自己的 Gemini 免費畫貼圖」：下載 SKILL.md 裝到 Gemini → 在 Gemini 畫好
 * 24 格貼圖表 → 上傳回來，由前端去背、切 24 張、匯出 LINE 格式（不用 AI）。
 */
export function GeminiSkillCard({ onSheetUploaded }: GeminiSkillCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "請選擇圖片檔", description: "支援 PNG、JPG、WEBP。", variant: "destructive" });
      return;
    }
    if (file.size > MAX_SHEET_BYTES) {
      toast({ title: "圖片太大了", description: "請用 20MB 以內的圖片。", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onSheetUploaded(String(reader.result));
    reader.onerror = () =>
      toast({ title: "讀取圖片失敗", description: "請換一張圖片再試一次。", variant: "destructive" });
    reader.readAsDataURL(file);
  };

  return (
    <section
      data-testid="gemini-skill-card"
      className="mb-5 rounded-[18px] border-[3px] border-ink bg-white px-4 py-4 text-ink sm:px-6 sm:py-5"
      style={{ boxShadow: "0 5px 0 #221B1C" }}
    >
      <h2 className="font-display text-[19px] font-bold sm:text-[22px]">🆓 用自己的 Gemini 免費畫貼圖</h2>
      <p className="mt-1 text-[13px] font-medium text-[#7c7173] sm:text-[14px]">
        把貼圖機的「魔法咒語」裝進你自己的 Gemini，畫好再拿回來自動切成 24 張 LINE 貼圖。
      </p>

      <ol className="mt-4 grid gap-3 text-[14px] leading-relaxed md:grid-cols-2 xl:grid-cols-4">
        <li className="rounded-[14px] bg-[#FFF4D6] px-3 py-3">
          <b>① 下載技能檔</b>
          <div className="mt-2 flex flex-wrap gap-2">
            <a
              href={SKILL_URL}
              download="SKILL.md"
              data-testid="download-skill"
              className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-ink px-3 py-1.5 text-[13px] font-bold text-cream hover:bg-ink/90"
            >
              <Download className="h-4 w-4" /> 下載 SKILL.md
            </a>
            <a
              href={SKILL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full border-2 border-ink px-3 py-1.5 text-[13px] font-bold hover:bg-ink/5"
            >
              <ExternalLink className="h-4 w-4" /> 看內容
            </a>
          </div>
        </li>
        <li className="rounded-[14px] bg-[#FFF4D6] px-3 py-3">
          <b>② 裝進 Gemini</b>
          <br />
          用電腦打開{" "}
          <a
            href="https://gemini.google.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-coral underline underline-offset-2"
          >
            gemini.google.com
          </a>
          ，到「技能（Skills）」上傳剛下載的 SKILL.md。
          <span className="mt-1 block text-[12px] text-[#9a8f84]">建議用個人 Gmail 帳號登入；手機 App 目前不能上傳技能。</span>
        </li>
        <li className="rounded-[14px] bg-[#FFF4D6] px-3 py-3">
          <b>③ 叫 Gemini 畫</b>
          <br />
          跟 Gemini 說「幫我做 LINE 貼圖」，上傳一張臉部清楚的照片，選畫風與主題。畫好後下載整張圖。
        </li>
        <li className="rounded-[14px] bg-[#FFF4D6] px-3 py-3">
          <b>④ 拿回來切圖</b>
          <br />
          按下面的按鈕上傳，自動去背、切成 24 張、打包 LINE 格式。
        </li>
      </ol>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        data-testid="upload-sheet-input"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        data-testid="upload-sheet-button"
        className="font-display mt-4 flex w-full items-center justify-center gap-2 rounded-[16px] border-[3px] border-ink bg-[#7BC8A4] py-3 text-[18px] font-bold text-ink transition active:translate-y-[2px] sm:text-[20px]"
        style={{ boxShadow: "0 5px 0 #221B1C" }}
      >
        <ImageUp className="h-6 w-6" /> 上傳 Gemini 畫好的貼圖表
      </button>
      <p className="mt-2 text-center text-[12px] text-[#9a8f84]">
        這一步在你的瀏覽器裡完成，不用登入、不扣次數、不用 AI。
      </p>
    </section>
  );
}
