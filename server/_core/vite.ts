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
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(
    express.static(distPath, {
      // Hashed filenames (assets/js/[name]-[hash].js) → cache for 1 year
      maxAge: "1y",
      immutable: true,
      setHeaders(res, filePath) {
        // index.html must not be cached (so new deploys take effect)
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );

  // SPA catch-all — only serve index.html for navigation requests.
  //
  // Bug previously fixed here: the old implementation served index.html for
  // EVERY missing path. After a redeploy, a user holding a stale index.html
  // references chunks like /assets/js/index-OLDHASH.js. Those hashes no
  // longer exist, so the static handler fell through, the catch-all replied
  // with index.html (Content-Type: text/html), and the browser tried to
  // parse HTML as JavaScript — surfacing as the full-screen "頁面暫時載入失敗"
  // ChunkLoadError. By 404-ing missing assets, the browser triggers a real
  // chunk load error which the client-side ErrorBoundary auto-recovers from
  // by reloading the page once and pulling a fresh index.html.
  app.use("*", (req, res) => {
    // Inside an `app.use("*")` mount Express collapses req.path to "/" — use
    // originalUrl to inspect the actual requested path.
    const requestedPath = (req.originalUrl || req.url || "/").split("?")[0];
    const accept = req.headers.accept ?? "";
    const looksLikeAsset = /\.[a-z0-9]+$/i.test(requestedPath);
    const wantsHtml = accept.includes("text/html");

    if (looksLikeAsset && !wantsHtml) {
      res.setHeader("Cache-Control", "no-cache");
      res.status(404).type("text/plain").send("Not Found");
      return;
    }

    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
