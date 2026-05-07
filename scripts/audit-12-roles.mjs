/**
 * scripts/audit-12-roles.mjs
 * Deep audit: run each of the 12 agent roles through realistic intents
 * and report the actual selection vs expected.
 */
import { selectRoleForIntent } from "../shared/orb-agent-roles.ts";
import { selectSkillForIntent, AGENT_SKILL_REGISTRY, validateSkillRegistry, findSkillForTool } from "../shared/agent-skills.ts";
import { findAgentForTool } from "../shared/orb-specialized-agents.ts";

const TEST_CASES = [
  // ─── Generic 6 roles ──────────────────────────────────────────────
  { expected: "director",   intent: "幫我規劃一個從腳本到影片到配樂的完整工作流" },
  { expected: "director",   intent: "幫我做一支教學影片，從規劃到輸出" },
  { expected: "composer",   intent: "再來一張",            ctx: { snapshot: { pagePath: "/image-studio", pageId: "image-studio", pageLabel: "Img", capabilities: [] } } },
  { expected: "composer",   intent: "submit",              ctx: { snapshot: { pagePath: "/studio", pageId: "studio", pageLabel: "S", capabilities: [] } } },
  { expected: "critic",     intent: "這個提示詞幫我改一下，再好一點" },
  { expected: "critic",     intent: "幫我修這張圖的構圖" },
  { expected: "researcher", intent: "幫我比較 Flux 和 SDXL 的差別" },
  { expected: "researcher", intent: "查一下 Veo 3 的最新規格" },
  { expected: "navigator",  intent: "帶我去個人設定頁面" },
  { expected: "navigator",  intent: "幫我打開儀表板" },
  { expected: "companion",  intent: "嗨" },
  { expected: "companion",  intent: "今天天氣不錯" },

  // ─── Specialist 6 roles ────────────────────────────────────────────
  { expected: "image-specialist",    intent: "畫一張賽博龐克風格的圖片" },
  { expected: "image-specialist",    intent: "幫我去背這張照片" },
  { expected: "video-specialist",    intent: "做一段短視頻給我" },
  { expected: "video-specialist",    intent: "v2v 把這個影片轉成卡通風格" },
  { expected: "music-specialist",    intent: "幫我寫一段背景音樂" },
  { expected: "music-specialist",    intent: "我要 lo-fi 風格的配樂" },
  { expected: "voice-specialist",    intent: "做一段配音給這個劇本" },
  { expected: "voice-specialist",    intent: "我要 voice cloning 我的聲音" },
  { expected: "training-specialist", intent: "幫我訓練一個角色 LoRA" },
  { expected: "training-specialist", intent: "fine-tune a custom model" },
  { expected: "learning-specialist", intent: "新手入門教學" },
  { expected: "learning-specialist", intent: "教我怎麼開始做影片" },
];

console.log("\n════════ 12 Roles Deep Audit ════════\n");

let pass = 0, fail = 0;
const failures = [];
for (const tc of TEST_CASES) {
  const skill = selectSkillForIntent({ text: tc.intent, ...(tc.ctx ?? {}) });
  const role = selectRoleForIntent({ text: tc.intent, ...(tc.ctx ?? {}) });
  const ok = skill.skill.id === tc.expected;
  if (ok) pass++; else { fail++; failures.push({ tc, got: skill.skill.id, source: skill.source, role: role.role }); }
  const mark = ok ? "✅" : "❌";
  console.log(`${mark} expected=${tc.expected.padEnd(20)} got=${skill.skill.id.padEnd(20)} (source=${skill.source}, role=${role.role}) — "${tc.intent}"`);
}

console.log("\n────────");
console.log(`Pass: ${pass}/${TEST_CASES.length}, Fail: ${fail}`);
if (failures.length) {
  console.log("\n失敗案例：");
  for (const f of failures) console.log(`  ❌ "${f.tc.intent}" → got=${f.got} (source=${f.source}); 期望=${f.tc.expected}`);
}

console.log("\n════════ Tool ⇄ Skill Wiring ════════\n");
const TOOL_TESTS = [
  "studio.generateImage",
  "studio.generateVideo",
  "studio.enhanceVideo",
  "studio.animateSpeaker",
  "studio.generateAudio",
  "studio.generateSfx",
  "studio.separateStems",
  "studio.isolateAudio",
  "studio.mergeAudios",
  "studio.generateVoice",
  "studio.cloneVoice",
  "studio.designVoice",
  "studio.changeVoice",
  "studio.transcribe",
  "studio.trainLora",
  "studio.generate3D",
  "director.suggestPlan",
  "research.deepSearch",
  "inspiration.fetch",
];
for (const tool of TOOL_TESTS) {
  // findAgentForTool only checks the 6 specialists; findSkillForTool checks
  // both generic + specialist skills, which is what the runtime uses.
  const skill = findSkillForTool(tool);
  const specialist = findAgentForTool(tool);
  const owner = skill?.id ?? "(no skill claims it!)";
  const note = specialist && specialist !== skill?.id ? ` (specialist=${specialist})` : "";
  console.log(`${skill ? "✅" : "❌"} ${tool.padEnd(30)} → ${owner}${note}`);
}

console.log("\n════════ Skill Registry Validation ════════\n");
const v = validateSkillRegistry();
console.log("ok:", v.ok, "unknownPages:", v.unknownPages, "duplicateIds:", v.duplicateIds);

console.log("\n════════ Skill Coverage by Modality ════════\n");
for (const skill of AGENT_SKILL_REGISTRY) {
  console.log(`${skill.id.padEnd(22)} modality=${skill.modality.padEnd(8)} pages=${skill.recommendedPages.join(",")} tools=${skill.tools.length}`);
}
