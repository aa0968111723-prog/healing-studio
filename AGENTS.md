1. 專案架構概覽：TypeScript monorepo，client（React+Vite）+ server（Express+tRPC），部署在 Railway
2. 光球代理核心檔案路徑：
   - client/src/contexts/GlobalOrbChatContext.tsx（全站聊天狀態）
   - client/src/contexts/PageAgentContext.tsx（頁面代理）
   - server/services/siteKnowledge.ts（光球系統提示詞）
   - server/services/orbReplyParser.ts（回覆解析器）
   - server/routers.ts（ai.chat endpoint）
3. 全站工作室路由對應：/image-studio=FAL.ai, /video-studio=Veo/Hailuo, /music-studio=Suno, /voice-studio=ElevenLabs, /agent=AgentChat
4. Codex 任務規則：所有改動必須通過 npm run test 後才算完成；不能修改 .env 檔案；DB migration 用 npm run db:push
