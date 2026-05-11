/**
 * server/services/spiritTools/legalAdvisorTools.ts
 *
 * Tools for legal-advisor (法法) spirit.
 * Handles compliance checks, license verification, and legal guidance.
 */

import { logger } from "../../_core/logger";

/**
 * Check content compliance
 */
export function checkCompliance(input: {
  contentType: "image" | "video" | "audio" | "text";
  description: string;
}): {
  success: boolean;
  compliant: boolean;
  issues?: string[];
  recommendations?: string[];
} {
  // Simplified compliance check - in production this would use AI moderation
  const sensitiveKeywords = ["暴力", "色情", "賭博", "毒品", "政治敏感"];
  const foundIssues: string[] = [];

  sensitiveKeywords.forEach(keyword => {
    if (input.description.includes(keyword)) {
      foundIssues.push(`內容可能涉及「${keyword}」相關議題`);
    }
  });

  const compliant = foundIssues.length === 0;

  logger.info("compliance_check_performed", {
    contentType: input.contentType,
    compliant,
    issueCount: foundIssues.length,
  });

  return {
    success: true,
    compliant,
    issues: foundIssues.length > 0 ? foundIssues : undefined,
    recommendations: !compliant ? [
      "請確保內容符合當地法規",
      "避免生成可能侵權或違法的內容",
      "考慮調整提示詞或修改內容描述",
    ] : undefined,
  };
}

/**
 * Check license and usage rights
 */
export function checkLicense(input: {
  assetType: string;
  modelName?: string;
  useCase: "personal" | "commercial" | "redistribution";
}): {
  success: boolean;
  allowed: boolean;
  license: string;
  restrictions?: string[];
  attribution?: string;
} {
  // Simplified license check
  const licenses: Record<string, any> = {
    "flux": {
      license: "Apache 2.0",
      commercial: true,
      attribution: "Black Forest Labs",
    },
    "sd3": {
      license: "Stability AI Community License",
      commercial: false,
      attribution: "Stability AI",
    },
    "default": {
      license: "Platform Standard License",
      commercial: true,
      attribution: null,
    },
  };

  const licenseInfo = licenses[input.modelName || "default"] || licenses["default"];
  const allowed = input.useCase === "commercial" ? licenseInfo.commercial : true;

  return {
    success: true,
    allowed,
    license: licenseInfo.license,
    restrictions: !allowed ? ["此模型不允許商業使用"] : undefined,
    attribution: licenseInfo.attribution,
  };
}

/**
 * Get legal guidelines
 */
export function getLegalGuidelines(): {
  success: boolean;
  guidelines: Array<{
    category: string;
    title: string;
    description: string;
  }>;
} {
  return {
    success: true,
    guidelines: [
      {
        category: "版權",
        title: "尊重原創",
        description: "避免生成明顯抄襲或侵權的內容",
      },
      {
        category: "肖像權",
        title: "保護隱私",
        description: "不得未經同意使用他人肖像",
      },
      {
        category: "商標",
        title: "避免混淆",
        description: "不得使用可能造成混淆的商標或品牌",
      },
      {
        category: "內容規範",
        title: "遵守法規",
        description: "確保內容符合當地法律法規",
      },
      {
        category: "使用許可",
        title: "確認授權",
        description: "商業使用前確認模型的授權條款",
      },
    ],
  };
}
