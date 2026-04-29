import { createRequire } from "node:module";

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

if (missing.length > 0) {
  console.error("\n[check] Dependency preflight failed.");
  console.error("[check] Missing packages:");
  for (const pkg of missing) console.error(`  - ${pkg}`);
  console.error("\n[check] Please install dependencies before running typecheck.");
  console.error("[check] Example: npm install\n");
  process.exit(1);
}

console.log("[check] Dependency preflight passed.");
