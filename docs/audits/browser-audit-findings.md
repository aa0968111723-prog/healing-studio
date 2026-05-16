# Browser Live Audit Findings

## Homepage

- Brand: "AI Director" correctly displayed in nav and hero
- VisualSoul orb is visible but VERY SMALL (only ~20px), lacks 3D cute character feel
- PDF requires a 3D cute orb character with face/personality (like the mascot images in PDF page 4)
- Feature cards are present (6 cards matching PDF requirements)
- No "新手導覽" persistent entry point for returning users

## Studio Page

- Sidebar brand: "AI Director" ✓
- Navigation items match PDF requirements
- Mode switch: Only "閃電模式" toggle exists, no explicit "Pro/快速模式" label as PDF requires
- VisualSoul orb NOT visible in Studio sidebar (should be persistent)
- No proactive intervention from the orb (no typing detection, no idle detection)
- ThoughtIslandChain only appears after generation, not as a persistent panel
- No "新手導覽：讓 AI Director 帶我開始" button in Studio

## Key Visual Gaps

1. VisualSoul is CSS-based, not Three.js + GLSL as PDF requests
2. No personality-based color switching (Calm=blue, Creative=orange, Technical=purple) on the orb
3. No DirectorEngine state machine for automatic personality switching
4. Orb doesn't react to user behavior (typing speed, idle time, fail count)
