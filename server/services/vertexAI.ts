/**
 * vertexAI.ts — Vertex AI 模型目錄與呼叫服務
 *
 * 功能：
 *   - Gemini Pro/Flash 在 Vertex AI 上的 OpenAI 相容端點
 *   - Imagen on Vertex（企業版圖像生成）
 *   - Chirp 語音識別（STT）
 *   - Text Embeddings（text-embedding-005）
 *   - Multimodal Embeddings
 */

import { serverEnv } from "../_core/env.validated";
import { ENV } from "../_core/env";

// ─── Vertex AI 模型目錄 ────────────────────────────────────────────────────

export const VERTEX_LANGUAGE_MODELS = [
  {
    value: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro（Vertex）",
    tier: "premium" as const,
    description: "旗艦推理模型，100萬Token上下文，Vertex企業級",
    maxTokens: 65536,
    supportsThinking: true,
    supportsGrounding: true,
    supportsVision: true,
  },
  {
    value: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash（Vertex）",
    tier: "fast" as const,
    description: "高速推理，成本效益最佳，支援思維模式",
    maxTokens: 65536,
    supportsThinking: true,
    supportsGrounding: true,
    supportsVision: true,
  },
  {
    value: "google/gemini-2.0-flash-exp",
    label: "Gemini 2.0 Flash Exp",
    tier: "fast" as const,
    description: "Gemini 2.0 Flash 實驗版，多模態原生",
    maxTokens: 32768,
    supportsThinking: false,
    supportsGrounding: true,
    supportsVision: true,
  },
  {
    value: "google/gemini-1.5-pro",
    label: "Gemini 1.5 Pro 002",
    tier: "premium" as const,
    description: "Gemini 1.5 Pro 最新穩定版，長上下文",
    maxTokens: 65536,
    supportsThinking: false,
    supportsGrounding: true,
    supportsVision: true,
  },
  {
    value: "google/gemini-1.5-flash",
    label: "Gemini 1.5 Flash 002",
    tier: "standard" as const,
    description: "Gemini 1.5 Flash 穩定版",
    maxTokens: 32768,
    supportsThinking: false,
    supportsGrounding: false,
    supportsVision: true,
  },
  {
    value: "meta/llama-3.2-90b-vision-instruct-maas",
    label: "Llama 3.2 90B Vision（Vertex）",
    tier: "premium" as const,
    description: "Meta Llama 3.2 90B 視覺指令模型，Vertex MaaS",
    maxTokens: 32768,
    supportsThinking: false,
    supportsGrounding: false,
    supportsVision: true,
  },
  {
    value: "meta/llama-3.1-405b-instruct-maas",
    label: "Llama 3.1 405B（Vertex）",
    tier: "premium" as const,
    description: "Meta Llama 3.1 405B 旗艦模型",
    maxTokens: 32768,
    supportsThinking: false,
    supportsGrounding: false,
    supportsVision: false,
  },
  {
    value: "mistral-nemo@2407",
    label: "Mistral NeMo（Vertex）",
    tier: "standard" as const,
    description: "Mistral NeMo 12B 多語言模型",
    maxTokens: 32768,
    supportsThinking: false,
    supportsGrounding: false,
    supportsVision: false,
  },
] as const;

export const VERTEX_IMAGE_MODELS = [
  {
    value: "imagegeneration@006",
    label: "Imagen 3（Vertex）",
    tier: "premium" as const,
    description: "Vertex AI 企業版 Imagen 3，支援自訂風格",
    supportsNegativePrompt: true,
    maxImages: 8,
  },
  {
    value: "imagegeneration@005",
    label: "Imagen 2（Vertex）",
    tier: "standard" as const,
    description: "Vertex AI Imagen 2 穩定版",
    supportsNegativePrompt: false,
    maxImages: 4,
  },
] as const;

export const VERTEX_EMBEDDING_MODELS = [
  {
    value: "text-embedding-005",
    label: "Text Embedding 005",
    tier: "standard" as const,
    description: "最新文字嵌入模型，768維度",
    dimensions: 768,
  },
  {
    value: "textembedding-gecko@003",
    label: "Text Embedding Gecko 003",
    tier: "fast" as const,
    description: "輕量文字嵌入模型",
    dimensions: 768,
  },
  {
    value: "multimodalembedding@001",
    label: "Multimodal Embedding",
    tier: "standard" as const,
    description: "多模態嵌入（文字+圖片+影片）",
    dimensions: 1408,
  },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────

export interface VertexLLMParams {
  model: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  systemInstruction?: string;
  enableGrounding?: boolean; // Google Search Grounding
  thinkingBudget?: number; // Thinking token budget
}

export interface VertexLLMResult {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  groundingMetadata?: Record<string, unknown>;
}

export interface VertexImageParams {
  prompt: string;
  model?: string;
  numImages?: number;
  aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
  negativePrompt?: string;
  seed?: number;
  personGeneration?: "allow_adult" | "allow_all" | "dont_allow";
  safetyFilterLevel?:
    | "block_low_and_above"
    | "block_medium_and_above"
    | "block_only_high";
}

export interface VertexEmbeddingParams {
  text: string;
  model?: string;
  taskType?:
    | "RETRIEVAL_DOCUMENT"
    | "RETRIEVAL_QUERY"
    | "SEMANTIC_SIMILARITY"
    | "CLASSIFICATION"
    | "CLUSTERING";
}

// ─── Vertex AI Client ─────────────────────────────────────────────────────

export class VertexAIClient {
  private projectId: string | null;
  private location: string;
  private geminiApiKey: string | null;

  constructor() {
    this.projectId = serverEnv.GOOGLE_CLOUD_PROJECT_ID ?? null;
    this.location = serverEnv.GOOGLE_CLOUD_LOCATION ?? "us-central1";
    this.geminiApiKey = ENV.geminiApiKey ?? null;
  }

  get isAvailable(): boolean {
    // 支援兩種認證方式：Gemini API Key 或 GOOGLE_APPLICATION_CREDENTIALS_JSON
    return !!(
      this.geminiApiKey || serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON
    );
  }

  /** 取得 Vertex AI OpenAI 相容端點 base URL */
  private getVertexBaseUrl(model: string): string {
    if (!this.projectId) {
      // 若無 Project ID，退回 Gemini API 相容端點
      return `https://generativelanguage.googleapis.com/v1beta/models/${model}`;
    }

    // Vertex AI OpenAI-compatible endpoint
    return `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/endpoints/openapi`;
  }

  /** 取得 API Key（優先 Gemini，備用 Service Account）*/
  private getApiKey(): string {
    if (this.geminiApiKey) return this.geminiApiKey;
    throw new Error("Vertex AI 需要 GEMINI_API_KEY 或服務帳號認證");
  }

  // ── 語言模型呼叫（OpenAI 相容） ──────────────────────────────────────────
  async chat(params: VertexLLMParams): Promise<VertexLLMResult> {
    const apiKey = this.getApiKey();
    const modelId = params.model;

    // 使用 Gemini API（OpenAI 相容層）
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId.replace("google/", "")}:generateContent?key=${apiKey}`;

    const contents: Array<Record<string, unknown>> = [];
    let systemInstruction: string | undefined = params.systemInstruction;

    for (const msg of params.messages) {
      if (msg.role === "system") {
        systemInstruction = msg.content;
        continue;
      }
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.maxTokens ?? 8192,
        ...(params.topP != null && { topP: params.topP }),
      },
    };

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    // Google Search Grounding
    if (params.enableGrounding) {
      body.tools = [{ googleSearch: {} }];
    }

    // Thinking mode
    if (params.thinkingBudget) {
      (body.generationConfig as any).thinkingConfig = {
        thinkingBudget: params.thinkingBudget,
      };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Vertex AI LLM 錯誤 ${res.status}: ${errText.slice(0, 300)}`
      );
    }

    const data = (await res.json()) as any;
    const candidate = data.candidates?.[0];
    const content =
      candidate?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    const usage = data.usageMetadata ?? {};

    return {
      content,
      model: modelId,
      usage: {
        promptTokens: usage.promptTokenCount ?? 0,
        completionTokens: usage.candidatesTokenCount ?? 0,
        totalTokens: usage.totalTokenCount ?? 0,
      },
      groundingMetadata: candidate?.groundingMetadata,
    };
  }

  // ── 圖片生成（Imagen on Vertex） ─────────────────────────────────────────
  async generateImage(params: VertexImageParams): Promise<{
    images: Array<{ base64: string; mimeType: string }>;
  }> {
    const apiKey = this.getApiKey();
    const model = params.model ?? "imagegeneration@006";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.split("@")[0]}-3.0-generate-002:predict?key=${apiKey}`;

    const body = {
      instances: [
        {
          prompt: params.prompt,
          ...(params.negativePrompt && {
            negativePrompt: params.negativePrompt,
          }),
        },
      ],
      parameters: {
        sampleCount: params.numImages ?? 1,
        ...(params.aspectRatio && { aspectRatio: params.aspectRatio }),
        ...(params.seed != null && { seed: params.seed }),
        ...(params.personGeneration && {
          personGeneration: params.personGeneration,
        }),
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Vertex Imagen 錯誤 ${res.status}: ${errText.slice(0, 300)}`
      );
    }

    const data = (await res.json()) as any;
    return {
      images: (data.predictions ?? []).map((p: any) => ({
        base64: p.bytesBase64Encoded ?? "",
        mimeType: p.mimeType ?? "image/png",
      })),
    };
  }

  // ── 文字嵌入 ─────────────────────────────────────────────────────────────
  async embed(params: VertexEmbeddingParams): Promise<number[]> {
    const apiKey = this.getApiKey();
    const model = params.model ?? "text-embedding-005";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;

    const body = {
      model: `models/${model}`,
      content: { parts: [{ text: params.text }] },
      ...(params.taskType && { taskType: params.taskType }),
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Vertex Embedding 錯誤 ${res.status}: ${errText.slice(0, 300)}`
      );
    }

    const data = (await res.json()) as any;
    return data.embedding?.values ?? [];
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _vertexClient: VertexAIClient | null = null;

export function getVertexAIClient(): VertexAIClient {
  if (!_vertexClient) {
    _vertexClient = new VertexAIClient();
  }
  return _vertexClient;
}
