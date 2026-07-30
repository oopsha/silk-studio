import type { AiProviderId } from "../../platform/configuration/configurationDefaults";

/** USD per 1M tokens — rough list prices for estimation only (not billing). */
export type AiModelPricing = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
};

const MODEL_PRICING: Record<string, AiModelPricing> = {
  // Gemini (approx AI Studio / paid tier ballpark)
  "gemini-3.5-flash": { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 },
  "gemini-3.6-flash": { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 },
  "gemini-3.1-flash-lite": { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },
  // OpenAI
  "gpt-4o": { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 },
  "gpt-4o-mini": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
  "gpt-4.1": { inputPerMillionUsd: 2, outputPerMillionUsd: 8 },
  "o3-mini": { inputPerMillionUsd: 1.1, outputPerMillionUsd: 4.4 },
  // Anthropic
  "claude-sonnet-4-20250514": {
    inputPerMillionUsd: 3,
    outputPerMillionUsd: 15,
  },
  "claude-3-5-haiku-20241022": {
    inputPerMillionUsd: 0.8,
    outputPerMillionUsd: 4,
  },
};

const PROVIDER_DEFAULT: Record<AiProviderId, AiModelPricing> = {
  gemini: { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 },
  openai: { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
  anthropic: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  custom: { inputPerMillionUsd: 1, outputPerMillionUsd: 3 },
};

export function resolveAiModelPricing(
  provider: AiProviderId,
  model: string,
): AiModelPricing {
  const key = model.trim().replace(/^models\//i, "");
  return MODEL_PRICING[key] ?? PROVIDER_DEFAULT[provider];
}

/** Returns undefined when neither token count is known. */
export function estimateAiCostUsd(
  provider: AiProviderId,
  model: string,
  inputTokens?: number,
  outputTokens?: number,
): number | undefined {
  const hasInput = typeof inputTokens === "number" && Number.isFinite(inputTokens);
  const hasOutput =
    typeof outputTokens === "number" && Number.isFinite(outputTokens);
  if (!hasInput && !hasOutput) return undefined;

  const pricing = resolveAiModelPricing(provider, model);
  const input = hasInput ? Math.max(0, inputTokens!) : 0;
  const output = hasOutput ? Math.max(0, outputTokens!) : 0;
  return (
    (input / 1_000_000) * pricing.inputPerMillionUsd +
    (output / 1_000_000) * pricing.outputPerMillionUsd
  );
}

export function formatEstimatedCostUsd(cost: number | undefined): string {
  if (cost === undefined || !Number.isFinite(cost)) return "—";
  if (cost < 0.0001) return "<$0.0001";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}
