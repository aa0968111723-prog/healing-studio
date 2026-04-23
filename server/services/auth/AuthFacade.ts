import { ONE_YEAR_MS } from "@shared/const";
import { ENV } from "../../_core/env";
import { getPasswordHasher } from "./passwordHasher";
import { userAuthRepository } from "../../repositories/mysql/UserAuthRepository.mysql";
import { createSessionToken } from "../../_core/googleAuth";
import type { UserAuthRepository } from "../../repositories/mysql/UserAuthRepository.mysql";

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
}

export const authFacade = new AuthFacade();
