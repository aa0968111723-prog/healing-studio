# Light Orb System Analysis

## Components
1. **VisualSoul.tsx** - Core orb visual (3D rotating sphere with particles, personality-aware colors)
2. **VisualSoulInvitation.tsx** - Floating orb + OARS bubble invitation system on Home page
3. **AIStateContext.tsx** - Global AI state (idle/thinking/generating) + personality + proactive rules
4. **DirectorAI.tsx** - AI Director chat page with CO-STAR framework
5. **useSenseEngine.ts** - Micro-behavior tracking (cardDwell, scrollHesitation, hoverIntent, clickAbort, rapidScan)
6. **useIntentInference.ts** - Intent inference trigger (calls sense.inferIntent tRPC)

## Current Issues to Fix

### 1. Light Orb Guidance Enhancement
- OARS invitation only triggers on Home page, not in Studio/Director
- Proactive rules in AIStateContext are basic (30s idle, fast typing, 2 failures)
- No emotional warmth transitions (orb doesn't respond to user mood)
- No greeting on first visit or return visit
- Invitation templates are good but trigger conditions are too strict (minEvents=5, minSessionMs=30000)
- Missing: gentle nudge when user is on Studio page staring at empty canvas

### 2. AI Agent Connection Page (DirectorAI) Issues
- Personality selector doesn't sync back to global AIStateContext
- Proactive question bubble works but no visual connection to light orb
- No smooth transition from Home orb invitation → Director AI page
- "發送到工作室" button works but no feedback on Studio page about source
- Missing: orb visual in chat area showing AI thinking state
- Storyboard panel labels show "Veo 3.1" and "Suno V5" (incorrect version names)
