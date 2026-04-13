# AI Director 7-Persona Comprehensive Quality Audit

## Audit Date: 2026-03-17
## Audit Scope: Full platform — Onboarding → Studio → Vault → History → Cross-modal → Export

---

## Persona Roster

| # | Persona | Focus Area |
|---|---------|------------|
| 1 | Beginner (小白) | Onboarding flow, Choice Chips, first-time UX |
| 2 | Developer (阿強) | D3.js ThoughtIslandChain, real CoT JSON, code quality |
| 3 | Expert (艾導) | Drawer integration, parameter injection, Vault workflow |
| 4 | Busy User (忙哥) | Cross-modal speed, parameter inheritance, ZIP export |
| 5 | GenAI Expert (Odin) | Prompt evolution, CoT authenticity, SD/MJ syntax |
| 6 | UI Observer (美美) | Animation fluidity, responsive design, visual hierarchy |
| 7 | Director (導演) | End-to-end workflow, script→generation→export pipeline |

---

## Critical Issues Found

### ISSUE-01: ThoughtChain is post-hoc summary, not real CoT [GenAI Expert]
- **Severity**: HIGH
- **File**: `server/routers.ts:505-512`
- **Problem**: `thoughtChain` array is constructed AFTER all steps complete with hardcoded relative timestamps (`Date.now() - 4000` etc). It's a summary, not real-time reasoning.
- **Fix**: Capture actual timestamps and real output from each step (safety result, compiled prompt length, visual weight) during execution. Already partially done — the detail strings contain real data (`compiledPrompt.length`, `visualWeight`). Need to record actual timestamps at each step.

### ISSUE-02: Cross-modal parameter inheritance is incomplete [GenAI Expert + Busy User]
- **Severity**: HIGH
- **File**: `client/src/pages/HistoryPage.tsx:384-433`, `Studio.tsx:294-314`
- **Problem**: "Send to Video/Audio" from History only passes `prompt` + `generationType`. Does NOT carry Seed, temperature, vibeCardIds, or modality-specific params. Studio's `handleHistoryToStudio` also only sets prompt + modality.
- **Fix**: Include `parameterSnapshot` from history entry in sessionStorage payload, and restore it in Studio.

### ISSUE-03: ZIP export is a placeholder [Busy User + Director]
- **Severity**: HIGH
- **File**: `client/src/pages/Studio.tsx:648`
- **Problem**: Shows `toast.info("ZIP 匯出功能即將推出")` — dead button.
- **Fix**: Implement JSZip-based export that packages resultUrl assets.

### ISSUE-04: OnboardingFlow lacks Choice Chips suggestions [Beginner]
- **Severity**: MEDIUM
- **File**: `client/src/components/OnboardingFlow.tsx:224-265`
- **Problem**: Input phase is a plain text field with no AI-powered suggestions. User requirement specifically asks for Choice Chips when input is partial.
- **Fix**: Add debounced suggestion call that returns clickable chips below the input.

### ISSUE-05: evaluatePrompt suggestions not surfaced as Choice Chips [GenAI Expert]
- **Severity**: MEDIUM
- **File**: `client/src/components/PromptStrengthBar.tsx`
- **Problem**: `evaluatePrompt` returns `suggestions[]` and `optimizedPrompt`, which are displayed as text. They should also be actionable as one-click Choice Chips that auto-apply.
- **Status**: Partially addressed — the "套用" button exists for optimizedPrompt. Suggestions are text-only.

### ISSUE-06: ThoughtChain placeholder nodes during generation [Developer]
- **Severity**: LOW
- **File**: `client/src/pages/Studio.tsx:598-602`
- **Problem**: During generation (before response), shows 3 hardcoded placeholder nodes. After response, replaces with post-hoc chain. The transition is abrupt.
- **Status**: Acceptable UX pattern — placeholder → real data is standard.

---

## What's Working Well

| Feature | Status | Persona Verified |
|---------|--------|-----------------|
| VisualSoul orb 3 states (idle/thinking/generating) | Real-time via AIStateContext | UI Observer |
| D3.js ThoughtIslandChain rendering | Correct D3 SVG with animations | Developer |
| evaluatePrompt LLM-as-a-Judge | Real LLM call, 5 dimensions, suggestions | GenAI Expert |
| Personality system (calm/creative/technical) | 3 distinct system prompts | GenAI Expert |
| Unified Studio workspace with drawers | Left (Vault+Assets) + Right (History) | Expert |
| Sidebar reduced to 6 entries | Clean navigation | UI Observer |
| Onboarding typewriter + orb animation | Smooth framer-motion | Beginner |
| Real quota deduction + refund on failure | Transactional integrity | Developer |
| Safety moderation via LLM | Pre-generation content check | Director |
| compileElitePrompt with visual weights | Real LLM compilation + ControlNet params | GenAI Expert |

---

## Action Items (Priority Order)

1. **Fix cross-modal parameter inheritance** (ISSUE-02) — carry full parameterSnapshot
2. **Implement ZIP export** (ISSUE-03) — JSZip packaging
3. **Enrich ThoughtChain with real timestamps** (ISSUE-01) — capture step-by-step timing
4. **Add Choice Chips to OnboardingFlow** (ISSUE-04) — LLM-powered suggestions
5. **Make evaluatePrompt suggestions clickable** (ISSUE-05) — one-click apply
