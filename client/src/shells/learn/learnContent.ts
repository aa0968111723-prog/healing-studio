// ============================================================================
// shells/learn/learnContent.ts — /learn 的靜態知識內容（fallback + 五腦/六代理定義）
// ----------------------------------------------------------------------------
// 這些是「平台方法論」與「代理層定義」，同時餵 RAG 也給人看（盤點 §3-11）。
// 用途：
//   1) LearnDocsPanel 在 learnHub.list 尚無資料（cron 未跑 / DB 不可用）時的精選 fallback。
//   2) AIModelHubPanel 的五腦角色定義（決策/研究/長上下文/感知/生成腦）。
//   3) ResearchPanel / Hub 的六代理層展示。
// 不含任何執行期副作用，純資料常數。
// ============================================================================

/** 五腦角色（對映 user_ai_brain / agent_model_picks；模型 hub 指派用）。 */
export const BRAIN_ROLES = ["決策腦", "研究腦", "長上下文腦", "感知腦", "生成腦"] as const;
export type BrainRole = (typeof BRAIN_ROLES)[number];

/** 哪種 modality 適合指派到哪個腦（前端篩選 eligible 模型用）。 */
export const BRAIN_ELIGIBLE_MODALITY: Record<BrainRole, string[]> = {
  決策腦: ["llm", "text"],
  研究腦: ["search", "llm", "text"],
  長上下文腦: ["llm", "text", "embed"],
  感知腦: ["image", "video", "embed"],
  生成腦: ["image", "video", "audio"],
};

/** 六代理層（盤點 §3-11 / 模擬 SIX_AGENTS）。 */
export interface AgentLayer { id: string; emoji: string; label: string; role: string; tech: string; status: "可用" | "待接" }
export const SIX_AGENTS: AgentLayer[] = [
  { id: "director", emoji: "🎬", label: "導演 AI", role: "創作對話 · CO-STAR 雙引擎 × 三人格", tech: "director.chat", status: "可用" },
  { id: "commander", emoji: "🧭", label: "總指揮 Commander", role: "意圖編排 · 先計畫按開始才動", tech: "commander.createIntent", status: "可用" },
  { id: "context", emoji: "📦", label: "Context Packet", role: "壓縮上下文 · 代理真正讀的精華", tech: "contextPacket.compileProject", status: "可用" },
  { id: "research", emoji: "🌐", label: "研究代理", role: "grounding · Sonar + Brave 帶引用", tech: "orbProxy.unifiedSearch", status: "待接" },
  { id: "perception", emoji: "👁", label: "感知代理", role: "意圖理解 · 模糊先反問", tech: "sense.inferIntent", status: "可用" },
  { id: "accountant", emoji: "🧮", label: "財財（成本）", role: "先估成本再確認 · 扣點記帳", tech: "accountant.estimate / apiUsage", status: "可用" },
];

/** 精選方法論文件（learnHub 無資料時的 fallback；6 篇對映盤點精選）。 */
export interface MethodologyDoc { id: string; title: string; category: string; difficulty: "入門" | "進階" | "高級"; minutes: number; summary: string }
export const METHODOLOGY_DOCS: MethodologyDoc[] = [
  { id: "costar-rag", title: "CO-STAR × RAG 雙引擎入門", category: "生成技術", difficulty: "入門", minutes: 12, summary: "用 CO-STAR 結構化提示 + RAG 檢索增強，讓導演 AI 回覆既有結構又有依據。" },
  { id: "confirm-gate", title: "確認門與來源分級實務", category: "創作流程", difficulty: "進階", minutes: 10, summary: "破壞性 / 高成本動作先確認；來源分 precise / estimate / unconfirmed 三級。" },
  { id: "shot-pipeline", title: "鏡號 S0X 管線", category: "創作流程", difficulty: "進階", minutes: 8, summary: "以鏡號 S01.. 為唯一主鍵串世界觀→腳本→分鏡→生成→成片。" },
  { id: "cost-ladder", title: "成本階梯與 Context Packet", category: "生成技術", difficulty: "高級", minutes: 14, summary: "Deterministic→Cache→RAG→便宜 LLM→Sonar→高級 LLM→媒體生成；長文只進 RAG。" },
  { id: "six-agents", title: "六代理層分工", category: "入門指南", difficulty: "入門", minutes: 9, summary: "導演 / 總指揮 / Context Packet / 研究 / 感知 / 財財，各司其職。" },
  { id: "lora-lock", title: "LoRA 角色定版與四鎖", category: "模型說明", difficulty: "高級", minutes: 11, summary: "角色 LoRA 訓練 + 鎖臉/髮/裝/配件，跨鏡保持一致。" },
];

/** learn 文件分類（對映盤點 §3-11：80 篇 6 分類）。難度三級供篩選。 */
export const LEARN_CATEGORIES = [
  { key: "all", label: "全部", count: 80 },
  { key: "getting-started", label: "入門指南", count: 21 },
  { key: "model-guide", label: "模型說明", count: 9 },
  { key: "generation", label: "生成技術", count: 13 },
  { key: "workflow", label: "創作流程", count: 12 },
  { key: "api-docs", label: "API 文件", count: 20 },
  { key: "ai-news", label: "AI 新聞", count: 5 },
] as const;

export const LEARN_DIFFICULTIES = ["入門", "進階", "高級"] as const;
