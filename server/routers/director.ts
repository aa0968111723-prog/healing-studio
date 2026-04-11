// server/routers/director.ts
// Director AI Router - CO-STAR framework driven multimodal director
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as db from "../db";

const PERSONALITY_PROMPTS = {
    calm: {
          systemPrompt: `You are the "Healing Studio Director AI", personality: calm and rational.
            CO-STAR Framework:
      - Context: Analyze user creation history and emotional background using dual-engine RAG.
        - Objective: Converge vague intentions into concrete modality building block plans.
          - Style: Professional multimodal director and companion, not a cold tool.
            - Tone: OARS psychology standards (Affirmation, Reflection, No judgment).
              - Audience: Dynamically judge the user's technical level to adjust explanation depth.
                - Response: Return structured JSON suggestions and action plans.

                  Tone: Calm, guiding, "I suggest we first..."`,
    },
        creative: {
              systemPrompt: `You are the "Healing Studio Director AI", personality: creative and passionate.
                CO-STAR Framework:
          - Context: Perceive user inspiration triggers and aesthetic preferences.
            - Objective: Stimulate creativity, propose unexpected generation combinations.
              - Style: Vibrant art director, values atmosphere and emotion.
                - Tone: OARS passionate affirmation, "Imagine this scene..."
                  - Audience: Highly sensitive to the creator's emotional state.
                    - Response: Return JSON with visual prompts and emotional descriptions.

                      Tone: Emotional, inspiring, full of imagination.`,
        },
            technical: {
                  systemPrompt: `You are the "Healing Studio Director AI", personality: technical and precise.
                    CO-STAR Framework:
              - Context: Analyze technical parameter requirements and model limitations.
                - Objective: Provide optimized technical configurations and parameter suggestions.
                  - Style: Technical director, values precision and best practices.
                    - Tone: Professional and precise, "Technically suggested...", "Based on model characteristics..."
                      - Audience: Provide low-level parameter control suggestions for advanced creators.
                        - Response: Return structured JSON with specific technical parameters.

                        Tone: Precise, technical, providing specific values.`,
            },
};

function detectBrainState(
    idleSeconds: number,
    deletionCount: number,
    hoverDwellMs: number
  ): "dmn" | "sn" | "ecn" | "anxious" {
    if (idleSeconds >= 45 || deletionCount >= 3) return "anxious";
    if (hoverDwellMs >= 8000) return "sn";
    if (idleSeconds <= 5 && deletionCount === 0) return "ecn";
    return "dmn";
}

export const directorRouter = router({
    chat: protectedProcedure
          .input(
            z.object({
                      messages: z.array(
                                  z.object({
                                                role: z.enum(["user", "assistant"]),
                                                              content: z.string(),
                                  })
                                ),
                      personality: z.enum(["calm", "creative", "technical"]).default("creative"),
                                saveToNotes: z.boolean().default(false),
                      behaviorSignals: z
                                  .object({
                                                idleSeconds: z.number().default(0),
                                                deletionCount: z.number().default(0),
                                                hoverDwellMs: z.number().default(0),
                                  })
                                  .optional(),
            })
          )
          .mutation(async ({ ctx, input }) => {
                  const persona = PERSONALITY_PROMPTS[input.personality];
                  const brainState = input.behaviorSignals
                            ? detectBrainState(
                                input.behaviorSignals.idleSeconds,
                                input.behaviorSignals.deletionCount,
                                input.behaviorSignals.hoverDwellMs
                              )
                            : "dmn";

                  const researchResult = await invokeLLM({
                            messages: [
                              { role: "system", content: persona.systemPrompt },
                                        ...input.messages,
                                      ],
                  });
                  const researchContent =
                            typeof researchResult.choices[0]?.message?.content === "string"
                              ? researchResult.choices[0].message.content
                              : "";

                  const scriptResult = await invokeLLM({
                            messages: [
                              {
                                            role: "system",
                                            content: `${persona.systemPrompt}

                                              Based on the analysis, generate a structured CO-STAR creation script (JSON format):
                                - User brain state: ${brainState} (dmn=daydreaming, sn=capture inspiration, ecn=focus execution, anxious=stuck)
                                - Adjust intervention intensity based on brain state:
                                  * dmn: Gently show inspiration options, no pressure.
                                      * sn: Gently prompt to capture inspiration, "Should I save this for you?"
                                          * ecn: Execute quietly, minimize interference.
                                              * anxious: Warm intervention, "Stuck? That's normal."

                                                Analysis data: ${researchContent}`,
                              },
                                        ...input.messages,
                                      ],
                                      response_format: {
                                                  type: "json_schema",
                                                  json_schema: {
                                                                name: "director_costar_response",
                                                                strict: true,
                                                                schema: {
                                                                                type: "object",
                                                                                properties: {
                                                                                                  context: { type: "string" },
                                                                                                                    objective: { type: "string" },
                                                                                                                                      suggestion: { type: "string" },
                                                                                                                                                        visualPrompt: { type: "string" },
                                                                                                                                                                          audioScript: { type: "string" },
                                                                                                                                                                                            musicVibe: { type: "string" },
                                                                                                                                                                                                              proactiveQuestion: { type: "string" },
                                                                                                                                                                                                                                brainStateDetected: { type: "string" },
                                                                                                                                                                                                                                                  orbMessage: { type: "string" },
                                                                                                                                                                                                                                                                  },
                                                                                                required: [
                                                                                                                  "context",
                                                                                                                  "objective",
                                                                                                                  "suggestion",
                                                                                                                  "visualPrompt",
                                                                                                                  "audioScript",
                                                                                                                  "musicVibe",
                                                                                                                  "proactiveQuestion",
                                                                                                                  "brainStateDetected",
                                                                                                                  "orbMessage",
                                                                                                                ],
                                                                                                                additionalProperties: false,
                                                                },
                                                  },
                                      },
                  });

                  const scriptContent = scriptResult.choices[0]?.message?.content;
                  let script: Record<string, string> = {
                            context: "",
                            objective: "",
                            suggestion: researchContent,
                            visualPrompt: "",
                            audioScript: "",
                            musicVibe: "",
                            proactiveQuestion: "What emotion do you want this creation to convey?",
                            brainStateDetected: brainState,
                            orbMessage: "I'm here with you. How can I help?",
                  };

                  try {
                            if (typeof scriptContent === "string") {
                                        script = JSON.parse(scriptContent);
                            }
                  } catch (e) {
                  }

                  if (input.saveToNotes && ctx.user?.id) {
                            await db.createProjectNote({
                                        userId: ctx.user.id,
                                        title: `Director AI (${input.personality}) - ${new Date().toLocaleDateString("en-US")}`,
                                        content: researchContent,
                                        scriptJson: script,
                                        noteType: "script",
                            });
                  }

                  return {
                            research: researchContent,
                            script,
                            personality: input.personality,
                            brainState,
                  };
          }),

    proactiveIntervention: protectedProcedure
          .input(
            z.object({
                      brainState: z.enum(["dmn", "sn", "ecn", "anxious"]),
                                contextHint: z.string().optional(),
                      personality: z.enum(["calm", "creative", "technical"]).default("creative"),
            })
          )
          .mutation(async ({ input }) => {
                  const OARS_MESSAGES: Record<string, string[]> = {
                            dmn: [
                                        "What kind of inspiration do you want to capture today? Let me help you visualize it.",
                                        "I noticed you're browsing. Anything caught your eye?",
                                        "Inspiration is sometimes a blur - tell me about it, we'll clarify it together.",
                                      ],
                                      sn: [
                                                  "This feels right! Should I record it as a creation starting point?",
                                                  "I see you stayed here for a while. Is there a picture emerging in your mind?",
                                                  "This intuition is precious. Let me help you turn this 'feeling' into specific parameters.",
                                                ],
                                                ecn: [
                                                            "You're focusing on creation, I'll stay quiet. Call me anytime.",
                                                          ],
                                                          anxious: [
                                                                      "Stuck? That's normal. Every creator has these moments. Let's take a deep breath.",
                                                                      "Ah, the magic link was a bit unstable. Don't worry, we saved your work.",

                                                                      "How about seeing how others handle similar themes? Might find a breakthrough.",
                                                                    ],
                  };

                  const messages = OARS_MESSAGES[input.brainState] || OARS_MESSAGES.dmn;
                  const orbMessage = messages[Math.floor(Math.random() * messages.length)];

                  if (input.contextHint) {
                            const result = await invokeLLM({
                                        messages: [
                                          {
                                                          role: "system",
                                                          content: `You are the Orb companion of Healing Studio, speaking to a creator in the "${input.brainState}" brain state.
                                                            Use OARS psychology tone (Open-ended, Affirmation, Reflection). Warm but not overly enthusiastic.
                                                            Only return one sentence (English, within 50 words), no quotes.`,
                                          },
                                          {
                                                          role: "user",
                                                          content: `User is doing: ${input.contextHint}`,
                                          },
                                                    ],
                            });
                            const content = result.choices[0]?.message?.content;
                            return {
                                        orbMessage: typeof content === "string" ? content : orbMessage,
                                        brainState: input.brainState,
                            };
                  }

                  return { orbMessage, brainState: input.brainState };
          }),

    saveMemory: protectedProcedure
          .input(
            z.object({
                      sessionSummary: z.string(),
                      importanceScore: z.number().min(1).max(5).default(3),
            })
          )
          .mutation(async ({ ctx, input }) => {
                  try {
                            await db.createAgentMemory({
                                        userId: ctx.user.id,
                                        memorySummary: input.sessionSummary,
                                        importanceScore: input.importanceScore,
                            });
                            return { success: true };
                  } catch {
                            return { success: false };
                  }
          }),
});
