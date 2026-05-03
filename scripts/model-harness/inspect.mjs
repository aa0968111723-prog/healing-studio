#!/usr/bin/env node
/**
 * Single-model probe: submit + poll + dump the full result body so I can
 * see what shape each provider actually returns.
 *
 * Usage:
 *   node scripts/model-harness/inspect.mjs <fal-model-id> [--input='{"prompt":"…"}'] [--timeout=60000]
 */
import "dotenv/config";

const FAL_BASE = "https://queue.fal.run";
const FAL_KEY = process.env.FAL_API_KEY;
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;

const args = process.argv.slice(2);
const modelId = args[0];
if (!modelId) { console.error("usage: inspect.mjs <fal-model-id> [--input=…] [--timeout=…]"); process.exit(1); }
const inputStr = (args.find(a => a.startsWith("--input=")) ?? '--input={"prompt":"a serene zen garden"}').slice(8);
const timeoutMs = parseInt((args.find(a => a.startsWith("--timeout=")) ?? "--timeout=120000").slice(10), 10);
const inputObj = JSON.parse(inputStr);

const isElevenLabs = modelId.includes("/elevenlabs/");

console.log(`▶ ${modelId} input=${JSON.stringify(inputObj)}`);

const submitRes = await fetch(`${FAL_BASE}/${modelId}`, {
  method: "POST",
  headers: {
    Authorization: `Key ${FAL_KEY}`,
    "Content-Type": "application/json",
    ...(isElevenLabs && ELEVEN_KEY ? { "x-fal-client-credentials": ELEVEN_KEY } : {}),
  },
  body: JSON.stringify(inputObj),
});

if (!submitRes.ok) {
  console.error(`submit ${submitRes.status}: ${await submitRes.text()}`);
  process.exit(1);
}
const sub = await submitRes.json();
console.log("submit:", JSON.stringify(sub, null, 2));

const deadline = Date.now() + timeoutMs;
let last = null;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 3000));
  const r = await fetch(sub.status_url, { headers: { Authorization: `Key ${FAL_KEY}` } });
  if (!r.ok) { console.log(`status ${r.status}`); break; }
  last = await r.json();
  process.stdout.write(`. ${last.status}\r`);
  if (last.status === "COMPLETED" || last.status === "FAILED" || last.status === "ERROR") break;
}
console.log("");
console.log("final status:", last?.status);

const resultRes = await fetch(sub.response_url, { headers: { Authorization: `Key ${FAL_KEY}` } });
console.log(`result http: ${resultRes.status}`);
const text = await resultRes.text();
try {
  console.log("result body:", JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log("result body (text):", text.slice(0, 1000));
}
