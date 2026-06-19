import { THIRTY_DAYS_MS, type UserRole } from "@shared/const";
import { ENV } from "../../_core/env";
import { getPasswordHasher, verifyPassword } from "./passwordHasher";
import { userAuthRepository } from "../../repositories/mysql/UserAuthRepository.mysql";
import { createSessionToken } from "../../_core/googleAuth";
import type { UserAuthRepository } from "../../repositories/mysql/UserAuthRepository.mysql";
import { passwordResetService } from "./passwordResetService";
import { emailService } from "./emailService";
import {
  buildOtpAuthUri,
  generateBase32Secret,
  verifyTotp,
} from "./totpService";

export type AuthResult = {
  token: string;
  userId: number;
  user: {
    openId: string;
    email: string;
    name: string;
  };
  /**
   * True when registerWithPassword attached a password to a pre-existing
   * Google-only account (no new row created). Lets the UI explain that the
   * existing Google account is now also reachable via email/password.
   */
  linkedExisting?: boolean;
};

/** Returned when a user has 2FA enabled — caller must collect a TOTP code. */
export type TwoFactorRequired = {
  requiresTwoFactor: true;
  userId: number;
};

export class AuthFacade {
  constructor(
    private readonly deps: {
      repo: UserAuthRepository;
      hasherFactory: typeof getPasswordHasher;
      tokenIssuer: typeof createSessionToken;
    } = {
      repo: userAuthRepository,
      hasherFactory: getPasswordHasher,
      tokenIssuer: createSessionToken,
    }
  ) {}

  private getTokenLifetimeMs(): number {
    const sec = Number(ENV.jwtAccessTokenExpiresIn);
    // AIDV-59：env 無效時退回 30 天預設（非 ~1 年）。
    return Number.isFinite(sec) && sec > 0 ? sec * 1000 : THIRTY_DAYS_MS;
  }

  async registerWithPassword(input: {
    email: string;
    password: string;
    name?: string;
    role?: UserRole;
  }): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();
    const hasher = await this.deps.hasherFactory(ENV.passwordHashAlgorithm);
    const passwordHash = await hasher.hash(input.password);

    let existing = await this.deps.repo.findByEmail(email);
    const openId = existing?.openId ?? `local:${email}`;

    if (existing?.passwordHash) {
      throw new Error("EMAIL_ALREADY_REGISTERED");
    }

    if (existing) {
      await this.deps.repo.setLocalPasswordByUserId({
        userId: existing.id,
        passwordHash,
      });
    } else {
      try {
        const insertedId = await this.deps.repo.createLocalUser({
          openId,
          email,
          name: input.name ?? null,
          passwordHash,
          role: input.role,
        });
        // Use the real insertId so callers receive the correct userId
        const resolvedId = insertedId ?? 0;
        const token = await this.deps.tokenIssuer(openId, {
          name: input.name || email.split("@")[0],
          email,
          expiresInMs: this.getTokenLifetimeMs(),
        });
        return {
          token,
          userId: resolvedId,
          user: {
            openId,
            email,
            name: input.name || email.split("@")[0],
          },
          linkedExisting: false,
        };
      } catch (err) {
        // Race / case-insensitive miss: another concurrent request may have
        // created the row, or findByEmail missed it. On a duplicate-key
        // collision, recover by re-fetching and linking the password rather
        // than failing the user with a generic 500.
        const code = (err as { code?: string; errorCode?: string }).code ||
          (err as { errorCode?: string }).errorCode;
        if (code === "ER_DUP_ENTRY") {
          existing = await this.deps.repo.findByEmail(email);
          if (existing?.passwordHash) {
            throw new Error("EMAIL_ALREADY_REGISTERED");
          }
          if (existing) {
            await this.deps.repo.setLocalPasswordByUserId({
              userId: existing.id,
              passwordHash,
            });
          } else {
            // Genuinely orphaned duplicate (different email casing on a
            // unique openId index) — surface the original error.
            throw err;
          }
        } else {
          throw err;
        }
      }
    }

    const token = await this.deps.tokenIssuer(openId, {
      name: input.name || existing?.name || email.split("@")[0],
      email,
      expiresInMs: this.getTokenLifetimeMs(),
    });

    return {
      token,
      userId: existing?.id ?? 0,
      user: {
        openId,
        email,
        name: input.name || existing?.name || email.split("@")[0],
      },
      // True branch: existing OAuth-only account just got a local password.
      linkedExisting: !!existing,
    };
  }

  async loginWithPassword(input: {
    email: string;
    password: string;
    /** When provided, also satisfies the 2FA challenge in a single round-trip. */
    totpToken?: string;
  }): Promise<AuthResult | TwoFactorRequired> {
    const email = input.email.trim().toLowerCase();
    const user = await this.deps.repo.findByEmail(email);
    if (!user) throw new Error("INVALID_CREDENTIALS");
    // Account exists but only via OAuth — the user almost certainly wants
    // Google sign-in. Distinguish from "wrong password" so the UI can
    // redirect them rather than blame the password.
    if (!user.passwordHash) throw new Error("OAUTH_ONLY_ACCOUNT");

    // Use automatic algorithm detection to support legacy hashes
    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) throw new Error("INVALID_CREDENTIALS");

    // ── 2FA gate ──
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      if (!input.totpToken) {
        return { requiresTwoFactor: true, userId: user.id };
      }
      if (!verifyTotp(user.twoFactorSecret, input.totpToken)) {
        throw new Error("INVALID_2FA_CODE");
      }
    }

    // Update last signed-in timestamp (fire-and-forget; never blocks login)
    this.deps.repo.updateLastSignedIn(user.id).catch(() => {});

    const token = await this.deps.tokenIssuer(user.openId, {
      name: user.name || email.split("@")[0],
      email,
      expiresInMs: this.getTokenLifetimeMs(),
    });

    return {
      token,
      userId: user.id,
      user: {
        openId: user.openId,
        email,
        name: user.name || email.split("@")[0],
      },
    };
  }

  /**
   * Stage-1 2FA setup: generate a fresh TOTP secret for an authenticated user
   * and return the otpauth URI for QR code rendering. The secret is stored
   * but `twoFactorEnabled` stays false until verifyTwoFactor succeeds.
   */
  async beginTwoFactorSetup(userId: number): Promise<{
    secret: string;
    otpAuthUri: string;
  }> {
    const user = await this.deps.repo.findById(userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    if (!user.email) throw new Error("USER_NOT_FOUND");

    const secret = generateBase32Secret();
    await this.deps.repo.setTwoFactorSecret({
      userId,
      secret,
      enabled: false,
    });

    return {
      secret,
      otpAuthUri: buildOtpAuthUri({
        secret,
        account: user.email,
      }),
    };
  }

  /**
   * Stage-2 2FA setup: verify the user can produce a valid TOTP from their
   * authenticator app, then flip twoFactorEnabled on.
   */
  async confirmTwoFactor(input: {
    userId: number;
    token: string;
  }): Promise<void> {
    const user = await this.deps.repo.findById(input.userId);
    if (!user?.twoFactorSecret) throw new Error("TWO_FACTOR_NOT_INITIALIZED");
    if (!verifyTotp(user.twoFactorSecret, input.token)) {
      throw new Error("INVALID_2FA_CODE");
    }
    await this.deps.repo.setTwoFactorSecret({
      userId: input.userId,
      secret: user.twoFactorSecret,
      enabled: true,
    });
  }

  /**
   * Disable 2FA. Requires a current TOTP from the existing secret to prevent
   * an attacker with only a session cookie from removing the second factor.
   */
  async disableTwoFactor(input: {
    userId: number;
    token: string;
  }): Promise<void> {
    const user = await this.deps.repo.findById(input.userId);
    if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
      throw new Error("TWO_FACTOR_NOT_ENABLED");
    }
    if (!verifyTotp(user.twoFactorSecret, input.token)) {
      throw new Error("INVALID_2FA_CODE");
    }
    await this.deps.repo.setTwoFactorSecret({
      userId: input.userId,
      secret: null,
      enabled: false,
    });
  }

  async getTwoFactorStatus(userId: number): Promise<{ enabled: boolean }> {
    const user = await this.deps.repo.findById(userId);
    return { enabled: Boolean(user?.twoFactorEnabled) };
  }

  /**
   * Find user by email (helper for login history)
   */
  async findUserByEmail(email: string): Promise<{ id: number } | null> {
    const user = await this.deps.repo.findByEmail(email.trim().toLowerCase());
    return user ? { id: user.id } : null;
  }

  /**
   * Request password reset - generates token and sends email
   */
  async requestPasswordReset(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();

    // Check rate limiting
    if (!passwordResetService.checkRateLimit(normalizedEmail)) {
      throw new Error("RATE_LIMIT_EXCEEDED");
    }

    const user = await this.deps.repo.findByEmail(normalizedEmail);

    // Always return success to prevent email enumeration
    if (!user || !user.passwordHash) {
      // User doesn't exist or doesn't have password auth set up
      // Still return success to prevent email enumeration attacks
      return;
    }

    // Invalidate any existing unused tokens
    await passwordResetService.invalidateUserTokens(user.id);

    // Generate new reset token
    const resetToken = await passwordResetService.createResetToken(user.id);

    // Send reset email
    await emailService.sendPasswordReset(normalizedEmail, resetToken);
  }

  /**
   * Reset password using a token
   */
  async resetPasswordWithToken(token: string, newPassword: string): Promise<void> {
    // Validate token
    const userId = await passwordResetService.validateToken(token);
    if (!userId) {
      throw new Error("INVALID_OR_EXPIRED_TOKEN");
    }

    // Hash new password
    const hasher = await this.deps.hasherFactory(ENV.passwordHashAlgorithm);
    const passwordHash = await hasher.hash(newPassword);

    // Update password
    await this.deps.repo.setLocalPasswordByUserId({
      userId,
      passwordHash,
    });

    // Mark token as used
    await passwordResetService.markTokenAsUsed(token);

    // Invalidate all other tokens for this user
    await passwordResetService.invalidateUserTokens(userId);

    // Get user info to send confirmation email
    const user = await this.deps.repo.findById(userId);
    if (user?.email) {
      await emailService.sendPasswordChanged(user.email, user.name || undefined);
    }
  }

  /**
   * Change password (requires current password verification)
   */
  async changePassword(input: {
    email: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = await this.deps.repo.findByEmail(normalizedEmail);

    if (!user?.passwordHash) {
      throw new Error("INVALID_CREDENTIALS");
    }

    // Verify current password with automatic algorithm detection
    const isValid = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!isValid) {
      throw new Error("INVALID_CREDENTIALS");
    }

    // Hash new password
    const hasher = await this.deps.hasherFactory(ENV.passwordHashAlgorithm);
    const newPasswordHash = await hasher.hash(input.newPassword);

    // Update password
    await this.deps.repo.setLocalPasswordByUserId({
      userId: user.id,
      passwordHash: newPasswordHash,
    });

    // Invalidate all reset tokens
    await passwordResetService.invalidateUserTokens(user.id);

    // Send confirmation email
    await emailService.sendPasswordChanged(normalizedEmail, user.name || undefined);
  }

  /**
   * Update user profile
   */
  async updateProfile(input: {
    email: string;
    name?: string;
  }): Promise<{ name: string }> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = await this.deps.repo.findByEmail(normalizedEmail);

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    if (input.name !== undefined) {
      await this.deps.repo.updateUserName({
        userId: user.id,
        name: input.name,
      });
    }

    return {
      name: input.name ?? user.name ?? "",
    };
  }
}

export const authFacade = new AuthFacade();
