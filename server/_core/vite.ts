import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  // import.meta.dirname after esbuild bundle = the source file location, NOT dist/
  // So we must use process.cwd() or absolute paths to find dist/public
  const possiblePaths = [
    path.resolve(process.cwd(), "dist", "public"),              // Railway/Docker: /app/dist/public ✅
    path.resolve("/app", "dist", "public"),                     // Docker absolute fallback
    path.resolve(import.meta.dirname, "public"),                // esbuild dirname fallback
    path.resolve(import.meta.dirname, "../dist", "public"),     // relative fallback
    path.resolve(import.meta.dirname, "../../dist", "public"),  // dev fallback
  ];

  let distPath = possiblePaths[0];
  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, "index.html"))) {
      distPath = p;
      break;
    }
  }

  console.log(`[Static] Serving frontend from: ${distPath}`);
  console.log(`[Static] index.html exists: ${fs.existsSync(path.join(distPath, "index.html"))}`);

  if (!fs.existsSync(distPath)) {
    console.error(
      `[Static] Could not find build directory. Tried:\n  ${possiblePaths.join("\n  ")}`
    );
  }

  // ── 靜態資源路由（必須在 SPA wildcard 之前，否則 JS/CSS 會被回傳 text/html）
  //
  // 問題根因：若只用 app.use(express.static(distPath)) 後接 app.use("*", ...sendFile)，
  // 在某些 Express 版本或路由設定下，"*" 會搶先攔截 /assets/*.js 請求並回傳 index.html，
  // 導致瀏覽器報告 MIME type 錯誤（"text/html" instead of "application/javascript"）。
  //
  // 解法：明確以 /assets 路由優先掛載，確保 JS chunk 永遠走靜態檔案服務。

  const staticOptions: Parameters<typeof express.static>[1] = {
    // 讓瀏覽器快取 immutable hashed assets 1 年；index.html 不快取（由下方 sendFile 處理）
    setHeaders(res, filePath) {
      if (/\/assets\//.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  };

  // 1. 明確路由：/assets/** → 靜態檔案（優先級最高）
  app.use("/assets", express.static(path.join(distPath, "assets"), staticOptions));

  // 2. 其餘靜態檔案（favicon, robots.txt, 其他根目錄資源）
  app.use(express.static(distPath, staticOptions));

  // 3. SPA fallback — 僅在上方靜態服務找不到對應檔案時才執行
  //    使用精確的 GET 路由而非 app.use("*")，避免攔截 POST /api/* 等請求
  app.get("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
