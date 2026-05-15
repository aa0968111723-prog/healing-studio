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
      // img2img / 編輯：起始圖 + 強度（對應 ImageStudio 的編輯/姿勢/3D 流程）
      image_url: "string?",
      image_urls: "string[]?",
      strength: "number?",
      // 可重現性
      seed: "number?",
      // 推論調諧（Flux / SDXL 都支援）
      guidance_scale: "number?",
      num_inference_steps: "number?",
      output_format: "string?",
      // 模型特定編輯參數
      resolution: "string?",     // nanoBanana2Edit: "0.5K" | "1K" | "2K" | "4K"
      mask_url: "string?",       // gptImage15Edit: inpainting mask
      size: "string?",           // gptImage15Edit: output size
      image_size: "string?",     // flux2ProEdit: preset size
      // 影像放大參數
      upscale_factor: "number?",
      upscale_mode: "string?",
      target_resolution: "string?",
      // 骨骼姿勢偵測參數
      detect_hand: "boolean?",
      detect_face: "boolean?",
      detect_body: "boolean?",
      // LoRA 注入（用 ${stepN.lora_url} 從訓練步驟串進來）
      lora_url: "string?",
      lora_scale: "number?",
      // ControlNet 強度（SD 3.5 ControlNet 支援）
      controlnet_conditioning_scale: "number?",
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
      // 風格標籤（逗號分隔）+ BPM；底層 textToMusic / Sonauto 都支援
      tags: "string?",
      bpm: "number?",
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
  // DEF-AI3：光球專用音訊隔離 — 與 separateStems 互補：分離拆多軌、隔離抽
  // 乾淨單軌（去背景噪、保留人聲/語音）。預設 fal-ai/elevenlabs/audio-isolation
  // （需 ELEVENLABS_API_KEY），缺 key 時退回 fal-ai/demucs 並取 vocals 軌。
  // 後續 step 可用 ${stepN.audio_url} 接到 STT / voiceChanger / mergeAudios。
  {
    name: "studio.isolateAudio",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      audio_url: "string",
      modelId: "string?",
    },
    executionTarget: "server-side",
  },
  // DEF-MA3：光球專用多音訊合併 — separateStems → 替換／設計人聲 → mergeAudios
  // 三段式工作流的最後一塊。strategy="concatenate" 序接（多段對白接龍）；
  // "mix" 混音（伴奏 + 替換人聲合成完整成品）。預設走 fal-ai/ffmpeg-api/merge-audios。
  {
    name: "studio.mergeAudios",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      audio_urls: "string[]",
      merge_strategy: "string?",
      modelId: "string?",
    },
    executionTarget: "server-side",
  },
  // DEF-VCH4：光球專用聲音變換 — 把現有錄音的「聲音」換成另一個 voice_id，
  // 但保留原始語氣、語速、情緒。與 cloneVoice + generateVoice 三件互補：
  //   - cloneVoice：建立 voice_id（從參考音訊）
  //   - generateVoice：用 voice_id 念新文字
  //   - changeVoice：用 voice_id 改寫現有錄音的聲音（保留原時長與停頓）
  // 預設 fal-ai/elevenlabs/voice-changer（需 ELEVENLABS_API_KEY）。
  {
    name: "studio.changeVoice",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      audio_url: "string",
      voice_id: "string",
      remove_background_noise: "boolean?",
      modelId: "string?",
    },
    executionTarget: "server-side",
  },
  // DEF-ASR3：光球專用語音轉文字（ASR）— 把音訊轉成文字稿，後續 step 可接到
  // LLM 翻譯 / 摘要 / 重新合成（generateVoice）等。預設 Nemotron ASR（SSE 串流，
  // 自動偵測語言），不需特殊 key。完成「逐字稿」工作流的關鍵一塊。
  {
    name: "studio.transcribe",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      audio_url: "string",
      modelId: "string?",
      acceleration: "string?",
    },
    executionTarget: "server-side",
  },
  // DEF-WAN2：光球專用說話人動畫 — 靜態頭像 + 配音 → 對嘴說話影片。
  // 是「克隆聲音 → TTS → 動畫」工作流的最後一塊。預設 fal-ai/wan/v2.2-14b/speech-to-video。
  // 與 generateVideo（純 i2v / t2v）區別：必須有 audio_url，產出對嘴而非純動畫。
  {
    name: "studio.animateSpeaker",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      image_url: "string",
      audio_url: "string",
      prompt: "string?",
      num_frames: "number?",
      modelId: "string?",
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
      // 多語 TTS 必要欄位；缺這個多語推理就退回英文
      language_code: "string?",
      // ElevenLabs engine 切換（turbo-v2.5 / flash-v2.5 / multilingual-v2 / eleven-v3）
      engine: "string?",
      // ElevenLabs 聲音調諧
      stability: "number?",
      similarity_boost: "number?",
      style: "number?",
    },
    executionTarget: "server-side",
  },
  {
    // 圖片創作室 3D 分頁的 5 個模型統一入口（trellis-2 / sam-3/3d-objects /
    // hunyuan3d-v3 / hyper3d/rodin / hunyuan_world）。3D 推論單次需 1-5 分鐘,
    // executor 提交後立即回 request_id,結果寫入 backgroundJob 由 webhook 收尾。
    // category 自動依 modelId / prompt / image_url 推斷:
    //   - prompt 但無 image_url        → text-to-3d (Rodin 純文字模式)
    //   - image_url 但無 prompt        → image-to-3d (Trellis / SAM / HunYuan3D / Rodin / HunYuan World)
    //   - prompt + image_url 兼用      → image-to-3d (Rodin 雙輸入,condition_mode 控制融合)
    name: "studio.generate3D",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      modelId: "string?",
      // 雙輸入(Rodin)或單獨任一(其他模型)
      prompt: "string?",
      image_url: "string?",
      image_urls: "string[]?",
      // HunYuan3D v3 多視角輸入(可選,提升正背面品質)
      input_image_url: "string?",
      back_image_url: "string?",
      left_image_url: "string?",
      right_image_url: "string?",
      // Trellis 2 與其他 mesh 模型的解析度 / 紋理控制
      resolution: "string?",
      texture_size: "string?",
      remesh: "boolean?",
      // HunYuan3D v3 拓樸控制
      enable_pbr: "boolean?",
      face_count: "number?",
      generate_type: "string?", // Normal | LowPoly | Geometry
      polygon_type: "string?", // triangle | quadrilateral
      // SAM 3D 偵測控制
      export_textured_glb: "boolean?",
      detection_threshold: "number?",
      // Rodin 雙輸入融合 + 輸出格式 + 品質
      condition_mode: "string?", // fuse | concat
      geometry_file_format: "string?", // glb | usdz | fbx | obj | stl
      material: "string?", // PBR | Shaded
      quality: "string?", // high | medium | low | extra-low
      use_hyper: "boolean?",
      // HunYuan World 場景語意標籤
      labels_fg1: "string?",
      labels_fg2: "string?",
      classes: "string?",
      export_drc: "boolean?",
      // 通用
      seed: "number?",
    },
    executionTarget: "server-side",
  },
  // ─── 外部網路深度搜尋（Perplexity Deep Search 驅動） ──
  // 光球可在使用者要求搜尋外部網路資訊時呼叫此工具，透過 Perplexity Sonar
  // 搜尋引擎取得最新資訊、技術趨勢、產品比較、新聞等外部知識。
  // 回傳結構化摘要 + 可點擊引用來源，可選擇寫入學習文件中心。
  {
    name: "research.deepSearch",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      // 搜尋查詢（必填）：例「2026 最新 AI 圖片生成技術」「如何做出好的短影片」
      query: "string",
      // 時間範圍過濾（選填）：day / week / month / year
      recencyFilter: "string?",
      // 限定搜尋網域（選填）：例 ["arxiv.org", "github.com"]
      domainFilter: "string[]?",
      // 搜尋語言偏好（選填）：zh-TW / en / ja / ko
      language: "string?",
      // 最大結果數（選填，預設 5，最大 10）
      maxResults: "number?",
      // 是否將搜尋結果寫入學習文件中心（選填，預設 false）
      addToLearnHub: "boolean?",
    },
    executionTarget: "server-side",
  },
  // ─── 即時靈感 / 時事 / 社群偏好查詢（Perplexity Sonar 驅動） ──
  // 光球可在創作前主動呼叫此工具拉取真實的網路情報：流行風格、熱門題材、
  // 社群討論度、近期 AI 模型發表、季節性 / 節慶題材等。回傳已附帶可點擊
  // 引用來源（PERPLEXITY_API_KEY 或 OPENROUTER_API_KEY 任一即可運作）。
  {
    name: "inspiration.fetch",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      // 主題關鍵字（必填）：例「貓咪短影片風格」、「2025 春天婚紗攝影流行色」
      topic: "string",
      // 模態提示（選填）：image / video / audio / voice / 3d / 不填則泛用
      modality: "string?",
      // 視角提示（選填）：trending / community / news / seasonal / model_release
      angle: "string?",
      // 期望輸出風格（選填）：visual_styles / prompt_keywords / mood_board / quick_facts
      format: "string?",
      // 限制：最多回幾筆引用（預設 5，最大 8）
      maxResults: "number?",
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
      // video_lora / voice_clone / concept_lora / product_lora / fashion_lora /
      // pose_lora（依 shared/types TrainingModelType）。
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
  // ─── 記記（notes-curator）筆記與資產管理工具 ──
  {
    name: "notesCurator.createNote",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      title: "string",
      content: "string",
      tags: "string[]?",
      category: "string?",
    },
    executionTarget: "server-side",
  },
  {
    name: "notesCurator.searchNotes",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      query: "string",
      limit: "number?",
    },
    executionTarget: "server-side",
  },
  {
    name: "notesCurator.scheduleTask",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      taskName: "string",
      scheduledFor: "string",
      description: "string?",
      metadata: "object?",
    },
    executionTarget: "server-side",
  },
  {
    name: "notesCurator.tagAssets",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      assetIds: "number[]",
      tags: "string[]",
      action: "string?",
    },
    executionTarget: "server-side",
  },
  {
    name: "notesCurator.getAssetStatistics",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {},
    executionTarget: "server-side",
  },
  // ─── 細細（settings-detail）設定管理工具 ──
  {
    name: "settingsDetail.getPreferences",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {},
    executionTarget: "server-side",
  },
  {
    name: "settingsDetail.updatePreference",
    riskLevel: "medium",
    requiresHuman: false,
    allowedArgsSchema: {
      key: "string",
      value: "any",
    },
    executionTarget: "server-side",
  },
  {
    name: "settingsDetail.explainSetting",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      settingKey: "string",
    },
    executionTarget: "server-side",
  },
  {
    name: "settingsDetail.getAllSettings",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {},
    executionTarget: "server-side",
  },
  {
    name: "settingsDetail.validatePreference",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      key: "string",
      value: "any",
    },
    executionTarget: "server-side",
  },
  // ─── 記記（memory-manager）長期記憶管理工具 ──
  {
    name: "memoryManager.storeMemory",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      content: "string",
      memoryType: "string",  // user_fact | user_preference | skill_learned | workflow_pattern | error_solution | success_recipe | context_snippet
      importanceScore: "number?",
      sourceType: "string?",
      sourceId: "string?",
      spiritId: "string?",
      metadata: "object?",
    },
    executionTarget: "server-side",
  },
  {
    name: "memoryManager.searchMemories",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      query: "string",
      memoryType: "string?",
      limit: "number?",
      minImportance: "number?",
    },
    executionTarget: "server-side",
  },
  {
    name: "memoryManager.getStats",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {},
    executionTarget: "server-side",
  },
  {
    name: "memoryManager.consolidate",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {},
    executionTarget: "server-side",
  },
  // ─── 意圖澄清引擎（clarificationEngine）工具 ──
  {
    name: "clarificationEngine.identifyIntent",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      userInput: "string",
      conversationId: "string",
      context: "object?",
    },
    executionTarget: "server-side",
  },
  {
    name: "clarificationEngine.recordAnswer",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      clarificationId: "string",
      userAnswer: "string",
    },
    executionTarget: "server-side",
  },
  {
    name: "clarificationEngine.getPattern",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      questionType: "string",
    },
    executionTarget: "server-side",
  },
  {
    name: "clarificationEngine.getStats",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {},
    executionTarget: "server-side",
  },
  // ─── 功能發現引擎（featureDiscovery）工具 ──
  {
    name: "featureDiscovery.recordUsage",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      featureId: "string",
      success: "boolean",
      duration: "number?",
      metadata: "object?",
    },
    executionTarget: "server-side",
  },
  {
    name: "featureDiscovery.recordDiscovery",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      featureId: "string",
      discoveryMethod: "string", // orb_suggestion | menu_exploration | search | tutorial | friend_share | documentation | accident
      fromFeatureId: "string?",
      context: "string?",
    },
    executionTarget: "server-side",
  },
  {
    name: "featureDiscovery.getStats",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      featureId: "string?",
    },
    executionTarget: "server-side",
  },
  {
    name: "featureDiscovery.getRecommendations",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      limit: "number?",
    },
    executionTarget: "server-side",
  },
  {
    name: "featureDiscovery.getInsights",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {},
    executionTarget: "server-side",
  },
  // ─── 工作流程引擎（workflowEngine）工具 ──
  {
    name: "workflowEngine.createTemplate",
    riskLevel: "medium",
    requiresHuman: false,
    allowedArgsSchema: {
      name: "string",
      description: "string?",
      category: "string",
      isPublic: "boolean?",
      steps: "array",
      difficulty: "string?", // beginner | intermediate | advanced
      tags: "array?",
    },
    executionTarget: "server-side",
  },
  {
    name: "workflowEngine.getTemplates",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      category: "string?",
      difficulty: "string?",
      isPublic: "boolean?",
      search: "string?",
      limit: "number?",
    },
    executionTarget: "server-side",
  },
  {
    name: "workflowEngine.executeWorkflow",
    riskLevel: "medium",
    requiresHuman: false,
    allowedArgsSchema: {
      templateId: "number",
      conversationId: "string?",
      inputs: "object?",
    },
    executionTarget: "server-side",
  },
  {
    name: "workflowEngine.getStatus",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      executionId: "string",
    },
    executionTarget: "server-side",
  },
  {
    name: "workflowEngine.controlWorkflow",
    riskLevel: "medium",
    requiresHuman: false,
    allowedArgsSchema: {
      executionId: "string",
      action: "string", // pause | resume | cancel
    },
    executionTarget: "server-side",
  },
  {
    name: "workflowEngine.getHistory",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      limit: "number?",
    },
    executionTarget: "server-side",
  },
  // ─── 步步（planExecutor）— 規劃 + 多步驟執行 agent ──
  // 這組工具讓 LLM planner 可以把「跑整條工作流」當成一個 step 開出來，
  // 由 server 端 planExecutor 引擎接手規劃 + 跨工具派遣 + 失敗修補。
  {
    name: "planExecutor.planFromGoal",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      goal: "string",
      context: "string?",
      maxSteps: "number?",
    },
    executionTarget: "server-side",
  },
  {
    name: "planExecutor.createPlan",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      goal: "string",
      steps: "array",
    },
    executionTarget: "server-side",
  },
  {
    name: "planExecutor.runPlan",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      planId: "string",
      async: "boolean?",
    },
    executionTarget: "server-side",
  },
  {
    name: "planExecutor.executeStep",
    riskLevel: "medium",
    requiresHuman: false,
    allowedArgsSchema: {
      planId: "string",
      stepIndex: "number?",
      stepId: "string?",
    },
    executionTarget: "server-side",
  },
  {
    name: "planExecutor.getStatus",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: { planId: "string" },
    executionTarget: "server-side",
  },
  {
    name: "planExecutor.controlPlan",
    riskLevel: "medium",
    requiresHuman: false,
    allowedArgsSchema: {
      planId: "string",
      action: "string", // pause | resume | cancel
    },
    executionTarget: "server-side",
  },
  {
    name: "planExecutor.listRuns",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: { limit: "number?" },
    executionTarget: "server-side",
  },
  {
    name: "planExecutor.replanOnFailure",
    riskLevel: "medium",
    requiresHuman: true,
    allowedArgsSchema: {
      planId: "string",
      hint: "string?",
    },
    executionTarget: "server-side",
  },
  {
    name: "planExecutor.getTemplates",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {},
    executionTarget: "server-side",
  },
  // ─── 系統監控（systemMonitor）工具 ──
  {
    name: "systemMonitor.getHealth",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {},
    executionTarget: "server-side",
  },
  {
    name: "systemMonitor.getCostAnalysis",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      userId: "number?",
      startDate: "string?",
      endDate: "string?",
    },
    executionTarget: "server-side",
  },
  {
    name: "systemMonitor.getCollaborationStats",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {},
    executionTarget: "server-side",
  },
  {
    name: "systemMonitor.getPerformanceTrends",
    riskLevel: "low",
    requiresHuman: false,
    allowedArgsSchema: {
      metricType: "string", // response_time | error_rate | tool_success_rate | user_satisfaction
      spiritId: "string?",
      days: "number?",
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
