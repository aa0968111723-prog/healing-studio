import { randomBytes, scrypt, timingSafeEqual } from "crypto";

type SupportedAlgorithm = "scrypt" | "bcrypt" | "argon2";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, storedHash: string): Promise<boolean>;
  algorithm: SupportedAlgorithm;
}

class ScryptPasswordHasher implements PasswordHasher {
  readonly algorithm = "scrypt" as const;
  private readonly keyLength = 64;
  private readonly params = {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
  } as const;

  private async derive(password: string, salt: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(
        password,
        salt,
        this.keyLength,
        this.params as any,
        (err, derivedKey) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(derivedKey as Buffer);
        }
      );
    });
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const derived = await this.derive(password, salt);
    return `scrypt$${salt}$${derived.toString("hex")}`;
  }

  async verify(password: string, storedHash: string): Promise<boolean> {
    const [algorithm, salt, expectedHash] = storedHash.split("$");
    if (algorithm !== "scrypt" || !salt || !expectedHash) return false;
    const derived = await this.derive(password, salt);
    return timingSafeEqual(
      derived,
      Buffer.from(expectedHash, "hex")
    );
  }
}

class BcryptPasswordHasher implements PasswordHasher {
  readonly algorithm = "bcrypt" as const;

  private constructor(
    private readonly bcrypt: {
      hash(input: string, rounds: number): Promise<string>;
      compare(input: string, hash: string): Promise<boolean>;
    }
  ) {}

  static async create(): Promise<BcryptPasswordHasher | null> {
    try {
      const mod = await dynamicImport("bcryptjs");
      return new BcryptPasswordHasher(mod.default ?? mod);
    } catch {
      return null;
    }
  }

  async hash(password: string): Promise<string> {
    return this.bcrypt.hash(password, 12);
  }

  async verify(password: string, storedHash: string): Promise<boolean> {
    return this.bcrypt.compare(password, storedHash);
  }
}

class Argon2PasswordHasher implements PasswordHasher {
  readonly algorithm = "argon2" as const;

  private constructor(
    private readonly argon2: {
      hash(input: string): Promise<string>;
      verify(hash: string, plain: string): Promise<boolean>;
    }
  ) {}

  static async create(): Promise<Argon2PasswordHasher | null> {
    try {
      const mod = await dynamicImport("argon2");
      return new Argon2PasswordHasher(mod.default ?? mod);
    } catch {
      return null;
    }
  }

  async hash(password: string): Promise<string> {
    return this.argon2.hash(password);
  }

  async verify(password: string, storedHash: string): Promise<boolean> {
    return this.argon2.verify(storedHash, password);
  }
}

let singleton: PasswordHasher | null = null;

const dynamicImport = new Function(
  "specifier",
  "return import(specifier);"
) as (specifier: string) => Promise<any>;

export async function getPasswordHasher(
  preferred: SupportedAlgorithm = "scrypt"
): Promise<PasswordHasher> {
  if (singleton) return singleton;

  if (preferred === "argon2") {
    const argon2 = await Argon2PasswordHasher.create();
    if (argon2) {
      singleton = argon2;
      return singleton;
    }
  }

  if (preferred === "bcrypt" || preferred === "argon2") {
    const bcrypt = await BcryptPasswordHasher.create();
    if (bcrypt) {
      singleton = bcrypt;
      return singleton;
    }
  }

  singleton = new ScryptPasswordHasher();
  return singleton;
}
