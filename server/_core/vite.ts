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
    path.resolve(process.cwd(), "dist", "public"),         // Railway/Docker: /app/dist/public ✅
    path.resolve("/app", "dist", "public"),                // Docker absolute fallback
    path.resolve(import.meta.dirname, "public"),           // esbuild dirname fallback
    path.resolve(import.meta.dirname, "../dist", "public"), // relative fallback
    path.resolve(import.meta.dirname, "../../dist", "public"), // dev fallback
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

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
