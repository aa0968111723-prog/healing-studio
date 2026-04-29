import { Router } from "express";
import { ENV } from "../_core/env";

export const googleAuthRouter = Router();

// Bridge /api/auth/google* to existing /api/oauth/* routes.
// Keeps frontend contract stable while reusing the production OAuth pipeline.
googleAuthRouter.get("/api/auth/google/status", (_req, res) => {
  const configured = !!(ENV.googleClientId && ENV.googleClientSecret);
  res.json({ configured });
});

googleAuthRouter.get("/api/auth/google", (req, res) => {
  const queryIndex = req.originalUrl.indexOf("?");
  const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
  res.redirect(`/api/oauth/google/start${query}`);
});

googleAuthRouter.get("/api/auth/google/callback", (req, res) => {
  const queryIndex = req.originalUrl.indexOf("?");
  const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
  res.redirect(`/api/oauth/callback${query}`);
});
