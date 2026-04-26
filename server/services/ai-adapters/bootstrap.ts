import { registerAdapter } from "./registry";
import { FalAdapter } from "./providers/fal.adapter";
import { GeminiAdapter } from "./providers/gemini.adapter";
import { ElevenLabsAdapter } from "./providers/elevenlabs.adapter";
import { SunoAdapter } from "./providers/suno.adapter";
import { KlingAdapter } from "./providers/kling.adapter";
import { RunwayAdapter } from "./providers/runway.adapter";
import { ReplicateAdapter } from "./providers/replicate.adapter";
import { OpenAIAdapter } from "./providers/openai.adapter";

let bootstrapped = false;

export function bootstrapAiAdapters(): void {
  if (bootstrapped) return;

  // ── 核心 Providers（始終註冊，缺 key 時 proxy() 呼叫才丟錯，不影響啟動）──
  registerAdapter(new FalAdapter());
  registerAdapter(new GeminiAdapter());
  registerAdapter(new ElevenLabsAdapter());
  registerAdapter(new SunoAdapter());

  // ── 影片 Providers（直連，繞過 fal.ai 代理，啟用獨立 Health Check）─────────
  registerAdapter(new KlingAdapter());
  registerAdapter(new RunwayAdapter());

  // ── 通用模型平台 ──────────────────────────────────────────────────────────
  registerAdapter(new ReplicateAdapter());

  // ── 語言 / 多模態 Provider ────────────────────────────────────────────────
  registerAdapter(new OpenAIAdapter());

  bootstrapped = true;
}
