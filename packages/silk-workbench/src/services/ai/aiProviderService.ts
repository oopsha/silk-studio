import { ConfigurationService } from "../../platform/configuration/configurationService";
import type { AiProviderId } from "../../platform/configuration/configurationDefaults";
import { AiSecretService } from "./aiSecretService";
import {
  AiProviderError,
  type AiChatChunk,
  type AiChatMessage,
  type AiChatRequest,
  type AiProviderClient,
  type AiTestConnectionRequest,
} from "./aiProviderTypes";
import { anthropicClient } from "./providers/anthropicClient";
import { geminiClient } from "./providers/geminiClient";
import {
  customOpenAiClient,
  openaiClient,
} from "./providers/openaiCompatibleClient";

const CLIENTS: Record<AiProviderId, AiProviderClient> = {
  gemini: geminiClient,
  openai: openaiClient,
  anthropic: anthropicClient,
  custom: customOpenAiClient,
};

export function getAiProviderClient(provider: AiProviderId): AiProviderClient {
  return CLIENTS[provider];
}

export type AiReadyState =
  | { ready: true }
  | {
      ready: false;
      reason: "disabled" | "missing_key" | "missing_model" | "missing_base_url";
      message: string;
    };

export function getAiReadyState(): AiReadyState {
  const enabled = ConfigurationService.getValue("ai.enabled");
  if (!enabled) {
    return {
      ready: false,
      reason: "disabled",
      message: "AI assistant is disabled. Enable it in Settings.",
    };
  }

  const provider = ConfigurationService.getValue("ai.provider");
  const model = ConfigurationService.getValue("ai.model").trim();
  if (!model) {
    return {
      ready: false,
      reason: "missing_model",
      message: "Choose a model in Settings to use AI Chat.",
    };
  }

  if (provider === "custom") {
    const baseUrl = ConfigurationService.getValue("ai.customBaseUrl").trim();
    if (!baseUrl) {
      return {
        ready: false,
        reason: "missing_base_url",
        message: "Set a Custom base URL in Settings.",
      };
    }
  }

  if (!AiSecretService.hasApiKey(provider)) {
    return {
      ready: false,
      reason: "missing_key",
      message: "Configure an API key in Settings to use AI Chat.",
    };
  }

  return { ready: true };
}

export async function createConfiguredChatRequest(
  messages: AiChatMessage[],
  options?: { signal?: AbortSignal },
): Promise<AiChatRequest> {
  const ready = getAiReadyState();
  if (!ready.ready) {
    throw new AiProviderError(ready.message, {
      code: "invalid_request",
      provider: ConfigurationService.getValue("ai.provider"),
    });
  }

  const provider = ConfigurationService.getValue("ai.provider");
  const apiKey = await AiSecretService.getApiKey(provider);
  if (!apiKey) {
    throw new AiProviderError("Configure an API key in Settings to use AI Chat.", {
      code: "unauthorized",
      provider,
    });
  }

  return {
    provider,
    model: ConfigurationService.getValue("ai.model").trim(),
    messages,
    apiKey,
    baseUrl:
      provider === "custom"
        ? ConfigurationService.getValue("ai.customBaseUrl")
        : undefined,
    signal: options?.signal,
  };
}

export async function* streamConfiguredChat(
  messages: AiChatMessage[],
  options?: { signal?: AbortSignal },
): AsyncGenerator<AiChatChunk, void, undefined> {
  const request = await createConfiguredChatRequest(messages, options);
  const client = getAiProviderClient(request.provider);
  yield* client.chat(request);
}

export async function testConfiguredConnection(options?: {
  apiKey?: string;
  signal?: AbortSignal;
}): Promise<void> {
  const provider = ConfigurationService.getValue("ai.provider");
  const model = ConfigurationService.getValue("ai.model").trim();
  if (!model) {
    throw new AiProviderError("Choose a model before testing the connection.", {
      code: "invalid_request",
      provider,
    });
  }

  if (provider === "custom") {
    const baseUrl = ConfigurationService.getValue("ai.customBaseUrl").trim();
    if (!baseUrl) {
      throw new AiProviderError("Set a Custom base URL before testing.", {
        code: "invalid_request",
        provider,
      });
    }
  }

  const apiKey = (options?.apiKey ?? (await AiSecretService.getApiKey(provider))).trim();
  if (!apiKey) {
    throw new AiProviderError("Enter or save an API key before testing.", {
      code: "unauthorized",
      provider,
    });
  }

  const request: AiTestConnectionRequest = {
    provider,
    model,
    apiKey,
    baseUrl:
      provider === "custom"
        ? ConfigurationService.getValue("ai.customBaseUrl")
        : undefined,
    signal: options?.signal,
  };

  await getAiProviderClient(provider).testConnection(request);
}
