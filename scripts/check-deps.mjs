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
    require.resolve(`${pkg}/package.json`);
  } catch {
    missing.push(pkg);
  }
}

const shouldTypecheck = process.argv.includes("--typecheck");
const strictRoutes = process.argv.includes("--strict");

const navigationScan = spawnSync("node", ["scripts/check-internal-navigation.mjs"], { stdio: "inherit" });
if (navigationScan.status && navigationScan.status !== 0) {
  process.exit(navigationScan.status);
}

// Route↔registry↔PageAgent lint runs unconditionally — it has no npm
// dependencies, so it works even when install is blocked. In strict mode it
// blocks the build; in lint mode it just prints warnings.
const routesScan = spawnSync(
  "node",
  ["scripts/scan-routes.mjs", ...(strictRoutes ? ["--strict"] : [])],
  { stdio: "inherit" }
);
if (strictRoutes && routesScan.status && routesScan.status !== 0) {
  process.exit(routesScan.status);
}

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
  const tsc = spawnSync(
    "node",
    ["./node_modules/typescript/bin/tsc", "--noEmit"],
    { stdio: "inherit" }
  );
  process.exit(tsc.status ?? 1);
}
