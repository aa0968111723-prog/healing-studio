/**
 * passwordResetRoutes.ts — Password reset and account management routes
 *
 * Provides endpoints for password reset, password change, and profile management.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authFacade } from "../services/auth/AuthFacade";
import { passwordResetService } from "../services/auth/passwordResetService";
import { loginHistoryService } from "../services/auth/loginHistoryService";
import { verifyToken } from "../middleware/verifyToken";
import { logger } from "../_core/logger";

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(32),
  newPassword: z.string().min(8).max(128),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(80).optional(),
});

function isStrongPassword(password: string): boolean {
  return (
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

export function createPasswordResetRouter() {
  const router = Router();

  // ── Request password reset ──────────────────────────────────────────
  router.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request payload",
        details: parsed.error.flatten(),
      });
      return;
    }

    try {
      await authFacade.requestPasswordReset(parsed.data.email);

      // Always return success to prevent email enumeration
      res.json({
        success: true,
        message: "If an account exists with this email, a password reset link has been sent.",
      });
    } catch (error) {
      if (error instanceof Error && error.message === "RATE_LIMIT_EXCEEDED") {
        res.status(429).json({
          error: "Too many password reset attempts. Please try again later.",
        });
        return;
      }

      logger.error("[PasswordReset] forgot-password failed", {
        err: error,
        email: parsed.data.email,
      });

      // Still return success to prevent email enumeration
      res.json({
        success: true,
        message: "If an account exists with this email, a password reset link has been sent.",
      });
    }
  });

  // ── Verify reset token ──────────────────────────────────────────────
  router.get("/api/auth/verify-reset-token", async (req: Request, res: Response) => {
    const token = req.query.token as string;

    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "Token is required" });
      return;
    }

    try {
      const userId = await passwordResetService.validateToken(token);

      if (!userId) {
        res.status(400).json({
          error: "Invalid or expired token",
          valid: false,
        });
        return;
      }

      res.json({
        valid: true,
        message: "Token is valid",
      });
    } catch (error) {
      logger.error("[PasswordReset] verify-reset-token failed", { err: error });
      res.status(400).json({
        error: "Invalid or expired token",
        valid: false,
      });
    }
  });

  // ── Reset password with token ───────────────────────────────────────
  router.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request payload",
        details: parsed.error.flatten(),
      });
      return;
    }

    if (!isStrongPassword(parsed.data.newPassword)) {
      res.status(400).json({
        error: "Password must include uppercase, lowercase, number, and symbol",
      });
      return;
    }

    try {
      await authFacade.resetPasswordWithToken(
        parsed.data.token,
        parsed.data.newPassword
      );

      res.json({
        success: true,
        message: "Password has been reset successfully",
      });
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_OR_EXPIRED_TOKEN") {
        res.status(400).json({
          error: "Invalid or expired reset token",
        });
        return;
      }

      logger.error("[PasswordReset] reset-password failed", { err: error });
      res.status(500).json({ error: "Password reset failed" });
    }
  });

  // ── Change password (requires authentication) ───────────────────────
  router.post("/api/auth/change-password", verifyToken, async (req: Request, res: Response) => {
    const authReq = req as Request & {
      auth?: { sub: string; name: string; email?: string };
      user?: {
        id: number;
        openId: string;
        role: "user" | "admin";
        email: string | null;
        name: string | null;
      };
    };

    const email = authReq.user?.email || authReq.auth?.email;
    if (!email) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request payload",
        details: parsed.error.flatten(),
      });
      return;
    }

    if (!isStrongPassword(parsed.data.newPassword)) {
      res.status(400).json({
        error: "Password must include uppercase, lowercase, number, and symbol",
      });
      return;
    }

    try {
      await authFacade.changePassword({
        email,
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
      });

      res.json({
        success: true,
        message: "Password changed successfully",
      });
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_CREDENTIALS") {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }

      logger.error("[PasswordReset] change-password failed", { err: error, email });
      res.status(500).json({ error: "Password change failed" });
    }
  });

  // ── Update profile (requires authentication) ────────────────────────
  router.patch("/api/auth/profile", verifyToken, async (req: Request, res: Response) => {
    const authReq = req as Request & {
      auth?: { sub: string; name: string; email?: string };
      user?: {
        id: number;
        openId: string;
        role: "user" | "admin";
        email: string | null;
        name: string | null;
      };
    };

    const email = authReq.user?.email || authReq.auth?.email;
    if (!email) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request payload",
        details: parsed.error.flatten(),
      });
      return;
    }

    try {
      const result = await authFacade.updateProfile({
        email,
        name: parsed.data.name,
      });

      res.json({
        success: true,
        profile: result,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "USER_NOT_FOUND") {
        res.status(404).json({ error: "User not found" });
        return;
      }

      logger.error("[PasswordReset] update-profile failed", { err: error, email });
      res.status(500).json({ error: "Profile update failed" });
    }
  });

  // ── Get login history (requires authentication) ────────────────────────
  router.get("/api/auth/login-history", verifyToken, async (req: Request, res: Response) => {
    const authReq = req as Request & {
      auth?: { sub: string; name: string; email?: string };
      user?: {
        id: number;
        openId: string;
        role: "user" | "admin";
        email: string | null;
        name: string | null;
      };
    };

    const userId = authReq.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const history = await loginHistoryService.getUserLoginHistory(userId, limit);

      res.json({
        success: true,
        history,
      });
    } catch (error) {
      logger.error("[PasswordReset] get-login-history failed", { err: error, userId });
      res.status(500).json({ error: "Failed to fetch login history" });
    }
  });

  return router;
}

export const passwordResetRouter = createPasswordResetRouter();
