import type { AiProviderId } from "../../platform/configuration/configurationDefaults";

export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  custom: "Custom (OpenAI-compatible)",
};

export const AI_MODEL_PRESETS: Record<AiProviderId, readonly string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3-mini"],
  anthropic: [
    "claude-sonnet-4-20250514",
    "claude-3-5-haiku-20241022",
  ],
  custom: [],
};

export const AI_DEFAULT_MODEL: Record<AiProviderId, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  custom: "",
};

export function getAiModelOptions(provider: AiProviderId): readonly string[] {
  return AI_MODEL_PRESETS[provider];
}

export function resolveAiModelForProvider(
  provider: AiProviderId,
  model: string,
): string {
  const presets = AI_MODEL_PRESETS[provider];
  if (provider === "custom") {
    return model.trim();
  }
  if (presets.includes(model)) {
    return model;
  }
  return AI_DEFAULT_MODEL[provider];
}
