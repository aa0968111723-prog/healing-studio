/**
 * server/services/spiritTools/learningSpecialistTools.ts
 *
 * Tools for learning-specialist (學學) spirit.
 * Handles tutorials, guides, and user onboarding.
 */

import { logger } from "../../_core/logger";

/**
 * Get tutorial for a specific feature
 */
export function getTutorial(featureName: string): {
  success: boolean;
  tutorial?: {
    title: string;
    steps: Array<{
      step: number;
      title: string;
      description: string;
      tips?: string[];
    }>;
    videoUrl?: string;
    estimatedTime: string;
  };
  message: string;
} {
  const tutorials: Record<string, any> = {
    "image-generation": {
      title: "圖片生成入門教學",
      steps: [
        {
          step: 1,
          title: "進入創作工作室",
          description: "從左側選單點擊「創作工作室」",
          tips: ["可使用快捷鍵 Cmd/Ctrl + K"],
        },
        {
          step: 2,
          title: "輸入提示詞",
          description: "在提示詞欄位描述你想生成的圖片",
          tips: ["越具體越好", "可參考範例提示詞"],
        },
        {
          step: 3,
          title: "選擇模型",
          description: "根據需求選擇合適的生成模型",
          tips: ["Flux 系列速度快", "SD3 可調性高"],
        },
        {
          step: 4,
          title: "調整參數",
          description: "設定長寬比、數量等參數",
        },
        {
          step: 5,
          title: "開始生成",
          description: "點擊生成按鈕，等待結果",
        },
      ],
      estimatedTime: "5 分鐘",
    },
    "video-generation": {
      title: "影片生成入門教學",
      steps: [
        {
          step: 1,
          title: "進入影片工作室",
          description: "從選單選擇「影片工作室」",
        },
        {
          step: 2,
          title: "選擇生成方式",
          description: "文生影或圖轉影",
          tips: ["初次使用建議從圖轉影開始"],
        },
        {
          step: 3,
          title: "輸入提示詞或上傳圖片",
          description: "描述影片內容或上傳起始圖片",
        },
        {
          step: 4,
          title: "設定影片參數",
          description: "長度、比例、運鏡方式",
        },
        {
          step: 5,
          title: "生成並下載",
          description: "等待生成完成後下載",
        },
      ],
      estimatedTime: "2-5 分鐘生成時間",
    },
  };

  const tutorial = tutorials[featureName];

  if (!tutorial) {
    return {
      success: false,
      message: `找不到「${featureName}」的教學`,
    };
  }

  return {
    success: true,
    tutorial,
    message: "教學已載入",
  };
}

/**
 * Get list of available tutorials
 */
export function listTutorials(): {
  success: boolean;
  tutorials: Array<{
    id: string;
    title: string;
    category: string;
    difficulty: "beginner" | "intermediate" | "advanced";
    duration: string;
  }>;
} {
  return {
    success: true,
    tutorials: [
      {
        id: "image-generation",
        title: "圖片生成入門",
        category: "創作",
        difficulty: "beginner",
        duration: "5 分鐘",
      },
      {
        id: "video-generation",
        title: "影片生成基礎",
        category: "創作",
        difficulty: "beginner",
        duration: "10 分鐘",
      },
      {
        id: "prompt-engineering",
        title: "提示詞工程",
        category: "進階",
        difficulty: "intermediate",
        duration: "15 分鐘",
      },
      {
        id: "lora-training",
        title: "LoRA 模型訓練",
        category: "進階",
        difficulty: "advanced",
        duration: "30 分鐘",
      },
      {
        id: "workflow-automation",
        title: "工作流程自動化",
        category: "進階",
        difficulty: "intermediate",
        duration: "20 分鐘",
      },
    ],
  };
}

/**
 * Get quick tips for beginners
 */
export function getQuickTips(): {
  success: boolean;
  tips: Array<{
    category: string;
    tip: string;
  }>;
} {
  return {
    success: true,
    tips: [
      {
        category: "圖片生成",
        tip: "使用具體的描述詞，加入風格和情緒關鍵字",
      },
      {
        category: "影片生成",
        tip: "圖轉影效果通常比純文生影更穩定",
      },
      {
        category: "提示詞",
        tip: "學習使用 negative prompt 排除不想要的元素",
      },
      {
        category: "模型選擇",
        tip: "不同模型擅長不同風格，多嘗試找到最適合的",
      },
      {
        category: "成本控制",
        tip: "先用低解析度測試，滿意後再生成高清版本",
      },
      {
        category: "資產管理",
        tip: "為生成的作品加上標籤，方便日後搜尋",
      },
    ],
  };
}
