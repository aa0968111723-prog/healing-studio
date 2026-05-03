import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    // Default node env. Per-file `// @vitest-environment jsdom`
    // directives switch individual tests (e.g. React hook tests under
    // tests/unit/client/) to a DOM environment.
    environment: "node",
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.spec.ts",
      "tests/unit/**/*.test.tsx",
      "tests/unit/**/*.spec.tsx",
    ],
  },
});
