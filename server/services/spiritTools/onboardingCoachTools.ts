/**
 * server/services/spiritTools/onboardingCoachTools.ts
 *
 * Tools for onboarding-coach (導導) spirit.
 * Handles user onboarding, guided tours, and initial setup.
 */

import { logger } from "../../_core/logger";

/**
 * Start onboarding flow
 */
export function startOnboarding(input: {
  userId: number;
  userType: "beginner" | "intermediate" | "advanced";
}): {
  success: boolean;
  steps: Array<{
    id: string;
    title: string;
    description: string;
    action: string;
    estimatedTime: string;
  }>;
} {
  const beginnerSteps = [
    {
      id: "welcome",
      title: "歡迎來到創作平台",
      description: "讓我們快速了解平台的核心功能",
      action: "開始導覽",
      estimatedTime: "2 分鐘",
    },
    {
      id: "first-image",
      title: "生成你的第一張圖片",
      description: "體驗 AI 圖片生成的魔力",
      action: "前往創作工作室",
      estimatedTime: "5 分鐘",
    },
    {
      id: "explore-models",
      title: "探索不同的模型",
      description: "了解各種 AI 模型的特色",
      action: "前往模型頁面",
      estimatedTime: "3 分鐘",
    },
    {
      id: "save-assets",
      title: "管理你的創作",
      description: "學習如何儲存和整理作品",
      action: "前往資產庫",
      estimatedTime: "2 分鐘",
    },
  ];

  const intermediateSteps = [
    {
      id: "advanced-prompts",
      title: "掌握進階提示詞技巧",
      description: "學習更精準的提示詞撰寫",
      action: "查看教學",
      estimatedTime: "10 分鐘",
    },
    {
      id: "workflow",
      title: "建立自動化工作流程",
      description: "提升創作效率",
      action: "前往導演 AI",
      estimatedTime: "15 分鐘",
    },
  ];

  const steps = input.userType === "beginner" ? beginnerSteps :
                input.userType === "intermediate" ? intermediateSteps :
                [];

  logger.info("onboarding_started", {
    userId: input.userId,
    userType: input.userType,
    stepCount: steps.length,
  });

  return {
    success: true,
    steps,
  };
}

/**
 * Track onboarding progress
 */
export async function trackOnboardingProgress(input: {
  userId: number;
  stepId: string;
  completed: boolean;
}): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    // In production, this would update user onboarding state in database
    logger.info("onboarding_progress_updated", {
      userId: input.userId,
      stepId: input.stepId,
      completed: input.completed,
    });

    return {
      success: true,
      message: input.completed ? "步驟已完成！" : "進度已儲存",
    };
  } catch (error) {
    logger.error("onboarding_tracking_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: "進度儲存失敗",
    };
  }
}

/**
 * Get quick start guide
 */
export function getQuickStartGuide(): {
  success: boolean;
  guide: {
    title: string;
    sections: Array<{
      heading: string;
      content: string;
      tips?: string[];
    }>;
  };
} {
  return {
    success: true,
    guide: {
      title: "5 分鐘快速上手指南",
      sections: [
        {
          heading: "1. 選擇創作類型",
          content: "從左側選單選擇圖片、影片、音樂或語音工作室",
          tips: ["初次使用建議從圖片生成開始"],
        },
        {
          heading: "2. 輸入提示詞",
          content: "用文字描述你想創作的內容",
          tips: ["越具體越好", "可參考範例提示詞"],
        },
        {
          heading: "3. 選擇模型",
          content: "根據需求選擇合適的 AI 模型",
          tips: ["Flux 系列速度快品質高"],
        },
        {
          heading: "4. 調整參數",
          content: "設定尺寸、數量、風格等參數",
        },
        {
          heading: "5. 開始創作",
          content: "點擊生成按鈕，等待 AI 完成創作",
        },
      ],
    },
  };
}
