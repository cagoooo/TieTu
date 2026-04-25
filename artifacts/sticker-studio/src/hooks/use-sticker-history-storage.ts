import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  HISTORY_STORAGE_NOTICE_EVENT,
  type HistoryStorageNotice,
} from "@/lib/sticker-history";

/**
 * Subscribes to sticker-history storage notices and surfaces a friendly toast
 * to the user when the browser is running out of space.
 */
export function useStickerHistoryStorageNotices() {
  const { toast } = useToast();

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<HistoryStorageNotice>).detail;
      if (!detail) return;

      switch (detail.kind) {
        case "evicted": {
          const count = detail.evictedCount ?? 1;
          toast({
            title: "已自動整理歷史紀錄",
            description: `瀏覽器空間有點滿，已自動移除最舊的 ${count} 筆紀錄以保留這次的成品，建議盡快下載重要的貼圖。`,
          });
          break;
        }
        case "quota-exceeded": {
          toast({
            title: "瀏覽器空間不足，無法保留這次紀錄",
            description:
              "已嘗試清理舊紀錄但仍然存不下，請先下載這次的貼圖，或到「最近生成」清除幾筆舊紀錄再試一次。",
            variant: "destructive",
          });
          break;
        }
        case "save-failed": {
          toast({
            title: "歷史紀錄儲存失敗",
            description:
              "這次的成品沒能存進歷史紀錄，請先下載目前畫面上的貼圖以免遺失。",
            variant: "destructive",
          });
          break;
        }
      }
    };

    window.addEventListener(
      HISTORY_STORAGE_NOTICE_EVENT,
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        HISTORY_STORAGE_NOTICE_EVENT,
        handler as EventListener,
      );
  }, [toast]);
}
