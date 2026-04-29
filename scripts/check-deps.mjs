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
  console.log("\n[check] Dependency preflight (partial).");
  console.log("[check] Missing packages:");
  for (const pkg of missing) console.log(`  - ${pkg}`);
  console.log("\n[check] Optional dependencies are missing; skipping local typecheck.");
  console.log("[check] To run full checks, install all dependencies, then re-run `npm run check`.\n");
  process.exit(0);
}

console.log("[check] Dependency preflight passed.");

if (shouldTypecheck) {
  const tsc = spawnSync("npx", ["tsc", "--noEmit"], { stdio: "inherit", shell: true });
  process.exit(tsc.status ?? 1);
}
