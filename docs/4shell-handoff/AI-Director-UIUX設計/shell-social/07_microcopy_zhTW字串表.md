# 07 · microcopy · zh-TW 字串表（i18n key → 字串）

> 全 shell 字串外部化（架構鐵則）。實作把下表灌進 i18n 資源（建議 namespace `social`）。`{var}` 為插值。元件**不得硬寫中文**。
> 語氣準則：溫暖、清楚、可信賴（對齊品牌 voice&tone「溫暖療癒」）；動詞開頭的 CTA；錯誤訊息**給原因＋下一步**，不指責使用者。

---

## 0. 全域 / 脊椎 / 閘門（跨步驟）

| key | zh-TW |
|---|---|
| `social.shell.title` | 社群圖文 |
| `social.nav.cockpit` | 創作台 |
| `social.nav.studio` | 圖像台 |
| `social.nav.brand` | 品牌庫 |
| `social.nav.publish` | 發佈 |
| `social.gate.cost.title` | 預估積分 |
| `social.gate.cost.confirm` | 預估 {pts} pts，確認生成？ |
| `social.gate.cost.note` | 積分制 · 先扣後生成，失敗全額退還 |
| `social.gate.cost.deducted` | 已扣 {pts} pts |
| `social.gate.cost.refunded` | 已全額退還 {pts} pts |
| `social.gate.cost.insufficient` | 積分不足，需 {pts} pts |
| `social.gate.cost.learn` | 了解積分制 |
| `social.gate.cost.cheaper` | 改用更省的模型 |
| `social.gate.brand.blocked` | 品牌尚未鎖定，先鎖定才能批量出圖與發佈 |
| `social.gate.brand.goLock` | 去鎖定品牌 |
| `social.gate.source.title` | 確認素材使用權 |
| `social.gate.source.ask` | 這張素材是{origin}，確認你有使用權？ |
| `social.gate.source.yes` | 我有使用權，繼續 |
| `social.gate.source.no` | 先不要 |
| `social.gate.override.reason` | 請說明覆寫原因 |
| `social.gate.contrast.warn` | 對比未達 AA，建議調整；仍要繼續需填原因 |
| `social.perm.readonly` | 你沒有此專案的編輯權，可複製為自己的專案 |
| `social.perm.copyProject` | 複製專案 |
| `social.perm.loginKept` | 請先登入，你的草稿已保留 |
| `common.retry` | 重試 |
| `common.expand` | 展開 |
| `common.collapse` | 收合 |
| `common.preview` | 預覽 |
| `common.back` | 上一步 |
| `common.next` | 下一步 |
| `common.cancel` | 取消 |
| `common.sources` | 來源 {n} |

---

## 1. S1 · 了解設計類型 `social.s1.*`

| key | zh-TW |
|---|---|
| `social.s1.eyebrow` | 開始一篇社群創作 |
| `social.s1.intent.placeholder` | 用一句話說你想做什麼，例如：春季禪修講座的 IG 宣傳貼文 |
| `social.s1.type.post` | 社群貼文圖 |
| `social.s1.type.post.sub` | IG／FB／Threads／X 單張或輪播 · 1:1 / 4:5 / 16:9 |
| `social.s1.type.poster` | 海報 |
| `social.s1.type.poster.sub` | 活動／宣傳，含標題與資訊層 · A4/A3 直幅 |
| `social.s1.type.card` | 圖文卡（懶人包） |
| `social.s1.type.card.sub` | 知識卡／語錄卡／多頁懶人包 · 1:1 / 4:5 |
| `social.s1.type.story` | 限動・Reels 封面 |
| `social.s1.type.story.sub` | 全螢幕直式短內容 · 9:16 |
| `social.s1.type.multi` | 多平台尺寸包 |
| `social.s1.type.multi.sub` | 同一主視覺一次輸出全平台 |
| `social.s1.infer.confirm` | 我猜你想做「{type}」，對嗎？ |
| `social.s1.infer.yes` | 對，繼續 |
| `social.s1.infer.switch` | 換一種 |
| `social.s1.resume` | 繼續上次：{title} |
| `social.s1.empty` | 選一種類型，或用一句話告訴我你想做什麼 |
| `social.s1.error.context` | 載入專案上下文時出了點問題 |

---

## 2. S2 · 設計 brief `social.s2.*`

| key | zh-TW |
|---|---|
| `social.s2.title` | 設計 brief |
| `social.s2.sub` | 填越多，AI 文案與視覺越貼近你要的 |
| `social.s2.visual.label` | 主視覺 |
| `social.s2.visual.q` | 你想要的畫面感覺？ |
| `social.s2.visual.placeholder` | 例如：暖色調、留白、一位禪修者剪影 |
| `social.s2.spirit.label` | 精神 / 調性 |
| `social.s2.spirit.q` | 這篇想給人什麼氣質？ |
| `social.s2.spirit.placeholder` | 例如：溫暖療癒、安靜、可信賴 |
| `social.s2.purpose.label` | 目的 |
| `social.s2.purpose.q` | 想達成什麼？ |
| `social.s2.purpose.signup` | 報名・活動告知 |
| `social.s2.purpose.awareness` | 品牌曝光 |
| `social.s2.purpose.knowledge` | 知識分享 |
| `social.s2.purpose.sales` | 銷售・募款 |
| `social.s2.audience.label` | 客群 |
| `social.s2.audience.q` | 給誰看？ |
| `social.s2.audience.student` | 學生 |
| `social.s2.audience.worker` | 上班族 |
| `social.s2.audience.parent` | 家長 |
| `social.s2.audience.zen` | 禪修同好 |
| `social.s2.audience.custom` | 自填… |
| `social.s2.topic.label` | 主題 |
| `social.s2.topic.q` | 這篇講什麼？ |
| `social.s2.speaker.label` | 講師 / 主角 |
| `social.s2.speaker.q` | 誰主講，或誰是主角？ |
| `social.s2.speaker.pick` | 選擇講師 |
| `social.s2.speaker.custom` | 自行輸入 |
| `social.s2.speaker.none` | 沒有特定主角 |
| `social.s2.speaker.addPhoto` | 把 {name} 的照片加入素材 |
| `social.s2.skip` | 略過細節，先出草稿 |
| `social.s2.done` | 完成 brief，去收集素材 |
| `social.s2.longText.compressed` | 已整理成重點（{n} 字 → 精華） |
| `social.s2.longText.seeOriginal` | 看原文 |
| `social.s2.error.save` | 暫存失敗，已保留你的輸入，稍後自動重試 |
| `social.s2.brandHint` | 之後要批量出圖／發佈前，需先鎖定品牌 |

---

## 3. S3 · 收集專案資料素材 `social.s3.*`

| key | zh-TW |
|---|---|
| `social.s3.tab.assets` | 專案資產 |
| `social.s3.tab.upload` | 上傳 |
| `social.s3.tab.speaker` | 講師素材 |
| `social.s3.assets.empty` | 這個專案還沒有素材 |
| `social.s3.assets.empty.sub` | 上傳檔案，或直接讓 AI 生成 |
| `social.s3.upload.drop` | 拖放圖片到這裡，或點選檔案 |
| `social.s3.upload.formats` | 支援 JPG／PNG／WebP，單檔上限 {n}MB |
| `social.s3.upload.failed` | {filename} 上傳失敗：{reason} |
| `social.s3.trends.cta` | 讓 AI 找熱點角度 |
| `social.s3.trends.loading` | 正在讀新聞、找角度… |
| `social.s3.trends.adopt` | 採用此角度 |
| `social.s3.trends.failed` | 暫時找不到熱點，可手動輸入主題 |
| `social.s3.tray.selected` | 已選 {n} 件 |
| `social.s3.tray.toCreate` | 帶去創作 |
| `social.s3.crossProject` | 從資產庫挑既有素材（含其他專案） |

---

## 4. S4 · 創作設計素材 `social.s4.*`（含 Flow 牆 / 生成存庫重用）

| key | zh-TW |
|---|---|
| `social.s4.tab.text2img` | 文字生成 |
| `social.s4.tab.import` | 外部導入 |
| `social.s4.tab.compose` | 文字排版合成 |
| `social.s4.prompt.placeholder` | 描述你要的畫面，例如：暖色晨光中的禪修者剪影，留白給標題 |
| `social.s4.seed.fixed` | 固定 seed（跨圖一致） |
| `social.s4.seed.random` | 隨機 |
| `social.s4.seed.tip` | 固定 seed 能讓系列圖風格一致、可重現 |
| `social.s4.cost.estimate` | 估算成本 |
| `social.s4.result.approve` | 核准這張 |
| `social.s4.result.regen` | 再生成 |
| `social.s4.result.extend` | 從這張延伸 |
| `social.s4.fallback.failed` | {provider} 生成失敗（{reason}），已自動改用 {next}… |
| `social.s4.fallback.retry` | 重試這張 |
| `social.s4.empty` | 描述你要的畫面，或從右側 Flow 牆延伸一張 |
| `social.s4.import.hint` | 從 Canva／Adobe 導回的成品也會出現在這裡 |
| `social.reuse.title` | 生成 → 存庫 → 重用 |
| `social.reuse.empty` | 這篇還沒有素材，生成一張就會出現在這裡 |
| `social.reuse.asBase` | 重用為底圖 |
| `social.reuse.toCompose` | 加入合成 |
| `social.reuse.toExport` | 送多尺寸 |
| `social.reuse.setMain` | 設為主視覺 |
| `social.reuse.scope.post` | 本篇 |
| `social.reuse.scope.project` | 本專案 |
| `social.reuse.scope.all` | 全部 |
| `social.flow.title` | Flow 電視牆 |
| `social.flow.scope.project` | 本專案 |
| `social.flow.scope.showcase` | 精選 showcase |
| `social.flow.scope.template` | 官方範本 |
| `social.flow.autoplay` | 自動輪播 |
| `social.flow.extend` | 延伸 |
| `social.flow.apply` | 套用 |
| `social.flow.fork` | 複製為我的（記來源） |
| `social.flow.empty.project` | 先生成一張，之後就能在這裡延伸 |
| `social.flow.empty.showcase` | 精選牆還沒有作品 |

---

## 5. S5 · 素材修改 `social.s5.*`

| key | zh-TW |
|---|---|
| `social.s5.op.brandColor` | 套品牌色 |
| `social.s5.op.changeBg` | 換背景 |
| `social.s5.op.cutout` | 去背（透明） |
| `social.s5.op.placeLogo` | 置入 logo・講師 |
| `social.s5.op.inpaint` | 局部重繪 |
| `social.s5.inpaint.hint` | 框選要重畫的區域，再描述想要的內容 |
| `social.s5.apply` | 估算 → 套用 |
| `social.s5.approve` | 核准 |
| `social.s5.remod` | 再修一次 |
| `social.s5.revert` | 還原上一版 |
| `social.s5.version` | 版本 {n} |
| `social.s5.compare` | 比較 |
| `social.s5.gotoVersion` | 回到這版 |
| `social.s5.offBrand` | 這張和品牌色有點距離，建議：{suggestion} |
| `social.s5.empty` | 從右側挑一張素材開始修改 |

---

## 6. S6 · 圖層拼接合成 `social.s6.*`

| key | zh-TW |
|---|---|
| `social.s6.title` | 文字排版合成 |
| `social.s6.sub` | 文字用品牌字體精準排版，清晰不糊 |
| `social.s6.addText` | + 文字 |
| `social.s6.addElement` | + 元件 |
| `social.s6.group` | 群組 |
| `social.s6.align` | 對齊 |
| `social.s6.layer.rename` | 重新命名 |
| `social.s6.layer.lock` | 鎖定 |
| `social.s6.layer.visible` | 顯示・隱藏 |
| `social.s6.prop.text` | 文字內容 |
| `social.s6.prop.font` | 字體（限品牌） |
| `social.s6.prop.size` | 字級 |
| `social.s6.prop.leading` | 行距 |
| `social.s6.prop.color` | 顏色（限品牌色票） |
| `social.s6.prop.align` | 對齊 |
| `social.s6.prop.opacity` | 不透明度 |
| `social.s6.contrast.ok` | 對比 AA ✅ |
| `social.s6.contrast.bad` | 對比不足，建議調整 |
| `social.s6.guard.font` | 只能用品牌字體，去品牌庫擴充？ |
| `social.s6.guard.color` | 只能用品牌色票 |
| `social.s6.logo.tooSmall` | logo 太小，低於最小尺寸 |
| `social.s6.logo.outOfSafe` | logo 超出安全區 |
| `social.s6.text.overflow` | 文字過長，已自動縮排 |
| `social.s6.text.overflow.sug` | 建議縮短，或展開為多頁卡 |
| `social.s6.font.loading` | 品牌字體載入中… |
| `social.s6.font.fallback` | 品牌字體暫時載不到，先用回退字體預覽 |
| `social.s6.compose` | 合成這張 → 入庫 |
| `social.s6.changeTemplate` | 改範本 |
| `social.s6.cost.free` | 合成不耗積分（~0 pts） |
| `social.s6.empty` | 先在「文字生成」出一張背景，或上傳一張 |

---

## 7. S7 · 外部精修 Canva/Adobe `social.s7.*`

| key | zh-TW |
|---|---|
| `social.s7.title` | 外部精修（Canva／Adobe） |
| `social.s7.sub` | 送去外部站精修，成品自動拉回你的資產庫 |
| `social.s7.canva.send` | 送進 Canva 編輯 |
| `social.s7.canva.brandTemplate` | 用品牌範本套版 |
| `social.s7.canva.editing` | 在 Canva 編輯中… |
| `social.s7.canva.pull` | 完成，拉回成品 |
| `social.s7.canva.format` | 選擇匯出格式 |
| `social.s7.adobe.cutout` | 去背 |
| `social.s7.adobe.expand` | 生成式擴圖 |
| `social.s7.adobe.vectorize` | 向量化 |
| `social.s7.adobe.indesign` | InDesign 印刷版面 → PDF |
| `social.s7.adobe.firefly` | Firefly 生成板（開新視窗） |
| `social.s7.adobe.font` | 字體建議 |
| `social.s7.pushing` | 正在把素材送進 {site}… |
| `social.s7.processing` | {op} 處理中，完成會通知 |
| `social.s7.notConnected` | 尚未連接 {site} |
| `social.s7.notConnected.sub` | 連接後即可往返精修 |
| `social.s7.notConnected.skip` | 先略過，用站內工具 |
| `social.s7.expired` | {site} 連接已過期 |
| `social.s7.reconnect` | 重新連接 |
| `social.s7.saveVersion` | 存為新版本入庫 |
| `social.s7.source.from` | 這張成品來自 {site} |
| `social.s7.failed` | {site} 處理失敗：{reason} |
| `social.s7.failed.safe` | 你的來源素材沒有變動 |

---

## 8. S8 · 反覆修正 `social.s8.*`

| key | zh-TW |
|---|---|
| `social.s8.title` | 反覆修正 |
| `social.s8.sub` | 比較版本、核准定稿 |
| `social.s8.version` | v{n} |
| `social.s8.version.site` | {site} 版 |
| `social.s8.compare` | 並排比較 |
| `social.s8.approve` | 核准為定稿 |
| `social.s8.reject` | 退回 v{n} 再改 |
| `social.s8.flag.offBrand` | 偏離品牌 |
| `social.s8.flag.lowContrast` | 對比不足 |
| `social.s8.flag.onBrand` | 已套品牌 ✓ |
| `social.s8.approved` | 已核准，可進入多尺寸與發佈 |
| `social.s8.stale.count` | {n} 篇貼文引用了舊版品牌 |
| `social.s8.stale.regenAll` | 全部重生 |
| `social.s8.stale.regenSome` | 選擇性重生 |
| `social.s8.stale.keep` | 保留舊版（接受差異） |
| `social.s8.empty` | 目前只有一個版本，核准它，或回去再做一版 |

---

## 9. S9-A · 品牌鎖 `social.brand.*`

| key | zh-TW |
|---|---|
| `social.brand.tab.kit` | 品牌 Kit |
| `social.brand.tab.styles` | 風格庫 |
| `social.brand.new` | 建立第一個品牌 |
| `social.brand.state.draft` | 草稿 |
| `social.brand.state.defined` | 已備齊 |
| `social.brand.state.locked` | 已鎖定 · v{n} |
| `social.brand.missing.logo` | 缺少 logo，補上才能鎖定 |
| `social.brand.missing.palette` | 缺少主色 |
| `social.brand.missing.font` | 缺少字體 |
| `social.brand.contrast.sug` | 主色配白字對比不足，建議改用 {suggestion} |
| `social.brand.lock` | 鎖定品牌 |
| `social.brand.lock.sub` | 鎖定後，這個品牌就能批量出圖與發佈 |
| `social.brand.unlock.warn` | 解鎖會建立新版本，並影響 {n} 篇既有貼文 |
| `social.brand.unlock.confirm` | 仍要解鎖 |
| `social.brand.section.logo` | logo |
| `social.brand.section.palette` | 色票 |
| `social.brand.section.type` | 字體 |
| `social.brand.section.voice` | 口吻 voice & tone |
| `social.brand.section.layout` | 版面規則 |

---

## 10. S9-B · 多尺寸匯出 `social.export.*`

| key | zh-TW |
|---|---|
| `social.export.title` | 多尺寸匯出 |
| `social.export.sub` | 一張定稿，一次輸出全平台尺寸 |
| `social.export.strategy.crop` | 智慧裁切（避開臉與 logo） |
| `social.export.strategy.relayout` | 文字位置自動重排 |
| `social.export.previewAll` | 預覽各尺寸 |
| `social.export.run` | 匯出 {n} 個尺寸 |
| `social.export.preset.igSquare` | IG 貼文 1:1 |
| `social.export.preset.igPortrait` | IG 直 4:5 |
| `social.export.preset.story` | 限動・Reels 9:16 |
| `social.export.preset.fb` | FB 連結卡 1.91:1 |
| `social.export.preset.x` | X 16:9 |
| `social.export.preset.line` | LINE 1:1 |
| `social.export.preset.xhs` | 小紅書 3:4 |
| `social.export.preset.posterA4` | 海報 A4 300dpi |
| `social.export.done` | {preset} 匯出完成 |
| `social.export.failed` | {preset} 失敗，重試 |
| `social.export.empty` | 先核准一張定稿，才能匯出多尺寸 |
| `social.export.blocked` | 品牌未鎖定，無法匯出多尺寸 |

---

## 11. S9-C · 發佈 / 行事曆 / 精選 `social.publish.*`

| key | zh-TW |
|---|---|
| `social.publish.tab.publish` | 發佈 |
| `social.publish.tab.calendar` | 內容行事曆 |
| `social.publish.tab.showcase` | 精選 |
| `social.publish.channels` | 選擇發佈通道 |
| `social.publish.channel.notConnected` | 尚未連接 {channel} |
| `social.publish.channel.connect` | 連接此通道 |
| `social.publish.now` | 立即發佈 |
| `social.publish.schedule` | 排程發佈 |
| `social.publish.pickTime` | 選擇日期時間 |
| `social.publish.check.brand` | 品牌已鎖 ✅ |
| `social.publish.check.source` | 素材來源已確認 ✅ |
| `social.publish.check.cost` | 預估 {pts} pts |
| `social.publish.calendar.empty` | 本月還沒排內容 |
| `social.publish.calendar.empty.sub` | 把貼文拖到日期就會自動排程 |
| `social.publish.rejected` | {channel}退件：{reason} |
| `social.publish.rejected.sug` | 建議改 {suggestion} |
| `social.publish.throttled` | {channel}流量限制，已排隊，會自動重送 |
| `social.publish.tokenExpired` | {channel}授權過期，請重新連接（你的貼文已保留） |
| `social.publish.toShowcase` | 推上精選牆 |
| `social.publish.showcase.forkable` | 已發佈作品可被他人 fork 為版面起點 |
| `social.publish.noChannel` | 還沒接發佈通道？先下載多尺寸包手動發佈 |
| `social.publish.empty` | 還沒有可發佈的貼文 |

---

## 12. 可設定工作流 `social.wf.*`

> 工作流編輯器（增/刪/重排/啟停/必經·可選/存自訂/重設/衝突）的完整字串表在 **`09` §8**（key 前綴 `social.wf.*`），併入本資源檔同一 namespace。此處不重列，避免兩處分叉。

---

> **插值與語氣**：`{pts}` 積分（積分制、不涉金錢）、`{n}` 數量、`{site}/{channel}/{provider}` 名稱、`{reason}/{suggestion}` 由後端帶。**積分語氣**：用「積分／pts」不用「金額／$」；扣退即時回饋（已扣／已全額退還）。所有錯誤字串遵循「**原因 + 下一步**」，不指責使用者；所有空狀態遵循「**一句引導 + 一顆 CTA**」。
