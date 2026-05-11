/**
 * server/services/spiritTools/anatomySpecialistTools.ts
 *
 * Tools for anatomy-specialist (解解) spirit.
 * Handles technical analysis, debugging, and system diagnostics.
 */

import { logger } from "../../_core/logger";

/**
 * Analyze generation parameters
 */
export function analyzeParameters(input: {
  modality: "image" | "video" | "audio" | "voice";
  parameters: Record<string, unknown>;
}): {
  success: boolean;
  analysis: {
    valid: boolean;
    issues?: string[];
    suggestions?: string[];
    optimizations?: Array<{
      parameter: string;
      currentValue: unknown;
      suggestedValue: unknown;
      reason: string;
    }>;
  };
} {
  const issues: string[] = [];
  const suggestions: string[] = [];
  const optimizations: any[] = [];

  // Example validation logic
  if (input.modality === "image") {
    const params = input.parameters;

    if (params.num_images && typeof params.num_images === "number" && params.num_images > 4) {
      suggestions.push("大量圖片生成建議分批進行，避免超時");
    }

    if (params.guidance_scale && typeof params.guidance_scale === "number" && params.guidance_scale > 15) {
      optimizations.push({
        parameter: "guidance_scale",
        currentValue: params.guidance_scale,
        suggestedValue: 7.5,
        reason: "過高的 guidance_scale 可能導致過度飽和",
      });
    }
  }

  logger.info("parameters_analyzed", {
    modality: input.modality,
    issueCount: issues.length,
    suggestionCount: suggestions.length,
  });

  return {
    success: true,
    analysis: {
      valid: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      optimizations: optimizations.length > 0 ? optimizations : undefined,
    },
  };
}

/**
 * Debug failed generation
 */
export async function debugFailure(input: {
  userId: number;
  jobId: string;
}): Promise<{
  success: boolean;
  diagnosis?: {
    cause: string;
    details: string;
    solutions: string[];
  };
  message: string;
}> {
  try {
    // Mock implementation - in production would query actual job logs
    const diagnosis = {
      cause: "參數設定問題",
      details: "prompt 長度超過模型限制",
      solutions: [
        "縮短提示詞長度至 300 字元以內",
        "將複雜的描述拆分成多個簡單的關鍵字",
        "移除不必要的細節描述",
      ],
    };

    logger.info("failure_diagnosed", {
      userId: input.userId,
      jobId: input.jobId,
    });

    return {
      success: true,
      diagnosis,
      message: "診斷完成",
    };
  } catch (error) {
    logger.error("debug_failure_error", {
      userId: input.userId,
      jobId: input.jobId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `診斷失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Compare model performance
 */
export function compareModels(input: {
  models: string[];
  criteria: "speed" | "quality" | "cost" | "versatility";
}): {
  success: boolean;
  comparison: Array<{
    modelId: string;
    score: number;
    pros: string[];
    cons: string[];
    recommendation: string;
  }>;
} {
  // Simplified comparison - in production would use actual metrics
  const mockComparison = [
    {
      modelId: "flux-1.1-pro",
      score: 95,
      pros: ["極快的生成速度", "高品質輸出", "穩定性佳"],
      cons: ["相對較高的成本"],
      recommendation: "適合需要快速迭代的專業用戶",
    },
    {
      modelId: "sd3-large",
      score: 85,
      pros: ["開源免費", "可客製化", "社群支援豐富"],
      cons: ["速度較慢", "需要更多調參經驗"],
      recommendation: "適合有技術背景且預算有限的用戶",
    },
  ];

  return {
    success: true,
    comparison: mockComparison,
  };
}

/**
 * Get technical documentation
 */
export function getTechnicalDocs(topic: string): {
  success: boolean;
  documentation?: {
    title: string;
    sections: Array<{
      heading: string;
      content: string;
      codeExample?: string;
    }>;
  };
  message: string;
} {
  const docs: Record<string, any> = {
    "api-parameters": {
      title: "API 參數說明",
      sections: [
        {
          heading: "基本參數",
          content: "prompt, modelId, num_images",
        },
        {
          heading: "進階參數",
          content: "guidance_scale, num_inference_steps, seed",
          codeExample: '{ "guidance_scale": 7.5, "num_inference_steps": 50 }',
        },
      ],
    },
  };

  const doc = docs[topic];

  if (!doc) {
    return {
      success: false,
      message: `找不到主題「${topic}」的技術文件`,
    };
  }

  return {
    success: true,
    documentation: doc,
    message: "文件已載入",
  };
}
