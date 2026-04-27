import type { RowDataPacket } from "mysql2/promise";
import { BaseRepository } from "../base/BaseRepository";

export type LocalAuthUser = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  role: "user" | "admin";
  loginMethod: string | null;
  passwordHash: string | null;
  remainingGenerations: number;
};

type LocalAuthUserRow = RowDataPacket & LocalAuthUser;

export class UserAuthRepository extends BaseRepository {
  async findByEmail(email: string): Promise<LocalAuthUser | null> {
    const rows = await this.db.query<LocalAuthUserRow[]>(
      `SELECT id, openId, name, email, role, loginMethod, passwordHash, remainingGenerations
       FROM users
       WHERE LOWER(email) = LOWER(?)
       LIMIT 1`,
      [email]
    );
    return rows[0] ?? null;
  }

  async createLocalUser(input: {
    openId: string;
    name?: string | null;
    email: string;
    passwordHash: string;
    role?: "user" | "admin";
  }): Promise<void> {
    await this.db.execute(
      `INSERT INTO users (openId, name, email, loginMethod, passwordHash, role, remainingGenerations, onboardingDone, lastSignedIn)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        input.openId,
        input.name ?? null,
        input.email,
        "local",
        input.passwordHash,
        input.role ?? "user",
        50,
        0,
      ]
    );
  }

  async setLocalPasswordByUserId(input: {
    userId: number;
    passwordHash: string;
  }): Promise<void> {
    await this.db.execute(
      `UPDATE users
       SET passwordHash = ?, loginMethod = IFNULL(loginMethod, 'local')
       WHERE id = ?`,
      [input.passwordHash, input.userId]
    );
  }

  async findById(userId: number): Promise<LocalAuthUser | null> {
    const rows = await this.db.query<LocalAuthUserRow[]>(
      `SELECT id, openId, name, email, role, loginMethod, passwordHash, remainingGenerations
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    return rows[0] ?? null;
  }

  async updateUserName(input: {
    userId: number;
    name: string;
  }): Promise<void> {
    await this.db.execute(
      `UPDATE users
       SET name = ?
       WHERE id = ?`,
      [input.name, input.userId]
    );
  }
}

export const userAuthRepository = new UserAuthRepository();
