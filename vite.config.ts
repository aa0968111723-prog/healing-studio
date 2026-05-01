import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";

// =============================================================================
// Manus Debug Collector - Vite Plugin
// Writes browser logs directly to files, trimmed when exceeding size limit
// =============================================================================

const PROJECT_ROOT = import.meta.dirname;
const LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB per log file
const TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6); // Trim to 60% to avoid constant re-trimming

type LogSource = "browserConsole" | "networkRequests" | "sessionReplay";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function trimLogFile(logPath: string, maxSize: number) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }

    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines: string[] = [];
    let keptBytes = 0;

    // Keep newest lines (from end) that fit within 60% of maxSize
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}\n`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }

    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
    /* ignore trim errors */
  }
}

function writeToLogFile(source: LogSource, entries: unknown[]) {
  if (entries.length === 0) return;

  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);

  // Format entries with timestamps
  const lines = entries.map(entry => {
    const ts = new Date().toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });

  // Append to log file
  fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf-8");

  // Trim if exceeds max size
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}

/**
 * Vite plugin to collect browser debug logs
 * - POST /__manus__/logs: Browser sends logs, written directly to files
 * - Files: browserConsole.log, networkRequests.log, sessionReplay.log
 * - Auto-trimmed when exceeding 1MB (keeps newest entries)
 */
function vitePluginManusDebugCollector(): Plugin {
  return {
    name: "manus-debug-collector",

    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true,
            },
            injectTo: "head",
          },
        ],
      };
    },

    configureServer(server: ViteDevServer) {
      // POST /__manus__/logs: Browser sends logs (written directly to files)
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }

        const handlePayload = (payload: any) => {
          // Write logs directly to files
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };

        const reqBody = (req as { body?: unknown }).body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }

        let body = "";
        req.on("data", chunk => {
          body += chunk.toString();
        });

        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    },
  };
}

const plugins = [
  react(),
  tailwindcss(),
  jsxLocPlugin(),
  vitePluginManusRuntime(),
  vitePluginManusDebugCollector(),
];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  // 確保下列變數在 build 時被替換（index.html 模板用 %VITE_X% 也會自動替換）
  // - VITE_SITE_URL：og:url / canonical
  // - VITE_POSTHOG_KEY / VITE_POSTHOG_HOST：index.html 內聯 PostHog init
  define: {
    "import.meta.env.VITE_SITE_URL": JSON.stringify(
      process.env.VITE_SITE_URL ?? "https://healing-studio-production.up.railway.app"
    ),
    "import.meta.env.VITE_POSTHOG_KEY": JSON.stringify(
      process.env.VITE_POSTHOG_KEY ?? ""
    ),
    "import.meta.env.VITE_POSTHOG_HOST": JSON.stringify(
      process.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com"
    ),
  },
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // 壓縮目標：現代瀏覽器（更小的 bundle）
    target: "es2020",
    // chunk 超過 800KB 才警告（預設 500KB，D3+Three.js 必然超過）
    chunkSizeWarningLimit: 800,
    // ── Chunk 分割策略：按功能拆分大型第三方套件 ──────────────
    rollupOptions: {
      output: {
        // ── 靜態資源命名（含 hash，確保快取更新）
        chunkFileNames: "assets/js/[name]-[hash].js",
        entryFileNames: "assets/js/[name]-[hash].js",
        assetFileNames: "assets/[ext]/[name]-[hash].[ext]",
        manualChunks: (id: string) => {
          // ── React 核心（最優先，幾乎每個 chunk 都需要）
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/")
          )
            return "vendor-react";

          // ── D3.js — 思維島鏈視覺化（重型 ~500KB，獨立）
          if (id.includes("node_modules/d3")) return "vendor-d3";

          // ── Three.js — 3D 光球（Phase 10，重型，按需載入）
          if (
            id.includes("node_modules/three") ||
            id.includes("node_modules/@react-three")
          )
            return "vendor-three";

          // ── Framer Motion — 動畫系統
          if (id.includes("node_modules/framer-motion")) return "vendor-motion";

          // ── Recharts — 儀表板圖表
          if (
            id.includes("node_modules/recharts") ||
            id.includes("node_modules/victory-vendor")
          )
            return "vendor-charts";

          // ── JSZip — 匯出功能（只在 Studio/History 用）
          if (id.includes("node_modules/jszip")) return "vendor-jszip";

          // ── Radix UI — UI 元件庫
          if (id.includes("node_modules/@radix-ui")) return "vendor-radix";

          // ── TanStack Query + tRPC — 資料層
          if (
            id.includes("node_modules/@tanstack") ||
            id.includes("node_modules/@trpc")
          )
            return "vendor-query";

          // ── Fal.ai SDK（只在生成流程用）
          if (id.includes("node_modules/@fal-ai")) return "vendor-fal";

          // ── XState — Phase 10 人格狀態機引擎
          if (
            id.includes("node_modules/xstate") ||
            id.includes("node_modules/@xstate")
          )
            return "vendor-xstate";

          // ── Lucide React — 圖示庫（大型，獨立 chunk）
          if (id.includes("node_modules/lucide-react")) return "vendor-lucide";

          // ── Date-fns — 日期處理（大型，獨立 chunk）
          if (
            id.includes("node_modules/date-fns") ||
            id.includes("node_modules/@date-fns")
          )
            return "vendor-date";

          // ── Streamdown + 所有 Markdown 渲染依賴 + Mermaid 子依賴
          // 合一 chunk 避免循環依賴（vendor-misc ↔ vendor-markdown）
          // 包含：cytoscape（mermaid 圖形）、langium/chevrotain（@mermaid-js/parser 語法解析）
          if (
            id.includes("node_modules/streamdown") ||
            id.includes("node_modules/mermaid") ||
            id.includes("node_modules/@mermaid-js") ||
            id.includes("node_modules/katex") ||
            id.includes("node_modules/rehype-katex") ||
            id.includes("node_modules/remark-math") ||
            id.includes("node_modules/shiki") ||
            id.includes("node_modules/@shikijs") ||
            id.includes("node_modules/hast") ||
            id.includes("node_modules/rehype") ||
            id.includes("node_modules/remark") ||
            id.includes("node_modules/unified") ||
            id.includes("node_modules/marked") ||
            id.includes("node_modules/micromark") ||
            id.includes("node_modules/mdast") ||
            id.includes("node_modules/unist") ||
            id.includes("node_modules/remend") ||
            id.includes("node_modules/html-url-attributes") ||
            id.includes("node_modules/cytoscape") ||
            id.includes("node_modules/langium") ||
            id.includes("node_modules/chevrotain") ||
            id.includes("node_modules/@chevrotain") ||
            id.includes("node_modules/vscode-languageserver") ||
            id.includes("node_modules/vscode-uri") ||
            id.includes("node_modules/vfile") ||
            id.includes("node_modules/character-reference-invalid") ||
            id.includes("node_modules/html-void-elements") ||
            id.includes("node_modules/property-information")
          )
            return "vendor-markdown";

          // ── 其餘 node_modules 統一歸入 vendor-misc
          if (id.includes("node_modules")) return "vendor-misc";
        },
      },
      // ── 注意：不設 treeshake.moduleSideEffects=false
      // 避免初始化順序錯誤（Cannot access 'X' before initialization TDZ 問題）
    },
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
