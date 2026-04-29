import { TRPCError } from "@trpc/server";
import { afterEach, describe, expect, it } from "vitest";
import { assertAllowedEndpoint } from "../agentToolExecutor";

describe("assertAllowedEndpoint", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowOrigins = process.env.ORB_TOOL_ALLOWED_ORIGINS;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;

    if (originalAllowOrigins === undefined) delete process.env.ORB_TOOL_ALLOWED_ORIGINS;
    else process.env.ORB_TOOL_ALLOWED_ORIGINS = originalAllowOrigins;
  });

  it("throws PRECONDITION_FAILED when ORB_TOOL_ALLOWED_ORIGINS is empty in production", () => {
    process.env.NODE_ENV = "production";
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "";

    let err: unknown;
    try {
      assertAllowedEndpoint("https://api.director.today/tools");
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("PRECONDITION_FAILED");
    expect((err as TRPCError).message).toContain("NODE_ENV=production");
    expect((err as TRPCError).message).toContain(".env.example");
  });

  it("passes when endpoint origin is in allowlist", () => {
    process.env.NODE_ENV = "production";
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://director.today,https://api.director.today";

    expect(() => {
      assertAllowedEndpoint("https://api.director.today/v1/weather");
    }).not.toThrow();
  });
});
