/**
 * passwordResetService.ts — Password reset token management
 *
 * Handles generation, validation, and cleanup of password reset tokens.
 */

import { randomBytes, createHash } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import { BaseRepository } from "../../repositories/base/BaseRepository";

const ONE_HOUR_MS = 60 * 60 * 1000;

export interface PasswordResetTokenData {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

type PasswordResetTokenRow = RowDataPacket & PasswordResetTokenData;

/**
 * Rate limiting state for password reset requests
 */
const resetRequestCounts = new Map<string, { count: number; resetAt: number }>();

export class PasswordResetService extends BaseRepository {
  /**
   * Generate a secure random token (returns plain token, stores hash)
   */
  generateToken(): string {
    return randomBytes(32).toString("hex");
  }

  /**
   * Hash a token for storage
   */
  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  /**
   * Check rate limiting for password reset requests
   * Returns true if request should be allowed
   */
  checkRateLimit(email: string): boolean {
    const now = Date.now();
    const key = email.toLowerCase();
    const record = resetRequestCounts.get(key);

    // Clean up if past the reset window (1 hour)
    if (record && now > record.resetAt) {
      resetRequestCounts.delete(key);
      return true;
    }

    // Allow if no record or count is below limit (3 per hour)
    if (!record || record.count < 3) {
      resetRequestCounts.set(key, {
        count: (record?.count || 0) + 1,
        resetAt: record?.resetAt || now + ONE_HOUR_MS,
      });
      return true;
    }

    return false;
  }

  /**
   * Create a password reset token for a user
   */
  async createResetToken(userId: number): Promise<string> {
    const plainToken = this.generateToken();
    const tokenHash = this.hashToken(plainToken);
    const expiresAt = new Date(Date.now() + ONE_HOUR_MS);

    await this.db.execute(
      `INSERT INTO password_reset_tokens (userId, tokenHash, expiresAt, used, createdAt)
       VALUES (?, ?, ?, ?, NOW())`,
      [userId, tokenHash, expiresAt, false]
    );

    return plainToken;
  }

  /**
   * Validate a password reset token
   * Returns userId if valid, null otherwise
   */
  async validateToken(plainToken: string): Promise<number | null> {
    const tokenHash = this.hashToken(plainToken);

    const rows = await this.db.query<PasswordResetTokenRow[]>(
      `SELECT id, userId, tokenHash, expiresAt, used, createdAt
       FROM password_reset_tokens
       WHERE tokenHash = ?
       LIMIT 1`,
      [tokenHash]
    );

    const token = rows[0];
    if (!token) {
      return null;
    }

    // Check if token is used
    if (token.used) {
      return null;
    }

    // Check if token is expired
    if (new Date(token.expiresAt) < new Date()) {
      return null;
    }

    return token.userId;
  }

  /**
   * Mark a token as used
   */
  async markTokenAsUsed(plainToken: string): Promise<void> {
    const tokenHash = this.hashToken(plainToken);

    await this.db.execute(
      `UPDATE password_reset_tokens
       SET used = true
       WHERE tokenHash = ?`,
      [tokenHash]
    );
  }

  /**
   * Invalidate all unused tokens for a user
   */
  async invalidateUserTokens(userId: number): Promise<void> {
    await this.db.execute(
      `UPDATE password_reset_tokens
       SET used = true
       WHERE userId = ? AND used = false`,
      [userId]
    );
  }

  /**
   * Clean up expired tokens (should be called periodically)
   */
  async cleanupExpiredTokens(): Promise<number> {
    const result = await this.db.execute(
      `DELETE FROM password_reset_tokens
       WHERE expiresAt < NOW() OR (used = true AND createdAt < DATE_SUB(NOW(), INTERVAL 7 DAY))`,
      []
    );

    return (result as any).affectedRows || 0;
  }

  /**
   * Get token count for a user (for testing/debugging)
   */
  async getUserTokenCount(userId: number): Promise<number> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) as count
       FROM password_reset_tokens
       WHERE userId = ? AND used = false AND expiresAt > NOW()`,
      [userId]
    );

    return rows[0]?.count || 0;
  }
}

export const passwordResetService = new PasswordResetService();
