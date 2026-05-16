/**
 * emptyPromptHelper.ts — 「選了模型但沒寫提示詞」的友善提醒
 * ──────────────────────────────────────────────────────────────────────
 * 各創作室（圖像／影片／音樂配音）按下「生成」時，若 prompt 是空的，
 * 原本只 toast.error("請輸入提示詞")。對新手而言這只是擋路，並沒有告
 * 訴他下一步可以做什麼。
 *
 * 這個 hook 包出一個 `notifyEmpty()` callback：
 *   - 顯示 sonner toast（題目同舊版，多一條描述帶出模型名稱）
 *   - 附「讓代理幫我寫」action button → 開啟全站光球聊天並預填一段
 *     幫忙寫提示詞的訴求，使用者按一下就能進入引導對話。
 *
 * 設計成 hook 而非單純 helper，因為它需要存取 useGlobalOrbChat 上下文。
 */

import { useCallback } from "react";
import { toast } from "sonner";
import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";

export interface EmptyPromptContext {
  /** 目前選用的模型顯示名稱，會帶進 toast 描述與光球請求文字。 */
  modelLabel?: string;
  /** 目前任務模態（圖片 / 影片 / 音樂 / 配音…），給光球請求文字用。 */
  modality?: string;
  /** 額外缺少欄位的提示（例如 "請輸入提示詞和參考圖片"）。 */
  missing?: string;
}

export function useEmptyPromptHelper() {
  const globalChat = useGlobalOrbChat();

  return useCallback(
    (ctx: EmptyPromptContext = {}) => {
      const { modelLabel, modality, missing } = ctx;
      const title = missing ?? "請輸入提示詞";
      const desc = modelLabel
        ? `已選擇「${modelLabel}」模型，再補一段描述就能生成。`
        : "再補一段描述就能開始生成。";
      const helpPrompt = `我想用${modelLabel ? `「${modelLabel}」` : ""}${
        modality ? `做${modality}` : "生成內容"
      }，但不知道怎麼寫提示詞，請幫我寫一段，並反問我關鍵細節。`;

      toast.error(title, {
        description: desc,
        action: {
          label: "讓代理幫我寫",
          onClick: () => {
            globalChat.setInput(helpPrompt);
            globalChat.open();
          },
        },
        duration: 6000,
      });
    },
    [globalChat]
  );
}
