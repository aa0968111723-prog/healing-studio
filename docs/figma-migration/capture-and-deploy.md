# 無登入捕捉 → Figma，與 HF 部署現況

> 承接 `README.md`。本文記錄**實測可行**的「把登入牆內頁面 1:1 弄進 Figma」通路，
> 以及 Hugging Face 部署的現況與阻塞。

## ✅ 可行且不吃任何額度：本地無登入捕捉

repo 內**早已內建** Figma 捕捉逃生艙（`client/src/_core/hooks/useAuth.ts`）：
build 時帶 `VITE_FIGMA_CAPTURE=1`，`useAuth` 會回傳一個合成登入使用者，
讓登入牆內的 dashboard 頁面在**無需登入、無需後端**下 render。正式 build 不受影響。

### 完整指令（已實測，環境內建 Chromium）
```bash
# 1) 無登入 + 關掉會蓋版的 onboarding 的 capture build
VITE_FIGMA_CAPTURE=1 VITE_ENABLE_ORB_ONBOARDING=0 npx vite build

# 2) 本地起 preview（SPA deep-link fallback 正常）
npx vite preview --port 4173 --host &

# 3) Playwright 逐頁截圖 → /tmp/figma-shots/*.png
node scripts/figma-screenshots.mjs
#   SHOT_ONLY="dashboard,studio" node scripts/figma-screenshots.mjs  # 只拍子集
```

- `scripts/figma-screenshots.mjs` 已擴充涵蓋**全部 41 個靜態路由**，
  並預設 localStorage 關掉導覽/介紹 modal（避免蓋版）。
- 產物：每頁一張 viewport（首屏）+ 一張 full-page，2x 高解析。

### 兩個實測要點
1. **必須加 `VITE_ENABLE_ORB_ONBOARDING=0`**。否則無後端時 prefs query 出錯，
   `AidvShellChrome.tsx` 會走 `prefsQ.isError` 分支**強制打開**「光球初次見面」modal，
   蓋住整頁。此旗標是 featureFlags 內建 kill switch，無需改碼。
2. 沒有後端，資料型內容顯示預設/空狀態；頁面 **chrome、版面、設計語言** 完整呈現，
   足以作為 1:1 視覺參照。

### 把 PNG 放進 Figma（零額度、零升級）
直接把 `/tmp/figma-shots/*.png` **拖進 Figma 畫布**即可得到逐頁 1:1 像素參照——
不需 MCP 呼叫、不需 Full seat、不需 html.to.design。這是目前把整站頁面
「1:1 進 Figma」**最快且無限制**的路。

## ⚠️ Hugging Face 部署：現況與阻塞

目標：把 capture build 部署成公開前端 → 用免額度的 `generate_figma_design`／
`html.to.design` 逐頁 1:1 抓進 Figma。

**目前阻塞**（實測）：
- build 產物 **23MB / 179 檔**（含 shiki 9MB、mermaid 2.2MB 等 lazy chunk）。
- 環境**無 HF write token**、無 git credential helper → 無法 `git push` 到 HF Space。
- 逐檔 `hf_fs_write` base64 上傳 179 個檔不切實際。

**解法（擇一）**：
1. 提供一個 **HF write token**（`HF_TOKEN`），我就能 git push 到 Space（Docker SDK +
   SPA fallback）一次部署完。
2. 你自己把 `dist/public/` 丟上 HF Space（或任何靜態主機／Netlify／Vercel），
   給我公開 URL，我再接免額度的 Figma 捕捉。
3. 只走上面的「本地截圖拖進 Figma」——不需要任何部署。

> Railway 正式站（`https://healing-studio-production.up.railway.app`）**維持有登入**，
> 本流程完全不動它；無登入僅存在於 `VITE_FIGMA_CAPTURE` 的 build。
