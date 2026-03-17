# Full-Site Audit Findings

## 1. Model Training (ModelsPage.tsx)

### Issues Found:
- **Dataset images use URL.createObjectURL only** (line 93): Images are stored as local blob URLs, never uploaded to S3. When `handleStartTraining` fires, the `createMutation` does NOT send any image data or URLs to the backend. The backend `models.create` route accepts `fileUrl` and `fileKey` but they are never passed from the frontend.
- **No real training job**: `models.create` just inserts a DB record with `configJson`. There's no background job creation, no SSE progress, no actual training pipeline. The model is created with status "queued" but never transitions.
- **Auto-captioning is fake**: The captioning step shows hardcoded text descriptions ("正面照，自然光線") rather than actual AI-generated captions.

### Fixes Needed:
1. Upload dataset images to S3 before creating model
2. Create a background job for training and wire up progress tracking
3. Either use LLM for real captioning or clearly label it as "preview"

## 2. Prompt Engineering (compileElitePrompt)

### Issues Found:
- **compileElitePrompt works correctly**: It calls `invokeLLM` with proper system prompt, vibe descriptions, temperature, and generation type. Returns compiled English prompt.
- **Frontend ProgressivePromptBuilder compiles locally**: The `compilePrompt` function concatenates fields client-side, then the backend's `compileElitePrompt` further refines via LLM.
- **Missing visual weight for reference images**: When `styleReferenceUrl` or `vibeReferenceUrl` is provided, the backend does NOT calculate visual weight or pass ControlNet-like parameters. It just stores the URLs in `resultData` but doesn't incorporate them into the `generateImage` call.
- **generateImage only receives prompt**: The `generateImage({ prompt: compiledPrompt })` call ignores all reference images, aspect ratio, negative prompt, etc.

### Fixes Needed:
1. Pass reference images to generateImage as `originalImages` parameter
2. Incorporate aspect ratio and negative prompt into the generation call
3. Add visual weight calculation when reference images are present

## 3. Cross-Modal Flow (DirectorAI → Studio)

### Issues Found:
- **Send-to-Studio works**: `handleSendToStudio` correctly stores data in sessionStorage and navigates to /studio. Studio reads it via useEffect.
- **Bug: generationType set to "multimodal"**: DirectorAI sends `generationType: "multimodal"` but Studio's tabs only have "image", "video", "audio", "voice". The `setActiveModality(data.generationType)` will try to set "multimodal" which isn't a valid tab value.
- **Missing "send to voice/image" individual buttons**: The storyboard shows Veo/Suno/ElevenLabs badges but they're just display labels, not actionable buttons.
- **ZIP export is placeholder**: `toast.info("ZIP 匯出功能即將推出")` on Studio.tsx line 357.
- **Settings subscription button is placeholder**: `toast.info("訂閱功能即將推出")` on SettingsPage.tsx line 209.

### Fixes Needed:
1. Fix generationType mapping from Director AI
2. Add individual "send to image/audio/voice" buttons in storyboard
3. Remove or implement ZIP export

## 4. Sidebar Navigation
- **All 11 sidebar paths have matching routes in App.tsx** ✅
- **All routes have corresponding page files** ✅
- **No dead links** ✅

## Summary of Dead Buttons:
1. ModelsPage dataset upload → local blob only, not S3
2. ModelsPage "開始訓練" → creates DB record but no real training job
3. Studio "匯出 ZIP 包" → toast placeholder
4. Settings "訂閱" → toast placeholder
5. Director AI storyboard Veo/Suno/ElevenLabs badges → display only, not actionable
6. Director AI "發送到工作室" → works but sends wrong generationType
