import { ONE_YEAR_MS } from "@shared/const";
import { ENV } from "../../_core/env";
import { getPasswordHasher } from "./passwordHasher";
import { userAuthRepository } from "../../repositories/mysql/UserAuthRepository.mysql";
import { createSessionToken } from "../../_core/googleAuth";
import type { UserAuthRepository } from "../../repositories/mysql/UserAuthRepository.mysql";
import { passwordResetService } from "./passwordResetService";
import { emailService } from "./emailService";

export type AuthResult = {
  token: string;
  user: {
    openId: string;
    email: string;
    name: string;
  };
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
    return Number.isFinite(sec) && sec > 0 ? sec * 1000 : ONE_YEAR_MS;
  }

  async registerWithPassword(input: {
    email: string;
    password: string;
    name?: string;
    role?: "user" | "admin";
  }): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();
    const hasher = await this.deps.hasherFactory(ENV.passwordHashAlgorithm);
    const passwordHash = await hasher.hash(input.password);

    const existing = await this.deps.repo.findByEmail(email);
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
      await this.deps.repo.createLocalUser({
        openId,
        email,
        name: input.name ?? null,
        passwordHash,
        role: input.role,
      });
    }

    const token = await this.deps.tokenIssuer(openId, {
      name: input.name || existing?.name || email.split("@")[0],
      email,
      expiresInMs: this.getTokenLifetimeMs(),
    });

    return {
      token,
      user: {
        openId,
        email,
        name: input.name || existing?.name || email.split("@")[0],
      },
    };
  }

  async loginWithPassword(input: {
    email: string;
    password: string;
  }): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();
    const user = await this.deps.repo.findByEmail(email);
    if (!user?.passwordHash) throw new Error("INVALID_CREDENTIALS");

    const hasher = await this.deps.hasherFactory(ENV.passwordHashAlgorithm);
    const ok = await hasher.verify(input.password, user.passwordHash);
    if (!ok) throw new Error("INVALID_CREDENTIALS");

    const token = await this.deps.tokenIssuer(user.openId, {
      name: user.name || email.split("@")[0],
      email,
      expiresInMs: this.getTokenLifetimeMs(),
    });

    return {
      token,
      user: {
        openId: user.openId,
        email,
        name: user.name || email.split("@")[0],
      },
    };
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

    // Verify current password
    const hasher = await this.deps.hasherFactory(ENV.passwordHashAlgorithm);
    const isValid = await hasher.verify(input.currentPassword, user.passwordHash);
    if (!isValid) {
      throw new Error("INVALID_CREDENTIALS");
    }

    // Hash new password
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
