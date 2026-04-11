// server/services/imageCompiler.ts
// Flux.1 Dual-Encoder Prompt Compiler (CLIP-L + T5-XXL)
// Follows SSLCM structure: Subject, Style, Lighting, Color, Motion/Composition

import { ENV } from "../_core/env";

export interface BlockInput {
    subject?: string;      // S - Subject (main character/object)
  style?: string;        // S - Style (art style, mood)
  lighting?: string;     // L - Lighting
  color?: string;        // C - Color palette
  composition?: string;  // M - Motion/Composition
  negativeHints?: string[]; // Will be converted to positive constraints
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
    guidanceScale?: number; // AI Faithfulness (1-20, default 3.5)
  numSteps?: number;      // Detail Level (10-50, default 28)
  seed?: number;
}

export interface CompiledImagePayload {
    clipLPrompt: string;    // First 77 tokens - style, lighting, vibe
  t5Prompt: string;       // Full narrative - subject, composition
  mergedPrompt: string;   // Combined for API call
  falPayload: Record<string, unknown>;
    metadata: {
      blockStructure: BlockInput;
      visualWeight: number;
      compiledAt: string;
    };
}

// Positive anatomy constraints (replaces negative prompts per Flux guidance-distillation)
const POSITIVE_ANATOMY_CONSTRAINTS = [
    "perfectly symmetrical anatomy",
    "flawless proportions",
    "natural pose",
    "sharp focus",
    "hyper-detailed",
    "8k resolution",
    "professional photography",
  ].join(", ");

// Style keyword mappings for CLIP-L optimization
const STYLE_CLIP_MAP: Record<string, string> = {
    cyberpunk: "neon-drenched cyberpunk aesthetic, electric glow, dark futuristic cityscape",
    lofi: "lo-fi aesthetic, warm grain, cozy atmospheric, soft pastels",
    anime: "anime illustration style, clean linework, vibrant cel-shaded",
    realistic: "photorealistic, hyperrealistic, film photography, 35mm",
    watercolor: "delicate watercolor painting, soft brushstrokes, paper texture",
    ink: "traditional ink painting, zen minimalism, black brush strokes",
};

/**
 * Compiles SSLCM block structure into dual-encoder optimized prompt
 * CLIP-L segment: Lighting + Color + Style (vibe-sensitive) -> first 77 tokens
 * T5-XXL segment: Subject + Composition + detailed narrative
 */
export function compileImagePrompt(blocks: BlockInput): CompiledImagePayload {
    // -- CLIP-L Segment (first, vibe-critical) ----------------------
  const clipLParts: string[] = [];

  // 1. Style (expanded via STYLE_CLIP_MAP for CLIP-L sensitivity)
  if (blocks.style) {
        const expandedStyle = STYLE_CLIP_MAP[blocks.style.toLowerCase()] || blocks.style;
        clipLParts.push(expandedStyle);
  }

  // 2. Lighting (CLIP-L most sensitive to atmospheric lighting)
  if (blocks.lighting) {
        clipLParts.push(`${blocks.lighting} lighting`);
  }

  // 3. Color palette
  if (blocks.color) {
        clipLParts.push(`${blocks.color} color palette`);
  }

  // 4. Positive anatomy (guidance-distillation, replaces negative prompts)
  clipLParts.push(POSITIVE_ANATOMY_CONSTRAINTS);

  const clipLPrompt = clipLParts.join(", ");

  // -- T5-XXL Segment (wide NLP understanding, up to 512 tokens) --
  const t5Parts: string[] = [];

  // Subject with spatial/relational context (T5 handles complex relationships)
  if (blocks.subject) {
        t5Parts.push(blocks.subject);
  }

  // Composition/spatial relationships (T5 excels at this)
  if (blocks.composition) {
        t5Parts.push(blocks.composition);
  }

  // Convert negative hints to positive constraints (Flux best practice)
  if (blocks.negativeHints && blocks.negativeHints.length > 0) {
        const positiveConversions = blocks.negativeHints.map(hint => {
                // Convert "blurry" -> "sharp", "ugly" -> "beautiful", etc.
                                                                   const conversions: Record<string, string> = {
                                                                             blurry: "tack-sharp focus, crisp details",
                                                                             ugly: "beautiful, aesthetically pleasing",
                                                                             distorted: "perfect anatomy, natural proportions",
                                                                             low_quality: "ultra-high quality, masterpiece",
                                                                             dark: "well-lit, proper exposure",
                                                                   };
                return conversions[hint.toLowerCase()] || `no ${hint}`;
        });
        t5Parts.push(positiveConversions.join(", "));
  }

  const t5Prompt = t5Parts.join(". ");
    const mergedPrompt = [clipLPrompt, t5Prompt].filter(Boolean).join(". ");

  // -- Fal.ai Payload Assembly ------------------------------------
  const falPayload: Record<string, unknown> = {
        prompt: mergedPrompt,
        image_size: aspectRatioToSize(blocks.aspectRatio || "1:1"),
        num_inference_steps: blocks.numSteps || 28,
        guidance_scale: blocks.guidanceScale || 3.5,
        enable_safety_checker: true,
        ...(blocks.seed !== undefined && { seed: blocks.seed }),
  };

  // Visual weight calculation for reference image influence
  const visualWeight = calculateVisualWeight(blocks);

  return {
        clipLPrompt,
        t5Prompt,
        mergedPrompt,
        falPayload,
        metadata: {
                blockStructure: blocks,
                visualWeight,
                compiledAt: new Date().toISOString(),
        },
  };
}

/**
 * Execute image generation via Fal.ai Flux model
 */
export async function generateFluxImage(
    blocks: BlockInput,
    modelVariant: "flux/dev" | "flux/schnell" = "flux/dev"
  ): Promise<{ url: string; compiledPayload: CompiledImagePayload }> {
    const compiled = compileImagePrompt(blocks);

  if (!ENV.falKey) {
        console.warn("[ImageCompiler] FAL_KEY not set, returning simulated output");
        return {
                url: `https://picsum.photos/seed/${Date.now()}/1024/1024`,
                compiledPayload: compiled,
        };
  }

  try {
        const modelId = `fal-ai/${modelVariant}`;
        const response = await fetch(`https://queue.fal.run/${modelId}`, {
                method: "POST",
                headers: {
                          Authorization: `Key ${ENV.falKey}`,
                          "Content-Type": "application/json",
                },
                body: JSON.stringify(compiled.falPayload),
        });

      if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`Fal.ai Flux error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as {
              images?: Array<{ url: string }>;
              image?: { url: string };
              url?: string;
      };

      const imageUrl =
              result.images?.[0]?.url ||
              result.image?.url ||
              result.url ||
              compiled.falPayload.prompt as string;

      return { url: imageUrl, compiledPayload: compiled };
  } catch (error) {
        console.error("[ImageCompiler] Flux generation failed:", error);
        throw error;
  }
}

// -- Helpers --------------------------------------------------------
function aspectRatioToSize(ratio: string): string {
    const sizeMap: Record<string, string> = {
          "1:1": "square_hd",
          "16:9": "landscape_16_9",
          "9:16": "portrait_16_9",
          "4:3": "landscape_4_3",
          "3:4": "portrait_4_3",
    };
    return sizeMap[ratio] || "square_hd";
}

function calculateVisualWeight(blocks: BlockInput): number {
    let weight = 0;
    if (blocks.style) weight += 0.3;
    if (blocks.lighting) weight += 0.2;
    if (blocks.color) weight += 0.2;
    if (blocks.composition) weight += 0.2;
    if (blocks.subject) weight += 0.1;
    return Math.min(weight, 1.0);
}
