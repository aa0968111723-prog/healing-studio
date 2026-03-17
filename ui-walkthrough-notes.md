# UI Walkthrough Notes - Phase 6

## Step 1: Homepage / Onboarding
- Page loads with beautiful gradient background (warm peach → lavender → blue)
- Light orb animation visible at center
- Text: "你好！我是你的 AI 創作夥伴。"
- "跳過引導" button visible top-right
- Onboarding flow is active and showing initial greeting
- Status: PASS - Orb + greeting visible

## Step 2: Onboarding Input Phase
- Question: "今天想創作什麼畫面？"
- Input field with placeholder: "例如：星空下的森林小屋、海邊的日落..."
- 6 Choice Chips visible: 星空下的森林小屋, 海邊的金色日落, 未來城市的霓虹街道, 雪山上的孤獨旅人, 水彩風格的花園, 賽博龐克的東京夜景
- Footer text: "按 Enter 或點擊箭頭開始創作"
- Light orb still visible and animated
- Status: PASS - Choice Chips working, input ready

## Step 3: Choice Chip Click
- Clicked "星空下的森林小屋" chip
- Input field populated with "星空下的森林小屋"
- Status text: "AI 正在分析選項..." (LLM evaluating the prompt)
- Orb animation still active
- Submit arrow button visible
- Status: PASS - Choice Chip fills input, AI analysis triggered

## Step 4: Onboarding Generation In Progress
- Text: "AI 正在為「星空下的森林小屋」構思..."
- Orb turned orange/warm with green core (active state)
- ThoughtIslandChain visible: "AI 思維島鏈 (2/3 節點完成)"
- Three nodes: 安全檢查 (✓ green), 提示詞編譯 (blue active), AI 生成 (gray pending)
- Legend: ○ 安全檢查, ◉ 提示詞編譯, ⊙ AI 生成
- Footer: "請稍候，AI 正在創作中..."
- Status: PASS - ThoughtChain visualization working correctly

## Step 5: Onboarding Generation Complete
- Title: "你的第一件作品完成了！"
- Subtitle: "這就是 AI Director 的魔法"
- Generated image: Beautiful starry sky with a forest cabin, warm light from windows, reflected in water
- ThoughtIslandChain: "AI 思維島鏈 (6/6 節點完成)"
- All 6 nodes visible: 安全檢查, 提示詞編譯, 視覺權重計算, 圖像生成, 配額扣除, 歷史紀錄
- All nodes show green/completed status
- CTA button: "進入完整工作室"
- Orb changed to blue/calm state
- Status: PASS - Full generation pipeline working, ThoughtChain shows all 6 real steps

## Step 6: Studio Page - Full Workspace
- Sidebar: AI Director, 創作工作室, 導演 AI, 角色鍛造所, 共享空間, 儀表板, 個人設定, 管理後台
- User info: ruce B, aa0968111723@gmail.com, 剩餘配額 24
- Modality tabs: 圖片, 影片, 音樂, 語音
- Prompt area with textarea
- 8 Vibe chips: 寧靜, 溫暖, 夢幻, 自然, 復古, 極簡, 歡愉, 神秘
- Advanced prompt builder (expandable)
- Aspect ratio: 1:1, 16:9 (selected), 9:16, 4:3, 3:2, 21:9
- Reference images: Style + Vibe upload areas
- Negative prompt textarea
- Right panel: 閃電模式 (Gemini Flash), 創意溫度 0.50, 種子碼
- Top-right: 素材庫, 歷史 buttons
- "開始創作" CTA button
- Status: PASS - Full workspace with all controls visible

## Step 7: Prompt Input and PromptStrengthBar
- Typed prompt: "一隻金色的貓咪坐在窗台上，窗外是下雨的城市街道，霓虹燈倒映在濕漉漉的路面上"
- PromptStrengthBar activated: "分析中..." with loading indicator
- Status: PASS - Auto-evaluation triggered on prompt input

## Step 8: PromptStrengthBar Evaluation Complete
- Score circle: 72 (green ring)
- Label: "提示詞強度：良好"
- Detail text: "提示詞清楚地描述了主要物體（金色貓咪）及其位置，並具體描繪了窗外的雨夜城市景觀，包含霓虹燈倒映..."
- Expand button and "評估" re-evaluate button visible
- Status: PASS - LLM-as-a-Judge evaluation working with real score and feedback

## Step 9: PromptStrengthBar Expanded Details
- Score: 72 (良好)
- Five dimensions visible with animated bars:
  - 主題清晰度: 15
  - 動作與敘事: 12
  - 環境與場景: 16
  - 光影與色調: 15
  - 技術參數: 14
- Weaknesses: "提示詞在貓咪的具體動作、情緒表達上較為簡略，且缺乏對整體畫風、攝影技術參數的明確指示..."
- 3 clickable suggestion chips (ISSUE-05 FIX VERIFIED):
  1. "增加貓咪的具體姿態或情緒描述，例如「慵懶地蜷縮著」或「好奇地望向窗外」。"
  2. "加入更多光影細節，如「窗戶透進的微弱室內光」或「霓虹燈的色彩斑斕」。"
  3. "補充藝術風格或攝影參數，例如「超現實主義」、「電影感」或「高解析度、廣角鏡頭」。"
- AI Optimized Version: "A golden cat sitting gracefully on a windowsill, looking out at a rainy city street at night. Neon lights reflect vividly on the wet pavement. The scene is illuminated by the soft glow from inside the room and the vibrant, colorful neon signs outside. Cinematic shot, wide-angle lens, high resolution, moody atmosphere."
- "套用" button to apply optimized version
- Status: PASS - Full 5-dimension evaluation, clickable suggestions, optimized prompt all working

## Step 10: Studio Generation Complete
- ThoughtIslandChain: "AI 思維島鏈 (6/6 節點完成)" - all 6 nodes green
- Nodes: 安全檢查, 提示詞編譯, 視覺權重計算, 圖像生成, 配額扣除, 歷史紀錄
- Generated image: Beautiful golden/orange tabby cat on windowsill, rain on window, neon lights visible
- Image matches prompt perfectly
- "匯出 ZIP 包" button visible below result
- Quota decreased from 24 to 23 (correct deduction)
- Status: PASS - Full generation pipeline working, image quality excellent

## Step 11: Video Tab (Cross-Modal)
- Tab switched to 影片 (highlighted)
- Prompt retained: same text from image generation
- Video workspace visible: "影片工作區 (Veo 3.1)"
- Frame references: 首幀 (Start), 末幀 (End), 角色參考圖 (Character Ref)
- Duration options: 4秒, 8秒, 16秒(遞迴生成), 30秒(遞迴生成)
- Previous ThoughtIslandChain still visible (6/6 from image gen)
- Right panel: same 閃電模式, 創意溫度 0.50, 種子碼 settings preserved
- Status: PASS - Cross-modal tab switch preserves prompt and parameters

## Step 12: Audio Tab (Cross-Modal)
- Tab switched to 音樂 (highlighted)
- Prompt retained: same text from image generation
- Audio workspace: "音樂工作區 (Suno)"
- Genre chips: 環境音樂, Lo-Fi, 古典, 電子, 爵士, 電影配樂, 流行, R&B, 民謠, 嘻哈
- Instrumental toggle switch visible
- Right panel: same settings preserved (閃電模式, 創意溫度 0.50, 種子碼)
- Status: PASS - Cross-modal switch preserves all parameters

## Step 13: History Page
- Title: "生成歷史 共 5 筆紀錄"
- Filter tabs: 全部 5, 圖片 5, 影片 0, 音樂 0, 語音 0, 收藏 0
- Search bar: "搜尋提示詞..."
- 5 history cards visible in grid layout with thumbnails
- Most recent: 金色貓咪 (09:57), 星空下的森林小屋 (09:55), 星空小屋 Dreamy (09:08), 星空小屋 (09:07), 貓咪 Nature/Dreamy/Mystical (08:37)
- Each card has action buttons (bookmark, expand, etc.)
- Status: PASS - History page showing all generations correctly

## Step 14: History Card Expanded
- Card expanded showing full details:
  - Compiled prompt: "A captivating image of a majestic golden cat, perfectly symmetrical anatomy and flawless proportions, seated gracefully on a weathered wooden windowsill..."
  - Parameter snapshot: mode: lightning, temperature: 0.5, visual weight: 0
  - Cross-modal action buttons:
    - "重新生成" (Re-generate)
    - "發送到影片工作區" (Send to Video)
    - "發送到音樂工作區" (Send to Audio)
    - "刪除" (Delete)
- Status: PASS - History card shows compiled prompt, parameters, and cross-modal actions

## Step 15: Cross-Modal "Send to Video" - CRITICAL TEST
- Navigated from History → Studio Video tab automatically
- Prompt inherited: "一隻金色的貓咪坐在窗台上，窗外是下雨的城市街道，霓虹燈倒映在濕漉漉的路面上"
- Video tab active (影片 highlighted)
- Video workspace: "影片工作區 (Veo 3.1)"
- Start frame: Generated cat image auto-loaded as 首幀 (Start) reference!
- Parameters inherited: 閃電模式, 創意溫度 0.50, LoRA 權重 0.70, 種子碼
- PromptStrengthBar: "分析中..." (re-evaluating for video context)
- Duration options: 4秒, 8秒, 16秒, 30秒
- Status: PASS - Cross-modal parameter inheritance working! Image → Video with full context

## Step 16: Director AI Page
- Title: "導演 AI"
- 3 personality modes: 沉穩型 (重邏輯), 創意型 (重氛圍, selected), 技術型 (重參數)
- Subtitle: "雙引擎 RAG（事實研究 + CO-STAR 創意編排）— 生成的腳本可一鍵發送到工作室"
- Quick prompts: "幫我構思一部創意短片", "我想製作一段冥想引導音頻", "設計一個品牌宣傳影片腳本"
- Storyboard panel on right: "0 個腳本" with placeholder "與導演 AI 對話後，腳本會自動出現在這裡"
- Auto-save toggle: "自動儲存至筆記"
- "隱藏 Storyboard" toggle
- Chat input: "描述你的創作構想..."
- Status: PASS - Director AI with dual-engine RAG, personality modes, and Storyboard

## Step 17: Character Forge (角色鍛造所)
- Sidebar link "角色鍛造所" → /models (not /forge)
- Route exists at /models, mapped to ModelsPage component
- Status: PASS - Route works via sidebar, /forge is not a valid URL (expected behavior)

## Step 18: Character Forge (角色鍛造所) Page
- Title: "角色鍛造所"
- "新增角色" button top-right
- Subtitle: "訓練專屬角色模型，確保跨場景的角色一致性。模型就緒後可在工作室的素材抽屜中直接使用。"
- Tabs: 我的模型, 團隊共享
- Multiple Test Model cards visible in grid (3 columns)
- Each card shows: name, trigger word (zen_test), status (佇列中), date, share/delete buttons
- Status: PASS - Character Forge page functional with model grid

## Step 19: Dashboard Page
- Title: "儀表板"
- 4 stat cards: 剩餘配額 23, 總請求數 10, 預估成本 $0.050, 效率指標 0.0050 USD/次
- Recent usage log: 10 entries showing image generation and voice dubbing
- Each entry shows: type, status (成功), model, tokens, cost, timestamp
- Status: PASS - Dashboard with real usage data

## Step 20: Shared Space (共享空間)
- Title: "共享空間"
- Subtitle: "探索社群創作、分享你的作品，獲得配額獎勵"
- Stats: 2 共享素材, 3 共享模型, — 你的貢獻, — 獲得獎勵
- Search: "搜尋共享素材或模型..."
- Tabs: 共享素材 (2), 共享模型 (3)
- 2 shared asset cards visible with thumbnails
- Status: PASS - Community sharing space functional

## Step 21: Settings Page (個人設定)
- Account info: ruce B, aa0968111723@gmail.com, 管理員, 23次配額
- AI Director preferences:
  - AI 個性風格: 沉穩, 創意 (selected), 技術
  - 偏好框架: CO-STAR (selected), SSLCM, SELCM, 自由格式
  - "儲存偏好" button
- Status: PASS - Settings page with user info and AI preferences
