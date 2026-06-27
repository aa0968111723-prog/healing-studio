import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEPRECATED_ENV_VARS, validateEnvConfig } from "./config-check";

describe("validateEnvConfig (AIDV-342)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const key of DEPRECATED_ENV_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of DEPRECATED_ENV_VARS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    warnSpy.mockRestore();
  });

  it("emits no warnings when no deprecated vars are set", () => {
    validateEnvConfig();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns when GOTRUE_JWT_ADMIN_GROUP_NAME is set", () => {
    process.env["GOTRUE_JWT_ADMIN_GROUP_NAME"] = "admin";
    validateEnvConfig();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("GOTRUE_JWT_ADMIN_GROUP_NAME");
    expect(warnSpy.mock.calls[0][0]).toContain("AIDV-342");
  });

  it("warns when GOTRUE_JWT_DEFAULT_GROUP_NAME is set", () => {
    process.env["GOTRUE_JWT_DEFAULT_GROUP_NAME"] = "user";
    validateEnvConfig();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("GOTRUE_JWT_DEFAULT_GROUP_NAME");
  });

  it("warns for each deprecated var independently", () => {
    process.env["GOTRUE_JWT_ADMIN_GROUP_NAME"] = "admin";
    process.env["GOTRUE_JWT_DEFAULT_GROUP_NAME"] = "user";
    process.env["GOTRUE_OPERATOR_TOKEN"] = "secret";
    validateEnvConfig();
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it("DEPRECATED_ENV_VARS includes both GoTrue JWT group keys", () => {
    expect(DEPRECATED_ENV_VARS).toContain("GOTRUE_JWT_ADMIN_GROUP_NAME");
    expect(DEPRECATED_ENV_VARS).toContain("GOTRUE_JWT_DEFAULT_GROUP_NAME");
    expect(DEPRECATED_ENV_VARS).toContain("GOTRUE_OPERATOR_TOKEN");
  });
});
