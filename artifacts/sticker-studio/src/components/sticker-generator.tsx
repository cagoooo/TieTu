import { useState, useRef, useImperativeHandle, forwardRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Upload, Image as ImageIcon, Sparkles, Wand2, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_TEXTS, getThemeTexts, fileToBase64 } from "@/lib/sticker-utils";
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/turnstile-widget";

const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() || "";

const formSchema = z.object({
  theme: z.string().optional(),
  texts: z.array(z.string()).length(24, "必須剛好 24 個標籤"),
});

type FormValues = z.infer<typeof formSchema>;

interface StickerGeneratorProps {
  onSubmit: (
    photoBase64: string,
    theme: string | null,
    texts: string[],
    turnstileToken: string | null,
  ) => void;
  isPending: boolean;
}

export interface StickerGeneratorHandle {
  resetCaptcha: () => void;
}

export const StickerGenerator = forwardRef<StickerGeneratorHandle, StickerGeneratorProps>(
  function StickerGenerator({ onSubmit, isPending }, ref) {
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
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
    },
  });

  const texts = form.watch("texts");
  const theme = form.watch("theme");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
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
    }
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
    if (file && file.type.startsWith("image/")) {
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
    }
  };

  const handleApplyTheme = () => {
    form.setValue("texts", getThemeTexts(theme || ""));
    toast({
      title: "已套用主題",
      description: "文字已根據主題更新！",
    });
  };

  const handleResetTexts = () => {
    form.setValue("texts", [...DEFAULT_TEXTS]);
  };

  const handleSubmit = async (values: FormValues) => {
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
      );
    } catch (error) {
      toast({
        title: "圖片處理失敗",
        description: "請換一張圖片再試一次。",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto pb-12">
      <div className="text-center mb-10">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", bounce: 0.5 }}
          className="inline-flex items-center justify-center p-3 bg-primary/10 rounded-full mb-4"
        >
          <Sparkles className="w-8 h-8 text-primary" />
        </motion.div>
        <h1 className="text-4xl md:text-5xl font-extrabold text-foreground mb-4 tracking-tight">
          3D Q版貼圖生成器
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto">
          上傳一張自拍照，一鍵將你變成 24 張超可愛的 3D 立體感公仔貼圖！
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-5 space-y-6">
          <Card className="border-2 border-primary/20 shadow-xl overflow-hidden rounded-3xl">
            <CardContent className="p-6">
              <Label className="text-lg font-bold mb-4 block">1. 上傳大頭照</Label>
              <div
                className={`relative border-3 border-dashed rounded-2xl p-8 text-center transition-all duration-200 ease-in-out cursor-pointer ${
                  isDragging ? "border-primary bg-primary/5 scale-[1.02]" : "border-border hover:border-primary/50 hover:bg-muted/50"
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                />
                
                <AnimatePresence mode="wait">
                  {photoPreview ? (
                    <motion.div
                      key="preview"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="relative aspect-square w-full max-w-[240px] mx-auto rounded-xl overflow-hidden shadow-md"
                    >
                      <img src={photoPreview} alt="預覽" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                        <span className="text-white font-medium flex items-center gap-2">
                          <ImageIcon className="w-5 h-5" /> 點擊更換
                        </span>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="placeholder"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="py-12 flex flex-col items-center justify-center"
                    >
                      <div className="w-20 h-20 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-4">
                        <Upload className="w-10 h-10" />
                      </div>
                      <p className="text-lg font-bold mb-2">點擊或拖曳上傳</p>
                      <p className="text-sm text-muted-foreground">支援 JPG, PNG, WEBP (最高 10MB)</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="mt-8 space-y-4">
                <Label className="text-lg font-bold block">2. 設定主題 (選填)</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="例如：馬年、太空人、黏土風..."
                    value={theme}
                    onChange={(e) => form.setValue("theme", e.target.value)}
                    className="rounded-xl border-primary/20 focus-visible:ring-primary h-12 text-lg"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-7 space-y-6">
          <Card className="border-2 border-primary/20 shadow-xl rounded-3xl h-full flex flex-col">
            <CardContent className="p-6 flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <Label className="text-lg font-bold block m-0">3. 自訂貼圖文字 (24張)</Label>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleResetTexts} className="rounded-full text-xs h-8">
                    恢復預設
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleApplyTheme} disabled={!theme} className="rounded-full text-xs h-8 bg-primary/10 text-primary hover:bg-primary/20">
                    <Wand2 className="w-3 h-3 mr-1" />
                    依主題改寫
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-8">
                {texts.map((text, i) => (
                  <div key={i} className="relative group">
                    <div className="absolute -top-2 -left-2 w-5 h-5 bg-muted text-muted-foreground text-[10px] rounded-full flex items-center justify-center z-10 font-mono shadow-sm border border-border">
                      {i + 1}
                    </div>
                    <Input
                      value={text}
                      onChange={(e) => {
                        const newTexts = [...texts];
                        newTexts[i] = e.target.value;
                        form.setValue("texts", newTexts);
                      }}
                      className="h-10 text-center rounded-lg border-muted-foreground/20 focus-visible:ring-primary focus-visible:border-primary transition-all group-hover:border-primary/50"
                      placeholder={`文字 ${i + 1}`}
                    />
                  </div>
                ))}
              </div>

              <div className="mt-auto pt-4 border-t border-border space-y-3">
                {captchaEnabled && (
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>請完成下方人機驗證，確認你是真人</span>
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
                      <p className="text-xs text-destructive font-medium text-center">
                        {captchaError}
                      </p>
                    )}
                  </div>
                )}
                <Button 
                  onClick={form.handleSubmit(handleSubmit)} 
                  disabled={isPending || !photoFile || (captchaEnabled && !turnstileToken)}
                  className="w-full h-16 text-xl font-bold rounded-2xl shadow-lg hover:shadow-xl transition-all"
                  size="lg"
                >
                  {isPending ? (
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-6 h-6 animate-spin" />
                      魔法生成中...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-6 h-6" />
                      生成 24 張 Q 版貼圖
                    </span>
                  )}
                </Button>
                {!photoFile && (
                  <p className="text-center text-sm text-destructive mt-2 font-medium">
                    請先上傳照片才能生成喔！
                  </p>
                )}
                {photoFile && captchaEnabled && !turnstileToken && (
                  <p className="text-center text-sm text-muted-foreground mt-2">
                    完成人機驗證後即可生成。
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
});
