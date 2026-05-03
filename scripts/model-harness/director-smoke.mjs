#!/usr/bin/env node
/**
 * Director AI smoke test — exercises every Director tRPC procedure that
 * does meaningful work (i.e. invokes the LLM, mutates DB, or queries
 * persistent state) using a session JWT minted against JWT_SECRET.
 *
 * Goal: catch wire-up bugs (missing required field, wrong field name,
 * stale schema, response-shape mismatch) the way I caught qwenVoiceDesign
 * and stableAvatar in earlier rounds — but for the LLM-driven director
 * pipeline.
 *
 * Reads token from /tmp/test-jwt.txt (mint-jwt.mjs writes it). Server
 * must be on http://localhost:3000.
 */
import fs from "node:fs";

const TOKEN = fs.readFileSync("/tmp/test-jwt.txt", "utf8").trim();
const COOKIE = `app_session_id=${TOKEN}`;
const BASE = "http://localhost:3000/api/trpc";

async function call(procedure, json, { mutation = false } = {}) {
  const url = mutation
    ? `${BASE}/${procedure}?batch=1`
    : `${BASE}/${procedure}?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json } }))}`;
  const opts = {
    method: mutation ? "POST" : "GET",
    headers: { Cookie: COOKIE, "Content-Type": "application/json" },
    ...(mutation
      ? { body: JSON.stringify({ "0": { json } }) }
      : {}),
  };
  const startedAt = Date.now();
  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    const elapsed = Date.now() - startedAt;
    const arr = Array.isArray(body) ? body[0] : body;
    if (arr?.error) {
      return {
        ok: false,
        elapsed,
        code: arr.error.json?.data?.code ?? "?",
        msg: String(arr.error.json?.message ?? "").slice(0, 300),
      };
    }
    return {
      ok: true,
      elapsed,
      preview: JSON.stringify(arr?.result?.data?.json ?? arr).slice(0, 200),
    };
  } catch (err) {
    return {
      ok: false,
      elapsed: Date.now() - startedAt,
      msg: err.message,
    };
  }
}

const SAMPLE_SCRIPT_TEXT = `Scene 1 — A peaceful zen garden at dawn. Soft mist rolls over moss-covered stones. Camera slowly pans right.\n\nScene 2 — Close-up on hands placing a single flower on a stone lantern. Dewdrops catch the morning light.\n\nScene 3 — Wide shot, the garden bathed in golden light. A small wooden gate creaks open.`;

const TESTS = [
  // Read-only queries (cheap)
  { name: "director.templates",            args: null,  query: true },
  { name: "director.quickActions",         args: null,  query: true },
  { name: "director.generationModels",     args: null,  query: true },
  { name: "director.listSessions",         args: null,  query: true },
  { name: "director.listPlanningSessions", args: null,  query: true },
  { name: "director.preferences.get",      args: null,  query: true },

  // estimateSegmentCost — pure calc, no LLM
  {
    name: "director.estimateSegmentCost",
    args: {
      tasks: [
        { modality: "image", modelId: "fal-ai/fast-sdxl" },
        { modality: "video", modelId: "fal-ai/wan-t2v", durationSec: 5 },
        { modality: "voice", modelId: "fal-ai/elevenlabs/tts/turbo-v2.5", charCount: 100 },
      ],
    },
    query: true,
  },

  // Helpers — segment + storyboard scaffolds matching the Zod input schemas
  // for discussSegment / generateSegmentCostar / analyzeScriptOverview.
  // (storyboard is a required nested object; rawText is the original
  // free-text the user typed; discussion is optional history.)
  ((seg) => ({
    name: "director.discussSegment",
    args: { segment: seg, message: "讓鏡頭運動更戲劇化一點", personality: "creative" },
  }))({
    id: "s1",
    index: 0,
    rawText: "Scene 1 — A peaceful zen garden at dawn",
    storyboard: {
      sceneHeading: "Zen garden at dawn",
      visualDescription: "Mist over moss-covered stones, slow pan",
      dialogue: "",
      soundDesign: "Birds, distant temple bells",
      cameraDirection: "Slow pan right",
      duration: "5 秒",
      mood: "靜謐",
    },
  }),
  ((seg) => ({
    name: "director.generateSegmentCostar",
    args: { segment: seg, personality: "creative" },
  }))({
    id: "s1",
    index: 0,
    rawText: "Scene 1 — A peaceful zen garden at dawn",
    storyboard: {
      sceneHeading: "Zen garden at dawn",
      visualDescription: "Mist over moss-covered stones, slow pan",
      dialogue: "",
      soundDesign: "Birds, distant temple bells",
      cameraDirection: "Slow pan right",
      duration: "5 秒",
      mood: "靜謐",
    },
  }),
  {
    name: "director.analyzeScriptOverview",
    args: {
      segments: [{
        index: 0,
        storyboard: {
          sceneHeading: "Zen garden at dawn",
          visualDescription: "Mist over moss-covered stones",
          dialogue: "",
          soundDesign: "Birds",
          cameraDirection: "Slow pan",
          duration: "5 秒",
          mood: "靜謐",
        },
      }],
      personality: "creative",
    },
  },
  {
    name: "director.refineScript",
    args: {
      script: {
        context: "An IG Reel showing a tea ceremony",
        situation: "Wide shot of a tea master preparing matcha at sunrise",
        task: "Capture the calmness and concentration",
        action: "Slow whisking + steam rising",
        result: "Viewer feels calm + introspective",
        visualPrompt: "soft morning light, shallow depth of field",
        audioScript: "[Instrumental] gentle koto",
        musicVibe: "ambient meditation",
      },
      instruction: "把第一場改成黃昏色調",
      personality: "creative",
    },
  },
  {
    name: "director.planningDiscuss",
    args: {
      phase: "concept",
      message: "幫我規劃週末家庭旅遊短片",
      personality: "creative",
    },
  },
  {
    name: "director.planningAnalyzeDepth",
    args: {
      scenes: [{
        id: "s1",
        title: "廚房裡的母親",
        description: "母親在廚房切菜，背景陽光斜射",
        mood: "懷舊",
        emotionalGoal: "讓觀眾想起自己媽媽",
        characters: ["母親"],
        location: "老式公寓廚房",
        duration: "10 秒",
        notes: "用淺景深 + 暖光",
      }],
      personality: "creative",
    },
  },
  {
    name: "director.planningCreateMilestones",
    args: {
      milestones: [
        { title: "完成劇本", targetDate: Date.now() + 7 * 86400_000, phase: "outline" },
        { title: "完成分鏡", targetDate: Date.now() + 14 * 86400_000, phase: "scene-planning" },
      ],
      planningTitle: "母親的廚房 短片",
    },
  },
  {
    name: "director.askForStudioPlan",
    args: {
      activeModality: "image",
      prompts: { image: "a serene zen garden", video: "", audio: "", voice: "" },
      modelChoices: { image: "fal-ai/fast-sdxl" },
      tokenWeights: {},
      loraSelections: {},
      enabledFeatures: [],
    },
  },
];

(async () => {
  const results = [];
  for (const t of TESTS) {
    const r = await call(t.name, t.args, { mutation: !t.query });
    const tag = r.ok ? "✓" : "✗";
    results.push({ ...r, name: t.name });
    console.log(`${tag} ${t.name.padEnd(30)} ${(r.elapsed/1000).toFixed(1)}s ${r.ok ? "" : `[${r.code ?? "?"}] ${r.msg}`}`);
  }
  console.log("");
  console.log(`Pass: ${results.filter(r => r.ok).length}/${results.length}`);
  fs.writeFileSync("/tmp/director-smoke.json", JSON.stringify(results, null, 2));
})();
