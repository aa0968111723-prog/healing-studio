/**
 * loginHistoryService.ts — Login attempt tracking service
 *
 * Tracks login attempts (success and failures) with device/location information
 * for security monitoring and anomaly detection.
 */

import type { RowDataPacket } from "mysql2/promise";
import { BaseRepository } from "../../repositories/base/BaseRepository";

export interface LoginAttempt {
  userId: number;
  email?: string;
  success: boolean;
  ipAddress?: string;
  userAgent?: string;
  device?: string;
  browser?: string;
  os?: string;
  country?: string;
  city?: string;
  failureReason?: string;
}

export interface LoginHistoryRecord {
  id: number;
  userId: number;
  email: string | null;
  success: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  country: string | null;
  city: string | null;
  failureReason: string | null;
  createdAt: Date;
}

type LoginHistoryRow = RowDataPacket & LoginHistoryRecord;

export class LoginHistoryService extends BaseRepository {
  /**
   * Parse user agent string to extract device, browser, and OS info
   */
  private parseUserAgent(userAgent?: string): {
    device?: string;
    browser?: string;
    os?: string;
  } {
    if (!userAgent) return {};

    const result: { device?: string; browser?: string; os?: string } = {};

    // Detect device
    if (/mobile/i.test(userAgent)) {
      result.device = "Mobile";
    } else if (/tablet|ipad/i.test(userAgent)) {
      result.device = "Tablet";
    } else {
      result.device = "Desktop";
    }

    // Detect browser
    if (/edg/i.test(userAgent)) {
      result.browser = "Edge";
    } else if (/chrome/i.test(userAgent) && !/edg/i.test(userAgent)) {
      result.browser = "Chrome";
    } else if (/firefox/i.test(userAgent)) {
      result.browser = "Firefox";
    } else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) {
      result.browser = "Safari";
    } else {
      result.browser = "Other";
    }

    // Detect OS
    if (/windows/i.test(userAgent)) {
      result.os = "Windows";
    } else if (/mac/i.test(userAgent)) {
      result.os = "macOS";
    } else if (/linux/i.test(userAgent)) {
      result.os = "Linux";
    } else if (/android/i.test(userAgent)) {
      result.os = "Android";
    } else if (/ios|iphone|ipad/i.test(userAgent)) {
      result.os = "iOS";
    } else {
      result.os = "Other";
    }

    return result;
  }

  /**
   * Record a login attempt
   */
  async recordLoginAttempt(attempt: LoginAttempt): Promise<void> {
    const parsed = this.parseUserAgent(attempt.userAgent);

    await this.db.execute(
      `INSERT INTO login_history
       (userId, email, success, ipAddress, userAgent, device, browser, os, country, city, failureReason, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        attempt.userId,
        attempt.email || null,
        attempt.success,
        attempt.ipAddress || null,
        attempt.userAgent || null,
        parsed.device || null,
        parsed.browser || null,
        parsed.os || null,
        attempt.country || null,
        attempt.city || null,
        attempt.failureReason || null,
      ]
    );
  }

  /**
   * Get login history for a user
   */
  async getUserLoginHistory(
    userId: number,
    limit: number = 20
  ): Promise<LoginHistoryRecord[]> {
    const rows = await this.db.query<LoginHistoryRow[]>(
      `SELECT id, userId, email, success, ipAddress, userAgent, device, browser, os, country, city, failureReason, createdAt
       FROM login_history
       WHERE userId = ?
       ORDER BY createdAt DESC
       LIMIT ?`,
      [userId, limit]
    );

    return rows;
  }

  /**
   * Get recent failed login attempts for a user
   */
  async getRecentFailedAttempts(
    userId: number,
    withinMinutes: number = 30
  ): Promise<LoginHistoryRecord[]> {
    const rows = await this.db.query<LoginHistoryRow[]>(
      `SELECT id, userId, email, success, ipAddress, userAgent, device, browser, os, country, city, failureReason, createdAt
       FROM login_history
       WHERE userId = ?
         AND success = false
         AND createdAt > DATE_SUB(NOW(), INTERVAL ? MINUTE)
       ORDER BY createdAt DESC`,
      [userId, withinMinutes]
    );

    return rows;
  }

  /**
   * Detect unusual login activity (new location or device)
   */
  async isUnusualLoginActivity(
    userId: number,
    ipAddress?: string,
    userAgent?: string
  ): Promise<boolean> {
    if (!ipAddress && !userAgent) return false;

    const parsed = this.parseUserAgent(userAgent);

    // Check if this IP or device/browser/OS combination has been used before
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) as count
       FROM login_history
       WHERE userId = ?
         AND success = true
         AND (
           ipAddress = ?
           OR (device = ? AND browser = ? AND os = ?)
         )
       LIMIT 1`,
      [userId, ipAddress || "", parsed.device || "", parsed.browser || "", parsed.os || ""]
    );

    return (rows[0]?.count || 0) === 0;
  }

  /**
   * Get failed login attempts by email (for rate limiting)
   */
  async getFailedAttemptsByEmail(
    email: string,
    withinMinutes: number = 30
  ): Promise<number> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) as count
       FROM login_history
       WHERE LOWER(email) = LOWER(?)
         AND success = false
         AND createdAt > DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [email, withinMinutes]
    );

    return rows[0]?.count || 0;
  }

  /**
   * Get failed login attempts scoped to a specific (email, IP) pair — AIDV-264.
   * This prevents a remote attacker from locking out a victim's account:
   * only the attacker's own IP gets throttled, while the victim can still
   * authenticate from their IP (where failure count remains 0).
   */
  async getFailedAttemptsByEmailAndIp(
    email: string,
    ipAddress: string,
    withinMinutes: number = 30
  ): Promise<number> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) as count
       FROM login_history
       WHERE LOWER(email) = LOWER(?)
         AND ipAddress = ?
         AND success = false
         AND createdAt > DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [email, ipAddress, withinMinutes]
    );

    return rows[0]?.count || 0;
  }

  /**
   * Get failed login attempts from a specific IP — AIDV-264 IP-only lockout.
   * Blocks IPs doing brute-force scans across many different emails.
   * Index: lh_ip_createdAt_idx (migration 0092).
   */
  async getFailedAttemptsByIp(
    ipAddress: string,
    withinMinutes: number = 1
  ): Promise<number> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) as count
       FROM login_history
       WHERE ipAddress = ?
         AND success = false
         AND createdAt > DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [ipAddress, withinMinutes]
    );

    return rows[0]?.count || 0;
  }

  /**
   * Clean up old login history (keep last 90 days)
   */
  async cleanupOldHistory(daysToKeep: number = 90): Promise<number> {
    const result = await this.db.execute(
      `DELETE FROM login_history
       WHERE createdAt < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [daysToKeep]
    );

    return (result as any).affectedRows || 0;
  }
}

export const loginHistoryService = new LoginHistoryService();
