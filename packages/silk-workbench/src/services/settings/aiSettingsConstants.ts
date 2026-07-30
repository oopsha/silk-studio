import type { AiProviderId } from "../../platform/configuration/configurationDefaults";

export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
  custom: "Custom (OpenAI-compatible)",
};

/** Models Google no longer offers to new API keys (returns 404). */
const GEMINI_RETIRED_FOR_NEW_USERS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
]);

export const AI_MODEL_PRESETS: Record<AiProviderId, readonly string[]> = {
  gemini: [
    "gemini-3.5-flash",
    "gemini-3.6-flash",
    "gemini-3.1-flash-lite",
  ],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3-mini"],
  anthropic: [
    "claude-sonnet-4-20250514",
    "claude-3-5-haiku-20241022",
  ],
  custom: [],
};

export const AI_DEFAULT_MODEL: Record<AiProviderId, string> = {
  gemini: "gemini-3.5-flash",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  custom: "",
};

export const AI_API_KEY_PLACEHOLDERS: Record<AiProviderId, string> = {
  gemini: "AIza...",
  openai: "sk-...",
  anthropic: "sk-ant-...",
  custom: "API key",
};

export function getAiModelOptions(provider: AiProviderId): readonly string[] {
  return AI_MODEL_PRESETS[provider];
}

export function resolveAiModelForProvider(
  provider: AiProviderId,
  model: string,
): string {
  const trimmed = model.trim().replace(/^models\//i, "");
  if (provider === "custom") {
    return trimmed;
  }
  const presets = AI_MODEL_PRESETS[provider];
  if (provider === "gemini" && GEMINI_RETIRED_FOR_NEW_USERS.has(trimmed)) {
    return AI_DEFAULT_MODEL.gemini;
  }
  if (presets.includes(trimmed)) {
    return trimmed;
  }
  return AI_DEFAULT_MODEL[provider];
}
