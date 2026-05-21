import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  // Enable the automatic JSX runtime so .tsx tests (and the components they
  // render) don't need to import React at the top of every file.
  plugins: [react()],
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
      "shared/**/*.test.ts",
      "shared/**/*.spec.ts",
      "shared/**/*.test.tsx",
      "shared/**/*.spec.tsx",
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.spec.ts",
      "tests/unit/**/*.test.tsx",
      "tests/unit/**/*.spec.tsx",
    ],
  },
});
