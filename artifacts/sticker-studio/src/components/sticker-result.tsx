import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Download, FileArchive, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { splitImage, downloadZip, downloadSheet } from "@/lib/sticker-utils";

interface StickerResultProps {
  sheetBase64: string;
  texts: string[];
  onBack: () => void;
}

export function StickerResult({ sheetBase64, texts, onBack }: StickerResultProps) {
  const [tiles, setTiles] = useState<string[]>([]);
  const [isSplitting, setIsSplitting] = useState(true);
  const [isZipping, setIsZipping] = useState(false);

  useEffect(() => {
    let mounted = true;
    
    async function process() {
      try {
        setIsSplitting(true);
        const result = await splitImage(sheetBase64);
        if (mounted) {
          setTiles(result);
          setIsSplitting(false);
        }
      } catch (error) {
        console.error("Failed to split image", error);
        if (mounted) setIsSplitting(false);
      }
    }

    process();

    return () => {
      mounted = false;
    };
  }, [sheetBase64]);

  const handleDownloadZip = async () => {
    setIsZipping(true);
    try {
      await downloadZip(tiles, texts);
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
      transition: { staggerChildren: 0.05 }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 20, scale: 0.9 },
    show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
  };

  return (
    <div className="w-full max-w-6xl mx-auto pb-20">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-4">
        <Button variant="ghost" onClick={onBack} className="rounded-full">
          <ArrowLeft className="w-4 h-4 mr-2" />
          再做一組
        </Button>
        <div className="flex gap-3">
          <Button 
            variant="outline" 
            onClick={handleDownloadSheet}
            className="rounded-full border-primary/20 hover:bg-primary/10 font-bold shadow-sm"
          >
            <Download className="w-4 h-4 mr-2" />
            下載整張貼圖
          </Button>
          <Button 
            onClick={handleDownloadZip} 
            disabled={isSplitting || isZipping}
            className="rounded-full font-bold shadow-md"
          >
            {isZipping ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileArchive className="w-4 h-4 mr-2" />}
            下載 24 張單張 (ZIP)
          </Button>
        </div>
      </div>

      {isSplitting ? (
        <div className="h-64 flex flex-col items-center justify-center space-y-4">
          <Loader2 className="w-12 h-12 text-primary animate-spin" />
          <p className="text-lg font-medium text-muted-foreground">正在為您裁切貼圖...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8">
            <Card className="border-4 border-primary/10 shadow-2xl overflow-hidden rounded-[2rem] bg-[#7F7F7F]">
              <CardContent className="p-8 sm:p-12">
                <motion.div 
                  variants={container}
                  initial="hidden"
                  animate="show"
                  className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6"
                >
                  {tiles.map((tile, i) => (
                    <motion.div 
                      key={i} 
                      variants={item}
                      whileHover={{ scale: 1.05, rotate: [-1, 1, -1, 0], transition: { duration: 0.3 } }}
                      className="relative aspect-square rounded-2xl overflow-hidden shadow-lg cursor-pointer bg-white/10 backdrop-blur-sm"
                    >
                      <img src={tile} alt={texts[i] || `Sticker ${i}`} className="w-full h-full object-contain" />
                    </motion.div>
                  ))}
                </motion.div>
              </CardContent>
            </Card>
          </div>
          
          <div className="lg:col-span-4">
            <Card className="border-2 border-primary/20 shadow-xl rounded-3xl sticky top-8">
              <CardContent className="p-6">
                <h3 className="text-xl font-bold mb-4">整張預覽</h3>
                <div className="rounded-2xl overflow-hidden border-2 border-border shadow-inner bg-[#7F7F7F] p-4">
                  <img 
                    src={`data:image/png;base64,${sheetBase64}`} 
                    alt="Full Sheet" 
                    className="w-full h-auto rounded-xl object-contain shadow-md"
                  />
                </div>
                <p className="text-sm text-muted-foreground mt-6 text-center">
                  這是一張 4x6 網格的 PNG 圖片。<br/>
                  背景為 50% 灰色，帶有粗白邊效果！
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
