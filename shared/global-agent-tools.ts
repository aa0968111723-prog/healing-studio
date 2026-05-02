export type GlobalAgentToolTarget =
  | "ui-only"
  | "server-side"
  | "claudeCode"
  | "external-provider";

export interface GlobalAgentToolDefinition {
  name: string;
  riskLevel: "low" | "medium" | "high";
  requiresHuman: boolean;
  allowedArgsSchema: Record<string, unknown>;
  executionTarget: GlobalAgentToolTarget;
}

export const GLOBAL_AGENT_TOOL_REGISTRY: GlobalAgentToolDefinition[] = [
  {
    name: "media.transcribe",
    riskLevel: "medium",
    requiresHuman: false,
    allowedArgsSchema: { url: "string", mimeType: "string?" },
    executionTarget: "external-provider",
  },
  {
    name: "media.caption",
    riskLevel: "medium",
    requiresHuman: false,
    allowedArgsSchema: { transcript: "string", style: "string?" },
    executionTarget: "server-side",
  },
  {
    name: "media.storyboard",
    riskLevel: "medium",
    requiresHuman: false,
    allowedArgsSchema: { summary: "string", durationSec: "number?" },
    executionTarget: "server-side",
  },
  {
    name: "media.summarizePdf",
    riskLevel: "medium",
    requiresHuman: false,
    allowedArgsSchema: { url: "string" },
    executionTarget: "external-provider",
  },
  {
    name: "media.extractPrompt",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: { text: "string?" },
    executionTarget: "server-side",
  },
  {
    name: "github.review",
    riskLevel: "high",
    requiresHuman: true,
    allowedArgsSchema: { repo: "string", pr: "number?" },
    executionTarget: "claudeCode",
  },
  {
    name: "github.pr.create",
    riskLevel: "high",
    requiresHuman: true,
    allowedArgsSchema: { repo: "string", title: "string", body: "string?" },
    executionTarget: "claudeCode",
  },
  {
    name: "deploy.preview",
    riskLevel: "high",
    requiresHuman: true,
    allowedArgsSchema: { service: "string", env: "string?" },
    executionTarget: "external-provider",
  },
  {
    name: "code.modifyWithClaudeCode",
    riskLevel: "high",
    requiresHuman: true,
    allowedArgsSchema: { task: "string", files: "string[]?" },
    executionTarget: "claudeCode",
  },
  // ─── 創作工作室生成工具（光球可在多步驟計畫中直接觸發生成） ──
  {
    name: "studio.generateImage",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      prompt: "string",
      modelId: "string?",
      aspect_ratio: "string?",
      num_images: "number?",
      negative_prompt: "string?",
    },
    executionTarget: "server-side",
  },
  {
    name: "studio.generateVideo",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      prompt: "string",
      modelId: "string?",
      // i2v：起始幀（並可給結束幀）
      image_url: "string?",
      end_image_url: "string?",
      // v2v：來源影片 + 風格化強度
      video_url: "string?",
      strength: "number?",
      cfg_scale: "number?",
      // 通用
      duration: "number?",
      aspect_ratio: "string?",
      negative_prompt: "string?",
      seed: "number?",
      num_frames: "number?",
      fps: "number?",
      width: "number?",
      height: "number?",
    },
    executionTarget: "server-side",
  },
  {
    // 影片畫質優化：upscale / interpolate / enhance 三種操作走同一工具
    name: "studio.enhanceVideo",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      video_url: "string",
      operation: "string", // "upscale" | "interpolate" | "enhance"
      modelId: "string?",
      // 共用
      output_scale: "number?",
      // upscale
      upscale_factor: "number?",
      // interpolate
      multiplier: "number?",
      output_fps: "number?",
      // topaz
      topaz_model: "string?", // iris / artemis / theia / gaia / nyx
    },
    executionTarget: "server-side",
  },
  {
    name: "studio.generateAudio",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      prompt: "string",
      modelId: "string?",
      lyrics: "string?",
      instrumental: "boolean?",
      duration: "number?",
    },
    executionTarget: "server-side",
  },
  // DEF-SFX2：光球專用 SFX 生成工具，與音樂分流。
  // 路由到 fal-ai/stable-audio 或 fal-ai/mmaudio-v2，prompt 為 Foley/環境音描述，
  // duration 為秒數（stable-audio 走 seconds_total，mmaudio-v2 走 duration）。
  {
    name: "studio.generateSfx",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      prompt: "string",
      modelId: "string?",
      duration: "number?",
    },
    executionTarget: "server-side",
  },
  // DEF-VC1 / DEF-IVC3：光球專用 voice cloning 工具 — 兩條路徑：
  //   - 預設 Qwen 3 zero-shot clone：30 秒參考音訊內 → speaker_embedding URL
  //   - ElevenLabs IVC（modelId="fal-ai/elevenlabs/voice-cloning"）：1-3 分鐘
  //     參考音訊 → 永久 voice_id（可餵給全家族 TTS / dubbing）；需 name 欄位
  //     與 ELEVENLABS_API_KEY，缺 key 時自動退回 Qwen clone。
  // 後續 step 可透過 ${stepN.speaker_voice_embedding_file_url} 或
  // ${stepN.voice_id} 鏈接到 studio.generateVoice。
  {
    name: "studio.cloneVoice",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      audio_url: "string",
      modelId: "string?",
      reference_text: "string?",
      name: "string?",
      description: "string?",
    },
    executionTarget: "server-side",
  },
  // DEF-VD1：光球專用 voice design 工具 — 用文字描述設計虛擬聲音
  // （年齡/性別/情緒/語速等），輸出 speaker embedding，可在後續 step 透過
  // studio.generateVoice 帶 speaker_voice_embedding_file_url 復用。
  // 與 cloneVoice 互補：cloneVoice 從參考音訊複製真實聲音、designVoice 從
  // 文字描述產生虛擬角色聲音。預設走 fal-ai/qwen-3-tts/voice-design/1.7b。
  {
    name: "studio.designVoice",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      voice_description: "string",
      modelId: "string?",
      text: "string?",
    },
    executionTarget: "server-side",
  },
  // DEF-DM2：光球專用音幹分離工具 — 把整首歌拆成多軌（vocals / drums /
  // bass / other [+guitar/piano]），後續 step 可用 ${stepN.vocals_url} /
  // ${stepN.drums_url} 等接到混音 / mergeAudios / voiceChanger 等流程。
  // 預設走 fal-ai/demucs（htdemucs_ft 4 軌）。
  {
    name: "studio.separateStems",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      audio_url: "string",
      modelId: "string?",
      stem_model: "string?",
      output_format: "string?",
    },
    executionTarget: "server-side",
  },
  {
    name: "studio.generateVoice",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      text: "string",
      modelId: "string?",
      voice_id: "string?",
      speed: "number?",
    },
    executionTarget: "server-side",
  },
  // ─── 導演 AI 規劃工具（光球可請導演為當前工作室規劃下一步） ──
  {
    name: "director.suggestPlan",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      activeModality: "string",
      userIntent: "string?",
      selectedFalModelId: "string?",
      hasTokenWeights: "boolean?",
      hasFineTunedModel: "boolean?",
      personality: "string?",
    },
    executionTarget: "server-side",
  },
  // ─── 訓練 / 微調工具（光球可幫使用者訓練屬於自己的 LoRA / 風格 / 角色模型） ──
  {
    // 啟動 LoRA / 風格 / 角色 / 場景 / 影片 LoRA / 肖像 LoRA 訓練。
    // 訓練本身耗時 5–30 分鐘，因此不同步等待完成；回傳 modelId+jobId 讓
    // 使用者可在儀表板（/training-jobs）監控進度。
    name: "studio.trainLora",
    riskLevel: "high",
    requiresHuman: true,
    allowedArgsSchema: {
      // 訓練類別：image_subject / portrait_lora / style_lora / scene_lora /
      // video_lora / voice_clone（依 shared/types TrainingModelType）。
      modelType: "string",
      // 模型名稱（出現在儀表板與生成下拉選單）。
      name: "string",
      // 觸發詞 / token：在生成 prompt 中啟用此模型。
      triggerWord: "string?",
      description: "string?",
      // 訓練引擎：fal | replicate（預設 fal，速度較快）。
      trainingEngine: "string?",
      // 進階：訓練步數 / 學習率 / 批次大小 / 是否風格化。
      epochs: "number?",
      learningRate: "number?",
      batchSize: "number?",
      isStyle: "boolean?",
      // 訓練資料：圖片 / 影片 URL 陣列（每個元素需含 url，可選 fileKey）。
      datasetImages: "object?",
      datasetVideos: "object?",
      // 強制覆寫 fal 訓練 modelId（進階）。
      falModelId: "string?",
    },
    executionTarget: "server-side",
  },
];

export function getGlobalAgentTool(name: string): GlobalAgentToolDefinition | null {
  return GLOBAL_AGENT_TOOL_REGISTRY.find(tool => tool.name === name) ?? null;
}

export function isKnownGlobalAgentTool(name: string): boolean {
  return Boolean(getGlobalAgentTool(name));
}

export function summarizeGlobalToolRegistry(limit = 40): string {
  return JSON.stringify({
    total: GLOBAL_AGENT_TOOL_REGISTRY.length,
    tools: GLOBAL_AGENT_TOOL_REGISTRY.slice(0, limit).map(tool => ({
      name: tool.name,
      riskLevel: tool.riskLevel,
      requiresHuman: tool.requiresHuman,
      executionTarget: tool.executionTarget,
    })),
  });
}
