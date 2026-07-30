import type { AiProviderId } from "../../platform/configuration/configurationDefaults";

export type AiChatRole = "system" | "user" | "assistant";

export type AiChatMessage = {
  role: AiChatRole;
  content: string;
};

export type AiChatRequest = {
  provider: AiProviderId;
  model: string;
  messages: AiChatMessage[];
  apiKey: string;
  /** Required for custom OpenAI-compatible endpoints. */
  baseUrl?: string;
  signal?: AbortSignal;
};

export type AiTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type AiChatChunk = {
  text?: string;
  done?: boolean;
  usage?: AiTokenUsage;
};

export type AiTestConnectionRequest = {
  provider: AiProviderId;
  model: string;
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
};

export type AiProviderErrorCode =
  | "unauthorized"
  | "not_found"
  | "rate_limit"
  | "quota"
  | "unavailable"
  | "invalid_request"
  | "network"
  | "cancelled"
  | "unknown";

export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;
  readonly provider: AiProviderId;
  readonly status?: number;

  constructor(
    message: string,
    options: {
      code: AiProviderErrorCode;
      provider: AiProviderId;
      status?: number;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "AiProviderError";
    this.code = options.code;
    this.provider = options.provider;
    this.status = options.status;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export type AiProviderClient = {
  chat(request: AiChatRequest): AsyncGenerator<AiChatChunk, void, undefined>;
  testConnection(request: AiTestConnectionRequest): Promise<void>;
};
