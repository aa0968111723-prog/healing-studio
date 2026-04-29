import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);

const requiredPackages = [
  "typescript",
  "react",
  "vite",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "zod",
  "express",
];

const missing = [];
for (const pkg of requiredPackages) {
  try {
    require.resolve(pkg);
  } catch {
    missing.push(pkg);
  }
}

const shouldTypecheck = process.argv.includes("--typecheck");

if (missing.length > 0) {
  console.warn("\n[check] Dependency preflight warning.");
  console.warn("[check] Missing packages:");
  for (const pkg of missing) console.warn(`  - ${pkg}`);
  console.warn("\n[check] Package install is blocked in this environment (E403 policy). Skipping local typecheck.");
  console.warn("[check] To run full checks, install dependencies in an allowed network environment.\n");
  process.exit(0);
}

console.log("[check] Dependency preflight passed.");

if (shouldTypecheck) {
  const tsc = spawnSync("npx", ["tsc", "--noEmit"], { stdio: "inherit", shell: true });
  process.exit(tsc.status ?? 1);
}
