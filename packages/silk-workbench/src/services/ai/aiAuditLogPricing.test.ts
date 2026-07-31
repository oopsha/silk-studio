import { describe, expect, it } from "vitest";
import {
  estimateAiCostUsd,
  formatEstimatedCostUsd,
  resolveAiModelPricing,
} from "./aiAuditLogPricing";

describe("resolveAiModelPricing", () => {
  it("uses known model rates", () => {
    expect(resolveAiModelPricing("openai", "gpt-4o-mini")).toEqual({
      inputPerMillionUsd: 0.15,
      outputPerMillionUsd: 0.6,
    });
  });

  it("falls back to provider default for unknown models", () => {
    expect(resolveAiModelPricing("gemini", "models/unknown-flash")).toEqual({
      inputPerMillionUsd: 0.3,
      outputPerMillionUsd: 2.5,
    });
  });
});

describe("estimateAiCostUsd", () => {
  it("returns undefined without token counts", () => {
    expect(estimateAiCostUsd("openai", "gpt-4o-mini")).toBeUndefined();
  });

  it("estimates from input/output tokens", () => {
    // 1M input + 1M output at gpt-4o-mini rates → 0.15 + 0.6 = 0.75
    expect(estimateAiCostUsd("openai", "gpt-4o-mini", 1_000_000, 1_000_000)).toBeCloseTo(
      0.75,
      5,
    );
  });
});

describe("formatEstimatedCostUsd", () => {
  it("formats tiers", () => {
    expect(formatEstimatedCostUsd(undefined)).toBe("—");
    expect(formatEstimatedCostUsd(0.00001)).toBe("<$0.0001");
    expect(formatEstimatedCostUsd(0.0012)).toBe("$0.0012");
    expect(formatEstimatedCostUsd(0.1234)).toBe("$0.123");
  });
});
