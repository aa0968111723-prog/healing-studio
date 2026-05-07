import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const scanDirs = ["client/src/components", "client/src/pages"];
const rg = spawnSync("rg", ["-n", "window\\.location\\.href\\s*=", ...scanDirs], {
  encoding: "utf8",
});

const lines = (rg.stdout || "").trim().split("\n").filter(Boolean);
const offenders = [];
const internalAssignPattern = /window\.location\.href\s*=\s*(["'`])\/(?!\/)/;

for (const line of lines) {
  const [file, lineNo] = line.split(":");
  const content = readFileSync(file, "utf8").split("\n")[Number(lineNo) - 1] ?? "";
  if (internalAssignPattern.test(content) && !/window\.location\.href\s*=\s*(["'`])\/api\//.test(content)) offenders.push(`${file}:${lineNo}:${content.trim()}`);
}

if (offenders.length) {
  console.error("[check-internal-navigation] Found internal navigation via window.location.href:");
  for (const item of offenders) console.error(`  - ${item}`);
  process.exit(1);
}

console.log("[check-internal-navigation] Passed.");
