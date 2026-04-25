import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Download, FileArchive, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  splitImageWithGuides,
  downloadZip,
  downloadSheet,
  getDefaultGuides,
  loadImage,
  type Guides,
} from "@/lib/sticker-utils";
import { StickerCropper } from "./sticker-cropper";

interface StickerResultProps {
  sheetBase64: string;
  texts: string[];
  onBack: () => void;
}

export function StickerResult({ sheetBase64, texts, onBack }: StickerResultProps) {
  const [guides, setGuides] = useState<Guides>(() => getDefaultGuides());
  const [tiles, setTiles] = useState<string[]>([]);
  const [isSplitting, setIsSplitting] = useState(true);
  const [isZipping, setIsZipping] = useState(false);
  const cachedImageRef = useRef<HTMLImageElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const splitVersionRef = useRef(0);

  useEffect(() => {
    setGuides(getDefaultGuides());
    cachedImageRef.current = null;
    let cancelled = false;
    loadImage(sheetBase64)
      .then((img) => {
        if (!cancelled) cachedImageRef.current = img;
      })
      .catch((err) => console.error("Failed to load sheet image", err));
    return () => {
      cancelled = true;
    };
  }, [sheetBase64]);

  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    setIsSplitting(true);
    const myVersion = ++splitVersionRef.current;
    debounceRef.current = window.setTimeout(async () => {
      try {
        const result = await splitImageWithGuides(
          sheetBase64,
          guides,
          cachedImageRef.current ?? undefined,
        );
        if (splitVersionRef.current === myVersion) {
          setTiles(result);
        }
      } catch (error) {
        console.error("Failed to split image", error);
      } finally {
        if (splitVersionRef.current === myVersion) {
          setIsSplitting(false);
        }
      }
    }, 150);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [sheetBase64, guides]);

  const handleDownloadZip = async () => {
    setIsZipping(true);
    try {
      const fresh = await splitImageWithGuides(
        sheetBase64,
        guides,
        cachedImageRef.current ?? undefined,
      );
      await downloadZip(fresh, texts);
    } catch (error) {
      console.error("Zip failed", error);
    } finally {
      setIsZipping(false);
    }
  };

  const handleDownloadSheet = () => {
    downloadSheet(sheetBase64);
  };

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.02 },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 10, scale: 0.95 },
    show: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { type: "spring" as const, stiffness: 300, damping: 24 },
    },
  };

  return (
    <div className="w-full max-w-6xl mx-auto pb-20">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-4">
        <Button variant="ghost" onClick={onBack} className="rounded-full" data-testid="button-back">
          <ArrowLeft className="w-4 h-4 mr-2" />
          再做一組
        </Button>
        <div className="flex gap-3 flex-wrap justify-center">
          <Button
            variant="outline"
            onClick={handleDownloadSheet}
            className="rounded-full border-primary/20 hover:bg-primary/10 font-bold shadow-sm"
            data-testid="button-download-sheet"
          >
            <Download className="w-4 h-4 mr-2" />
            下載整張貼圖
          </Button>
          <Button
            onClick={handleDownloadZip}
            disabled={isZipping || tiles.length === 0}
            className="rounded-full font-bold shadow-md"
            data-testid="button-download-zip"
          >
            {isZipping ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileArchive className="w-4 h-4 mr-2" />
            )}
            下載 24 張單張 (ZIP)
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-7">
          <Card className="border-2 border-primary/15 shadow-xl rounded-3xl">
            <CardContent className="p-5 sm:p-6 space-y-4">
              <div>
                <h3 className="text-lg font-bold mb-1">調整切割線</h3>
                <p className="text-xs text-muted-foreground">
                  生成結果若有歪斜或邊距不均，可拖曳格線校正後再下載。
                </p>
              </div>
              <StickerCropper
                sheetBase64={sheetBase64}
                guides={guides}
                onGuidesChange={setGuides}
              />
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-5">
          <Card className="border-2 border-primary/20 shadow-xl rounded-3xl lg:sticky lg:top-8">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">切割預覽（24 張）</h3>
                {isSplitting && (
                  <span className="flex items-center text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    更新中
                  </span>
                )}
              </div>
              <div className="rounded-2xl bg-[#7F7F7F] p-3">
                <motion.div
                  variants={container}
                  initial="hidden"
                  animate="show"
                  className="grid grid-cols-4 gap-2"
                  data-testid="tile-preview-grid"
                >
                  {tiles.map((tile, i) => (
                    <motion.div
                      key={i}
                      variants={item}
                      className="relative aspect-square rounded-lg overflow-hidden shadow bg-white/10"
                    >
                      <img
                        src={tile}
                        alt={texts[i] || `Sticker ${i + 1}`}
                        className="w-full h-full object-contain"
                        data-testid={`tile-${i}`}
                      />
                    </motion.div>
                  ))}
                  {tiles.length === 0 && (
                    <div className="col-span-4 h-32 flex items-center justify-center text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      正在裁切貼圖...
                    </div>
                  )}
                </motion.div>
              </div>
              <p className="text-xs text-muted-foreground mt-4 text-center leading-relaxed">
                這份預覽會即時依照你調整的切割線更新；
                <br />
                確認滿意後再下載 ZIP。
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
