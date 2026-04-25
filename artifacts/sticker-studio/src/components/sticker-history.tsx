import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { History, Trash2, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  clearHistory,
  deleteHistoryEntry,
  HISTORY_EVENT,
  listHistory,
  type HistoryEntry,
} from "@/lib/sticker-history";

interface StickerHistoryProps {
  onOpen: (entry: HistoryEntry) => void;
  emptyHint?: string;
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function StickerHistory({ onOpen, emptyHint }: StickerHistoryProps) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);

  const refresh = useCallback(async () => {
    const items = await listHistory();
    setEntries(items);
  }, []);

  useEffect(() => {
    refresh();
    const handler = () => {
      refresh();
    };
    window.addEventListener(HISTORY_EVENT, handler);
    return () => window.removeEventListener(HISTORY_EVENT, handler);
  }, [refresh]);

  if (entries === null) return null;
  if (entries.length === 0) {
    if (!emptyHint) return null;
    return (
      <Card className="border-2 border-dashed border-primary/15 rounded-3xl">
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          <History className="w-5 h-5 mx-auto mb-2 opacity-60" />
          {emptyHint}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="border-2 border-primary/15 shadow-md rounded-3xl"
      data-testid="history-panel"
    >
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold leading-tight">最近生成</h3>
              <p className="text-xs text-muted-foreground">
                最近 {entries.length} 次的成品都幫你保留了，可以隨時回頭預覽或重新下載。
              </p>
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full text-muted-foreground hover:text-destructive"
                data-testid="button-clear-history"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                清除全部
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>確定清除歷史紀錄嗎？</AlertDialogTitle>
                <AlertDialogDescription>
                  清除後將無法復原這些貼圖紀錄，請確定已經下載要保留的成品。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => clearHistory()}
                  data-testid="button-confirm-clear-history"
                >
                  確定清除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          <AnimatePresence>
            {entries.map((entry) => (
              <motion.div
                key={entry.id}
                layout
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 280, damping: 24 }}
                className="group relative"
                data-testid={`history-entry-${entry.id}`}
              >
                <button
                  type="button"
                  onClick={() => onOpen(entry)}
                  className="w-full aspect-square rounded-2xl overflow-hidden border-2 border-border bg-muted/40 hover:border-primary/60 transition-colors shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={`重新開啟 ${formatTimestamp(entry.createdAt)} 的貼圖`}
                  data-testid={`button-history-open-${entry.id}`}
                >
                  <img
                    src={entry.thumbnailDataUrl}
                    alt={entry.theme || "貼圖縮圖"}
                    className="w-full h-full object-cover"
                  />
                </button>
                <div className="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-gradient-to-t from-black/70 via-black/40 to-transparent rounded-b-2xl pointer-events-none">
                  <p className="text-[11px] font-medium text-white truncate">
                    {entry.theme?.trim() ? entry.theme : "未命名主題"}
                  </p>
                  <p className="text-[10px] text-white/80 tabular-nums">
                    {formatTimestamp(entry.createdAt)}
                  </p>
                </div>
                <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(entry);
                    }}
                    className="w-7 h-7 rounded-full bg-white/90 text-foreground flex items-center justify-center shadow hover:bg-white"
                    aria-label="預覽此貼圖"
                    data-testid={`button-history-preview-${entry.id}`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteHistoryEntry(entry.id);
                    }}
                    className="w-7 h-7 rounded-full bg-white/90 text-destructive flex items-center justify-center shadow hover:bg-white"
                    aria-label="刪除此紀錄"
                    data-testid={`button-history-delete-${entry.id}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </CardContent>
    </Card>
  );
}
