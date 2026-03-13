# 療癒多模態工作室 - Project TODO

## 資料庫架構
- [x] Users 表 (含 remaining_generations 配額, role RBAC)
- [x] Fine_Tuned_Models 表 (含 visibility 團隊共享)
- [x] Digital_Asset_Library 表 (含 is_public_recycled, visibility)
- [x] Project_Notes_Calendar 表
- [x] User_Feedback_Reports 表
- [x] API_Usage_Logs 表 (追蹤 API 消耗與成本)

## 後端 API
- [x] POST /api/generate-multimodal (Elite Prompt Compiler + 平行調度)
- [x] POST /api/fine-tune-assets (上傳微調素材)
- [x] Director AI 聊天機器人 (CO-STAR 框架, 雙引擎 RAG)
- [x] 安全審核中間件 (NSFW 預檢)
- [x] 背景任務佇列 (SSE 串流進度)
- [x] ZIP 匯出打包 (.mp4, .mp3, .wav, .txt)
- [x] RBAC 權限控制 (Admin / Creator)
- [x] API 用量追蹤與成本計算
- [x] 回收與獎勵系統 (團隊共享獎勵配額)
- [x] 交易完整性 (失敗不扣配額)

## 前端 UI/UX (療癒設計系統)
- [x] Morandi 色彩主題 (border-radius: 25px, 柔和陰影)
- [x] 吉祥物系統: 閒置熊 (追蹤滑鼠/捲動)
- [x] 吉祥物系統: 懸停鳥 (停在選項上/手機底部面板)
- [x] 吉祥物系統: 載入兔 (呼吸/揉眼動畫)
- [x] Vibe Card 精靈 + Morandi 彈性提示框
- [x] 溫度滑桿 (AI 冒險度) + 種子輸入 (平行宇宙密碼)
- [x] Flow 時間軸 (拖放首/末幀, 手機點選模式)
- [x] 快速優先切換 (閃電模式 / 深度精準模式)
- [x] 管理儀表板 (Admin: 部門成本, 配額管理)
- [x] 個人儀表板 (Creator: 個人配額, 資產管理)
- [x] 數位資產庫 (私人/團隊共享切換)
- [x] 微調模型管理
- [x] 專案筆記日曆
- [x] 使用者回饋報告
- [x] 行動裝置優先觸控 UX

## 本地化
- [x] 所有 UI 文字使用繁體中文

## 安全與品質
- [x] .env.example 檔案
- [x] Vitest 測試 (25 tests, all passed)
- [x] 編譯零錯誤健康檢查
