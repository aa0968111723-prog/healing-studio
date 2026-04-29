import { describe, expect, it } from "vitest";
import { isValidCronExpression } from "../orbScheduler";

describe("orbScheduler.isValidCronExpression", () => {
  it("accepts standard 5-field cron expressions", () => {
    expect(isValidCronExpression("0 9 * * *")).toBe(true);
    expect(isValidCronExpression("*/15 * * * *")).toBe(true);
    expect(isValidCronExpression("0 0 1 * *")).toBe(true);
    expect(isValidCronExpression("0 9 * * 1-5")).toBe(true);
  });

  it("rejects obviously bad input", () => {
    expect(isValidCronExpression("not a cron")).toBe(false);
    expect(isValidCronExpression("")).toBe(false);
    expect(isValidCronExpression("99 99 99 99 99")).toBe(false);
  });
});
