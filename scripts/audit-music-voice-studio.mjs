#!/usr/bin/env node
/**
 * scripts/audit-music-voice-studio.mjs
 *
 * 模擬「真實全站光球代理互動 × 25 精靈 × 音樂配音創作室」
 *
 * 跟 audit-25-spirits.mjs 的差別：
 *   - 那條是每位精靈一個 scenario 確認路由能命中。
 *   - 這條把焦點全部押在 /pro-studio（音音 + 聲聲住的地方），跑 25 條
 *     真實使用者會在「音樂配音創作室」打的句子，並且：
 *       1. 經 selectRoleForIntent 路由
 *       2. 經 getChatToolForSpirit 選工具
 *       3. 對 music-specialist：再多跑一次 engine 推薦（lo-fi → ace-step、
 *          ambient → stable-audio、song with lyrics → suno、sfx → mmaudio）
 *       4. 對 voice-specialist：再多跑一次 TTS 引擎挑選（zh → qwen-3-tts、
 *          en latency → eleven flash-v2-5、富情緒 → eleven-v3、其他 →
 *          multilingual-v2、克隆 → qwen-3-tts/clone-voice 或 dia-tts/voice-clone）
 *       5. 印出 wire payload（trpc.spirit.invoke 真實 input）+ 估算點數
 *
 *   覆蓋目標：
 *     - 音音 / 聲聲 兩位至少各被吃 8 次以上
 *     - 至少 6 位「協作鏈相關」精靈會被路由：導導 / 編編 / 路路 / 查查 /
 *       品品 / 巧巧 / 財財 / 步步 / 守守 / 影影 / 練練 → 確認音樂配音不
 *       是孤島，會跟全站光球代理交手
 *     - 每條 case 都不能掉到 companion fallback
 *
 * 跑：npx tsx scripts/audit-music-voice-studio.mjs
 *     或 npm run audit:music-voice
 */

import {
  selectRoleForIntent,
  getPrimaryNicknameForRole,
} from "../shared/orb-agent-roles.ts";
import { getChatToolForSpirit } from "../shared/spirit-chat-tools.ts";

// ─── 1. 場景設定：站在 /pro-studio（音音 + 聲聲駐紮處） ──────────
const PRO_STUDIO_SNAPSHOT = {
  pagePath: "/pro-studio",
  pageId: "pro-studio",
  pageLabel: "音樂配音創作室",
  capabilities: [
    { action: "fillPrompt" },
    { action: "setEngine" },
    { action: "setDuration" },
    { action: "setVoiceId" },
    { action: "setLanguage" },
    { action: "submit" },
    { action: "reset" },
  ],
};

// ─── 2. 25 條真實「音樂配音創作室」使用者輸入 ─────────────────────
//  - kind: music / voice / handoff / studio-op / proactive
//  - spirit: 期待的命中精靈
//  - style: natural（靠關鍵字）/ mention（@暱稱強制）
//  - utterance: 真實使用者會打的句子
//
// 25 條覆蓋：
//   音音(music-specialist) × 8 — BGM、SFX、stems、loop、suno song、ace-step、
//                                 lyric writer、cost-aware
//   聲聲(voice-specialist) × 8 — zh TTS、en TTS、ja TTS、low-latency、
//                                 voice clone、voice design、change voice、ASR
//   導導(director)          × 1 — 跨工具規劃（圖→影→配音→BGM）
//   編編(composer)          × 2 — 在當頁微調（「再來一段更慢」「換引擎」）
//   品品(critic)            × 1 — 批 BGM 鋪太滿
//   巧巧(quality-coach)     × 1 — 配音咬字糊
//   財財(accountant)        × 1 — 本月音樂花費
//   步步(plan-executor)     × 1 — 配音 + 配樂一條龍
//   查查(researcher)        × 1 — 站內找上次的 BGM 素材
//   影影(video-specialist)  × 1 — 影片要配旁白（會被路由到聲聲？看實際）
//                                 → 預期由 video-specialist 接，然後協作
//   守守(inspector)         × 0
//   路路(navigator)         × 0
//
// 注意：影影那條故意保留 video 關鍵字，看路由是不是真的把影音請求留給影影。
const SCENARIOS = [
  // ─── 音音 × 8 ───────────────────────────────────────────────
  {
    kind: "music",
    spirit: "music-specialist",
    style: "natural",
    utterance: "幫我寫一段 lo-fi 風格的背景音樂，90 秒，療癒咖啡店感",
  },
  {
    kind: "music",
    spirit: "music-specialist",
    style: "natural",
    utterance: "我要一首 cinematic ambient 環境音樂，30 秒，鋼琴加弦樂",
  },
  {
    kind: "music",
    spirit: "music-specialist",
    style: "mention",
    utterance: "@音音 幫我做一首完整有人聲的流行歌，3 分鐘，歌詞主題是夏天",
  },
  {
    kind: "music",
    spirit: "music-specialist",
    style: "natural",
    utterance: "做一段 8 秒可循環的 EDM BGM loop，BPM 128，給後製墊底",
  },
  {
    kind: "music",
    spirit: "music-specialist",
    style: "mention",
    utterance: "@音音 一個門關上的音效，金屬重門，迴音長一點",
  },
  {
    kind: "music",
    spirit: "music-specialist",
    style: "mention",
    utterance: "@音音 這首歌的人聲跟伴奏幫我分軌出來",
  },
  {
    kind: "music",
    spirit: "music-specialist",
    style: "mention",
    utterance: "@音音 幫我寫四句中文歌詞，主題思念故鄉，五月天風格",
  },
  {
    kind: "music",
    spirit: "music-specialist",
    style: "natural",
    utterance: "幫我配一段日系城市夜景的純音樂，要 city pop 那種律動",
  },

  // ─── 聲聲 × 8 ───────────────────────────────────────────────
  {
    kind: "voice",
    spirit: "voice-specialist",
    style: "natural",
    utterance: "幫我用中文女聲念這段廣告旁白，要溫柔款款的語氣",
  },
  {
    kind: "voice",
    spirit: "voice-specialist",
    style: "natural",
    utterance: "I need an English male narration for a documentary opening, slow pace",
  },
  {
    kind: "voice",
    spirit: "voice-specialist",
    style: "mention",
    utterance: "@聲聲 這段日文劇本幫我配一個年輕女性的聲音，動畫感",
  },
  {
    kind: "voice",
    spirit: "voice-specialist",
    style: "mention",
    utterance: "@聲聲 即時對話 demo，要低延遲，英文短句就好",
  },
  {
    kind: "voice",
    spirit: "voice-specialist",
    style: "natural",
    utterance: "我要 voice cloning 把我這段 30 秒的錄音克隆成永久聲線",
  },
  {
    kind: "voice",
    spirit: "voice-specialist",
    style: "mention",
    utterance: "@聲聲 幫我設計一個新角色聲音：磁性低沉、像 40 歲 DJ",
  },
  {
    kind: "voice",
    spirit: "voice-specialist",
    style: "mention",
    utterance: "@聲聲 把這段男聲檔換成女聲，但保留情感跟語速",
  },
  {
    kind: "voice",
    spirit: "voice-specialist",
    style: "mention",
    utterance: "@聲聲 這段 5 分鐘採訪音檔幫我轉成中文逐字稿",
  },

  // ─── 跨精靈協作 × 9 ────────────────────────────────────────
  {
    kind: "handoff",
    spirit: "director",
    style: "natural",
    utterance: "幫我規劃一個從腳本到配音到配樂再到剪片的完整工作流，30 秒短影音",
  },
  {
    kind: "studio-op",
    spirit: "composer",
    style: "natural",
    snapshot: PRO_STUDIO_SNAPSHOT,
    utterance: "再來一段，慢一點",
  },
  {
    kind: "studio-op",
    spirit: "composer",
    style: "natural",
    snapshot: PRO_STUDIO_SNAPSHOT,
    utterance: "把引擎改成 stable-audio",
  },
  {
    kind: "proactive",
    spirit: "critic",
    style: "mention",
    utterance: "@品品 這段成品 BGM 鋪太滿，幫我改一下，再好一點",
  },
  {
    kind: "proactive",
    spirit: "quality-coach",
    style: "natural",
    utterance: "這段配音咬字糊糊的，s 跟 sh 分不清楚，怎麼辦",
  },
  {
    kind: "proactive",
    spirit: "accountant",
    style: "mention",
    utterance: "@財財 本月音樂跟配音生成各花了多少點數？",
  },
  {
    kind: "handoff",
    spirit: "plan-executor",
    style: "mention",
    utterance: "@步步 幫我這支短片從配音到配樂一條龍跑完，最後輸出成品",
  },
  {
    kind: "handoff",
    spirit: "researcher",
    style: "natural",
    utterance: "查一下站內上次做的 lo-fi 音檔素材在哪裡",
  },
  {
    kind: "handoff",
    spirit: "video-specialist",
    style: "natural",
    utterance: "做一段 5 秒影片配上我的配音檔",
  },
];

// ─── 3. 完整性檢查 ──────────────────────────────────────────────
if (SCENARIOS.length !== 25) {
  console.error(`✗ 場景數 (${SCENARIOS.length}) ≠ 25 — 音樂配音創作室必須 25 條`);
  process.exit(1);
}

// ─── 4. 工具：清掉 @暱稱 ─────────────────────────────────────────
function stripMention(text) {
  return text.replace(/^@\S+\s*/, "").trim();
}

// ─── 5. music-specialist 深度引擎推薦 ────────────────────────────
//   基於 musicSpecialistTools.ts 註解 + roleSlice 的口語 fallback 知識：
//     · 完整歌 + 人聲 + 歌詞       → fal-ai/minimax/music/v1.5 (歌詞長)
//                                  / fal-ai/cassetteai/music-generator (短歌)
//     · 30 秒以內、無人聲 BGM       → fal-ai/stable-audio
//     · 純音樂、需要結構（intro/verse/outro）→ fal-ai/ace-step
//     · loop（可循環、節拍精確）    → fal-ai/ace-step
//     · 音效 sfx                   → fal-ai/mmaudio-v2-text-to-audio
//     · stems 分軌                  → fal-ai/playai/inference/dialog（or external）
//     · 寫詞 lyric only             → 純 LLM（音音人格切片）
function pickMusicEngine(prompt) {
  const p = prompt.toLowerCase();

  if (/分軌|stems|分離|isolation|人聲跟伴奏/i.test(prompt)) {
    return {
      capability: "stems",
      engine: "fal-ai/playai/inference/dialog",
      reason: "user wants stem separation / vocal isolation",
      note: "ACE-Step 是生成端；分軌走 dialog/分離端模型",
    };
  }
  if (/音效|sfx|sound effect|關門|腳步|門關|爆炸|金屬|迴音/i.test(prompt)) {
    return {
      capability: "sfx",
      engine: "fal-ai/mmaudio-v2-text-to-audio",
      reason: "user wants single short sound effect",
      note: "SFX 不該叫 Suno（會多付歌曲長度）",
    };
  }
  if (/歌詞|寫詞|四句|verse|chorus/i.test(prompt) && !/做一首|完整/.test(prompt)) {
    return {
      capability: "lyric-only",
      engine: "llm-persona",
      reason: "user only needs lyrics, no audio render",
      note: "純文字 → 音音人格切片直接吐",
    };
  }
  if (/完整|有人聲|流行歌|歌曲|歌|song/i.test(prompt) && /\d+\s*分/.test(prompt)) {
    return {
      capability: "song",
      engine: "fal-ai/minimax/music/v1.5",
      reason: "user wants a full song with vocals + lyrics + structure",
      note: "MiniMax 歌曲長 (>=1 分鐘) 比 Suno cassette 更穩",
    };
  }
  if (/lo-?fi|療癒|chill|咖啡店|睡眠/i.test(p) && /秒|分/.test(prompt)) {
    return {
      capability: "music",
      engine: "fal-ai/ace-step",
      reason: "lo-fi / chillout BGM, structured + cheap",
      note: "ACE-Step 對 lo-fi 結構乾淨",
    };
  }
  if (/ambient|環境|atmos|電影感|cinematic|純音樂|純鋼琴/i.test(p)) {
    return {
      capability: "music",
      engine: "fal-ai/stable-audio",
      reason: "short ambient / atmospheric piece (<= 45s)",
      note: "Stable Audio 對 ambient cost/quality 最划算",
    };
  }
  if (/loop|循環|bpm/i.test(p)) {
    return {
      capability: "loop",
      engine: "fal-ai/ace-step",
      reason: "user wants a precise BPM loop",
      note: "ACE-Step 對 BPM 鎖定佳",
    };
  }
  if (/city ?pop|jazz|funk|edm|律動|搖滾/i.test(p)) {
    return {
      capability: "music",
      engine: "fal-ai/ace-step",
      reason: "stylized instrumental with groove",
      note: "ACE-Step 預設首選",
    };
  }
  return {
    capability: "music",
    engine: "fal-ai/ace-step",
    reason: "default music engine",
    note: "沒命中規則 → ACE-Step 預設",
  };
}

// ─── 6. voice-specialist 深度 TTS 引擎挑選 ───────────────────────
//   對齊 voiceSpecialistTools.ts:170 ~ 203 的 pickTtsEngine：
//     · zh / ja → fal-ai/qwen-3-tts/text-to-speech/1.7b
//     · 富情緒 / 長文 → fal-ai/elevenlabs/tts/eleven-v3
//     · 低延遲 → fal-ai/elevenlabs/tts/flash-v2-5
//     · 其他 → fal-ai/elevenlabs/tts/multilingual-v2
function pickVoiceEngine(prompt) {
  if (/逐字稿|transcribe|轉文字|轉成.*稿|採訪.*轉/i.test(prompt)) {
    return {
      capability: "asr",
      engine: "fal-ai/whisper",
      reason: "ASR / transcription request",
      note: "走 transcribeAudio，不是 TTS",
    };
  }
  if (/clone|克隆|複製.*聲音|永久聲線/i.test(prompt)) {
    return {
      capability: "voice-clone",
      engine: "fal-ai/qwen-3-tts/clone-voice/1.7b",
      reason: "user wants permanent voice clone",
      note: "中文克隆優先 qwen-3-tts/clone-voice；英文可改 dia-tts/voice-clone",
    };
  }
  if (/設計.*聲音|新角色.*聲音|voice design|磁性|DJ/i.test(prompt)) {
    return {
      capability: "voice-design",
      engine: "fal-ai/qwen-3-tts/voice-design/1.7b",
      reason: "user wants to design a new persona voice",
      note: "voice-design 端不需要 reference 音檔",
    };
  }
  if (/換聲|男聲.*女聲|女聲.*男聲|change.*voice|轉換.*聲音/i.test(prompt)) {
    return {
      capability: "voice-change",
      engine: "fal-ai/playai/inference/dialog",
      reason: "voice conversion (keep emotion + timing)",
      note: "changeVoice 走 playai dialog 端",
    };
  }
  const isChinese = /[一-鿿]/.test(prompt);
  const isJapanese = /[぀-ゟ゠-ヿ]/.test(prompt);
  if (isJapanese || (/日文|日語|動畫/i.test(prompt))) {
    return {
      capability: "tts",
      engine: "fal-ai/qwen-3-tts/text-to-speech/1.7b",
      reason: "Japanese TTS",
      note: "qwen-3-tts 對中日支援最自然",
    };
  }
  if (isChinese) {
    return {
      capability: "tts",
      engine: "fal-ai/qwen-3-tts/text-to-speech/1.7b",
      reason: "Chinese TTS",
      note: "中文走 qwen-3-tts，省點數又自然",
    };
  }
  if (/低延遲|low.?latency|即時|realtime|短句/i.test(prompt)) {
    return {
      capability: "tts",
      engine: "fal-ai/elevenlabs/tts/flash-v2-5",
      reason: "low-latency / realtime English",
      note: "ElevenLabs Flash v2.5 — 延遲 < 300ms",
    };
  }
  if (/documentary|narration|敘事|長文|emotion|戲劇|配音/i.test(prompt)) {
    return {
      capability: "tts",
      engine: "fal-ai/elevenlabs/tts/eleven-v3",
      reason: "emotion-rich / long-form English",
      note: "Eleven v3 — 富情緒 + 角色 voice",
    };
  }
  return {
    capability: "tts",
    engine: "fal-ai/elevenlabs/tts/multilingual-v2",
    reason: "general multilingual default",
    note: "預設 multilingual-v2",
  };
}

// ─── 7. 主模擬器：把一條使用者輸入跑完整條光球代理 pipeline ─────
function simulate(scenario) {
  const sel = selectRoleForIntent({
    text: scenario.utterance,
    snapshot: scenario.snapshot ?? PRO_STUDIO_SNAPSHOT,
  });
  const tool = getChatToolForSpirit(sel.role);
  const cleanPrompt = stripMention(scenario.utterance);

  // ─── 對音音 / 聲聲 多加一層引擎決定 ────────────────────────
  let engineInfo = null;
  if (sel.role === "music-specialist") {
    engineInfo = pickMusicEngine(cleanPrompt);
  } else if (sel.role === "voice-specialist") {
    engineInfo = pickVoiceEngine(cleanPrompt);
  }

  // ─── 合成 wire payload ─────────────────────────────────────
  let wire;
  let note;
  switch (tool.kind) {
    case "fal-generation": {
      if (cleanPrompt.length < tool.minPromptChars) {
        wire = { fallthrough: "llm-persona", reason: `< ${tool.minPromptChars} 字` };
        note = "→ 太短當打招呼，fall through 到 LLM 人格";
      } else if (engineInfo && engineInfo.engine === "llm-persona") {
        // 例：純寫詞 — 不需要送 fal
        wire = {
          endpoint: "trpc.ai.chat (stream)",
          systemPromptSlice: `roleSlice(${sel.role})`,
          userMessage: cleanPrompt,
        };
        note = `→ ${engineInfo.note}（不送 fal）`;
      } else {
        wire = {
          endpoint: "trpc.spirit.invoke",
          input: {
            spirit: sel.role,
            prompt: cleanPrompt,
            ...(engineInfo
              ? { engine: engineInfo.engine, capability: engineInfo.capability }
              : {}),
          },
        };
        note = engineInfo
          ? `→ 真實打 ${engineInfo.engine}（${engineInfo.capability}）— ${engineInfo.note}`
          : "→ 真實打 fal.ai 模型，回 FalDispatchResult";
      }
      break;
    }
    case "navigate": {
      const path =
        tool.toPath ?? (tool.intentBased ? detectNavIntent(cleanPrompt) : "/");
      const finalPath = tool.passPromptAsSearch && cleanPrompt
        ? `${path}?search=${encodeURIComponent(cleanPrompt)}`
        : path;
      wire = {
        action: { type: "navigate", path: finalPath },
        chatHint: tool.arrivalHint,
      };
      note = `→ 客戶端 dispatch navigate to ${finalPath}`;
      break;
    }
    case "search": {
      const tooShort = cleanPrompt.length < tool.minPromptChars;
      wire = {
        endpoint: "trpc.orbProxy.unifiedSearch",
        input: {
          query: cleanPrompt,
          types: ["asset", "note", "history", "tutorial"],
        },
      };
      note = tooShort
        ? `(query 太短 < ${tool.minPromptChars} 字 → fall through LLM)`
        : "→ 打 unifiedSearch 把音檔素材帶回對話框";
      break;
    }
    case "agent-plan": {
      const tooShort = cleanPrompt.length < tool.minPromptChars;
      if (tooShort) {
        wire = { fallthrough: "llm-persona", reason: `< ${tool.minPromptChars} 字` };
        note = "→ 太短當閒聊";
      } else {
        wire = {
          step1: {
            endpoint: "trpc.spirit.plan",
            input: { goal: cleanPrompt, maxSteps: 8 },
          },
          step2: { uiCard: "預演 PlanRecord，按▶開跑 → trpc.spirit.run" },
          step3: { polling: "每 1.5s trpc.spirit.status 直到 done/failed" },
        };
        note = "→ 真實 plan + run + status 輪詢（會自動呼叫音音/聲聲）";
      }
      break;
    }
    case "page-execution": {
      const snap = scenario.snapshot ?? PRO_STUDIO_SNAPSHOT;
      const actions = parseStudioActions(cleanPrompt, snap);
      if (actions.length === 0) {
        wire = { fallthrough: "llm-persona", reason: "parser 解不出 actions" };
        note = "→ LLM 接手，編編出 actions JSON 或反問";
      } else {
        wire = { actions, dispatchVia: "executeActions(pageHandle)" };
        note = `→ 在 ${snap.pageId} 頁真實 dispatch [${actions
          .map((a) => a.type)
          .join(", ")}]`;
      }
      break;
    }
    case "llm-persona": {
      wire = {
        endpoint: "trpc.ai.chat (stream)",
        systemPromptSlice: `roleSlice(${sel.role})`,
        userMessage: cleanPrompt,
      };
      note = `→ LLM stream，套 ${sel.role} 人格切片`;
      break;
    }
  }
  return { sel, tool, wire, note, engineInfo, cleanPrompt };
}

// 編編 page-execution 用：把「再來一段慢一點」「換引擎成 stable-audio」翻
// 成 AgentAction[]。簡化版，真實客戶端用 composerImperativeParser。
function parseStudioActions(prompt, snap) {
  const actions = [];
  const has = (action) =>
    snap.capabilities.some((c) => c.action === action);
  if (/再來|再生|再做|再一段/.test(prompt) && has("submit")) {
    actions.push({ type: "submit" });
  }
  if (/慢一點|慢一些|放慢|更慢/.test(prompt) && has("setParam")) {
    actions.push({ type: "setParam", param: "tempo", delta: -10 });
  }
  if (/快一點|快一些|加速|更快/.test(prompt) && has("setParam")) {
    actions.push({ type: "setParam", param: "tempo", delta: +10 });
  }
  const engineMatch = prompt.match(/(?:換|改|改成|換成).*?(?:引擎|模型).*?([\w\-\/.]+)/);
  if (engineMatch && has("setEngine")) {
    actions.push({ type: "setEngine", engine: engineMatch[1] });
  }
  return actions;
}

function detectNavIntent(prompt) {
  if (/設定|偏好|個人/.test(prompt)) return "/account-settings";
  if (/儀表板|首頁|dashboard/i.test(prompt)) return "/dashboard";
  if (/筆記/.test(prompt)) return "/notes";
  if (/音樂|配音|pro/i.test(prompt)) return "/pro-studio";
  return "/";
}

// ─── 8. 跑 25 條 + 收覆蓋率 ──────────────────────────────────────
console.log("\n════════ 25 場景 × 音樂配音創作室 × 全站光球代理 ════════\n");
console.log(`快照頁：${PRO_STUDIO_SNAPSHOT.pageLabel} (${PRO_STUDIO_SNAPSHOT.pagePath})`);
console.log(`場景數：${SCENARIOS.length}\n`);

const eaten = new Set();
const failures = [];
const engineDist = {};
const toolKindDist = {};
let pass = 0;
let fall = 0;

SCENARIOS.forEach((sc, i) => {
  const { sel, tool, wire, note, engineInfo, cleanPrompt } = simulate(sc);
  const matched = sel.role === sc.spirit;
  const nick = getPrimaryNicknameForRole(sel.role) ?? sel.role;
  const expectedNick = getPrimaryNicknameForRole(sc.spirit) ?? sc.spirit;
  const mark = matched ? "✅" : "❌";
  const idx = String(i + 1).padStart(2, "0");

  console.log(
    `${mark} [${idx}/${SCENARIOS.length}] [${sc.kind.padEnd(10)}] [${sc.style.padEnd(7)}] expect=${expectedNick}(${sc.spirit})`,
  );
  console.log(`    utter   : "${sc.utterance}"`);
  console.log(
    `    route   : → ${nick}(${sel.role}) [conf=${sel.confidence.toFixed(2)}, ${sel.rationale}]`,
  );
  console.log(`    tool    : ${tool.kind}`);
  if (engineInfo) {
    console.log(
      `    engine  : ${engineInfo.engine} (capability=${engineInfo.capability}) — ${engineInfo.reason}`,
    );
  }
  console.log(`    wire    : ${JSON.stringify(wire)}`);
  console.log(`    sim     : ${note}\n`);

  toolKindDist[tool.kind] = (toolKindDist[tool.kind] ?? 0) + 1;
  if (engineInfo) {
    engineDist[engineInfo.engine] = (engineDist[engineInfo.engine] ?? 0) + 1;
  }
  if (matched) {
    pass++;
    eaten.add(sc.spirit);
  } else {
    failures.push({ scenario: sc, got: sel.role });
    if (sel.role === "companion") fall++;
  }
});

// ─── 9. 報表 ─────────────────────────────────────────────────────
console.log("════════ 路由 / 覆蓋 ════════");
console.log(`Pass / Total            : ${pass}/${SCENARIOS.length}`);
console.log(`不同精靈被路由命中      : ${eaten.size} 位 → ${[...eaten].join(", ")}`);
console.log(`掉到 companion fallback : ${fall}`);

console.log("\n════════ Tool kind 分佈 ════════");
for (const [k, n] of Object.entries(toolKindDist).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(18)} ${n}`);
}

console.log("\n════════ 音音 + 聲聲 真實引擎分佈 ════════");
for (const [eng, n] of Object.entries(engineDist).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${eng.padEnd(50)} ${n}`);
}

if (failures.length) {
  console.log("\n════════ 失敗詳情 ════════");
  for (const f of failures) {
    console.log(`  ❌ "${f.scenario.utterance}"`);
    console.log(`     expected=${f.scenario.spirit}  got=${f.got}`);
  }
}

// ─── 10. 收斂條件 ────────────────────────────────────────────────
const musicCount = SCENARIOS.filter((s) => s.spirit === "music-specialist").length;
const voiceCount = SCENARIOS.filter((s) => s.spirit === "voice-specialist").length;
const collabCount = eaten.size;

console.log("\n════════ 收斂條件 ════════");
console.log(`音音 scenario 數   : ${musicCount} (目標 >= 8)`);
console.log(`聲聲 scenario 數   : ${voiceCount} (目標 >= 8)`);
console.log(`協作精靈被路由家數 : ${collabCount} (目標 >= 6)`);

const ok =
  failures.length === 0 &&
  musicCount >= 8 &&
  voiceCount >= 8 &&
  collabCount >= 6 &&
  fall === 0;

if (ok) {
  console.log("\n✓ 音樂配音創作室 × 全站光球代理 — 25 條場景全部走通。");
  process.exit(0);
} else {
  console.log("\n✗ 還有 case 漏接或 fall through，請修 SCENARIOS / KEYWORD_RULES。");
  process.exit(1);
}
