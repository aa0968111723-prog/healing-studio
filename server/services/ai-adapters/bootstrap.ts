import { registerAdapter } from "./registry";
import { FalAdapter } from "./providers/fal.adapter";
import { GeminiAdapter } from "./providers/gemini.adapter";
import { ElevenLabsAdapter } from "./providers/elevenlabs.adapter";
import { SunoAdapter } from "./providers/suno.adapter";

let bootstrapped = false;

export function bootstrapAiAdapters(): void {
  if (bootstrapped) return;
  registerAdapter(new FalAdapter());
  registerAdapter(new GeminiAdapter());
  registerAdapter(new ElevenLabsAdapter());
  registerAdapter(new SunoAdapter());
  bootstrapped = true;
}
