/**
 * emailVerificationService.ts — Email verification token management
 *
 * Handles generation, validation, and cleanup of email verification tokens.
 */

import { randomBytes, createHash } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import { BaseRepository } from "../../repositories/base/BaseRepository";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface EmailVerificationTokenData {
  id: number;
  userId: number;
  newEmail: string;
  tokenHash: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

type EmailVerificationTokenRow = RowDataPacket & EmailVerificationTokenData;

export class EmailVerificationService extends BaseRepository {
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
   * Create an email verification token for a user
   */
  async createVerificationToken(
    userId: number,
    newEmail: string
  ): Promise<string> {
    const plainToken = this.generateToken();
    const tokenHash = this.hashToken(plainToken);
    const expiresAt = new Date(Date.now() + ONE_DAY_MS);

    await this.db.execute(
      `INSERT INTO email_verification_tokens (userId, newEmail, tokenHash, expiresAt, used, createdAt)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [userId, newEmail, tokenHash, expiresAt, false]
    );

    return plainToken;
  }

  /**
   * Validate an email verification token
   * Returns { userId, newEmail } if valid, null otherwise
   */
  async validateToken(plainToken: string): Promise<{
    userId: number;
    newEmail: string;
  } | null> {
    const tokenHash = this.hashToken(plainToken);

    const rows = await this.db.query<EmailVerificationTokenRow[]>(
      `SELECT id, userId, newEmail, tokenHash, expiresAt, used, createdAt
       FROM email_verification_tokens
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

    return {
      userId: token.userId,
      newEmail: token.newEmail,
    };
  }

  /**
   * Mark a token as used
   */
  async markTokenAsUsed(plainToken: string): Promise<void> {
    const tokenHash = this.hashToken(plainToken);

    await this.db.execute(
      `UPDATE email_verification_tokens
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
      `UPDATE email_verification_tokens
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
      `DELETE FROM email_verification_tokens
       WHERE expiresAt < NOW() OR (used = true AND createdAt < DATE_SUB(NOW(), INTERVAL 7 DAY))`,
      []
    );

    return (result as any).affectedRows || 0;
  }
}

export const emailVerificationService = new EmailVerificationService();
