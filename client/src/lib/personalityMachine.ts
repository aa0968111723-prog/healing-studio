/**
 * personalityMachine.ts — XState 5 人格狀態機 (Phase 10)
 *
 * 白皮書規格：
 *   三種人格 × 三種 AI 狀態 = 9 種視覺表現組合
 *
 * 人格自動切換規則（DirectorEngine）：
 *   ┌─────────────────────────────────────────────────────┐
 *   │  閒置 > 10s          → calm                         │
 *   │  打字 WPM > 60       → creative                     │
 *   │  操作進階參數        → technical                    │
 *   │  生成中              → AI state = generating        │
 *   │  思考中              → AI state = thinking          │
 *   │  手動覆蓋            → manual mode (鎖定人格)       │
 *   │  失敗次數 >= 3       → calm (降壓模式)              │
 *   └─────────────────────────────────────────────────────┘
 */

import { createMachine, assign } from "xstate";
import type { Personality } from "@/components/VisualSoul";

// ─── 事件類型 ──────────────────────────────────────────────────────────────

export type PersonalityEvent =
  | { type: "TYPING"; wpm: number }
  | { type: "IDLE" }
  | { type: "ADVANCED_PARAMS" }
  | { type: "GENERATION_START" }
  | { type: "GENERATION_DONE" }
  | { type: "GENERATION_FAIL" }
  | { type: "THINKING_START" }
  | { type: "THINKING_DONE" }
  | { type: "MANUAL_SET"; personality: Personality }
  | { type: "MANUAL_RESET" };

// ─── Context ───────────────────────────────────────────────────────────────

export interface PersonalityMachineContext {
  personality: Personality;
  isManual: boolean;
  failCount: number;
  lastTypingWpm: number;
}

// ─── 狀態節點 ──────────────────────────────────────────────────────────────
// 頂層狀態：auto（自動模式）| manual（手動覆蓋）
// auto 子狀態：calm | creative | technical
// 跨狀態觸發的 aiState 由 Context 記錄（不需要獨立狀態節點）

export const personalityMachine = createMachine(
  {
    id: "personality",
    types: {} as {
      context: PersonalityMachineContext;
      events: PersonalityEvent;
    },
    initial: "auto",
    context: {
      personality: "calm",
      isManual: false,
      failCount: 0,
      lastTypingWpm: 0,
    },

    // ── 全域事件（任何狀態都可觸發）────────────────────────────────────────
    on: {
      MANUAL_SET: {
        target: ".manual",
        actions: assign({
          personality: ({ event }) => event.personality,
          isManual: () => true,
        }),
      },
      MANUAL_RESET: {
        target: ".auto.calm",
        actions: assign({
          isManual: () => false,
          failCount: () => 0,
        }),
      },
    },

    states: {
      // ── 自動模式 ──────────────────────────────────────────────────────────
      auto: {
        initial: "calm",
        states: {
          calm: {
            entry: assign({ personality: () => "calm" as Personality }),
            on: {
              TYPING: [
                {
                  // WPM > 60 → creative
                  guard: ({ event }) => event.wpm > 60,
                  target: "creative",
                  actions: assign({
                    lastTypingWpm: ({ event }) => event.wpm,
                  }),
                },
              ],
              ADVANCED_PARAMS: { target: "technical" },
              GENERATION_START: {
                actions: assign({ personality: () => "creative" as Personality }),
              },
              GENERATION_FAIL: {
                actions: assign({
                  failCount: ({ context }) => context.failCount + 1,
                }),
              },
            },
          },

          creative: {
            entry: assign({ personality: () => "creative" as Personality }),
            on: {
              IDLE: { target: "calm" },
              ADVANCED_PARAMS: { target: "technical" },
              GENERATION_FAIL: [
                {
                  // 失敗 >= 3 次 → calm（降壓）
                  guard: ({ context }) => context.failCount + 1 >= 3,
                  target: "calm",
                  actions: assign({
                    failCount: () => 0,
                  }),
                },
                {
                  actions: assign({
                    failCount: ({ context }) => context.failCount + 1,
                  }),
                },
              ],
              GENERATION_DONE: {
                actions: assign({ failCount: () => 0 }),
              },
            },
          },

          technical: {
            entry: assign({ personality: () => "technical" as Personality }),
            on: {
              IDLE: { target: "calm" },
              TYPING: [
                {
                  guard: ({ event }) => event.wpm > 60,
                  target: "creative",
                },
              ],
            },
          },
        },
      },

      // ── 手動模式（鎖定人格，忽略自動觸發）────────────────────────────────
      manual: {
        entry: assign({ isManual: () => true }),
        on: {
          // 保留 GENERATION / THINKING 事件以更新 context
          GENERATION_START: {
            actions: assign({ failCount: ({ context }) => context.failCount }),
          },
        },
      },
    },
  }
);

export type PersonalityMachineState = typeof personalityMachine;
