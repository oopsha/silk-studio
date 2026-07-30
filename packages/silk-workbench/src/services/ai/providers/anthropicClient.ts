import { aiHttpFetch } from "../aiHttpBridge";
import {
  AiProviderError,
  type AiChatChunk,
  type AiChatRequest,
  type AiProviderClient,
  type AiTestConnectionRequest,
} from "../aiProviderTypes";
import {
  mapHttpError,
  parseSseText,
  splitSystemMessages,
} from "../aiProviderHttp";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

async function* streamAnthropic(
  request: AiChatRequest,
): AsyncGenerator<AiChatChunk, void, undefined> {
  const model = request.model.trim();
  if (!model) {
    throw new AiProviderError("Model is required.", {
      code: "invalid_request",
      provider: "anthropic",
    });
  }

  const { system, rest } = splitSystemMessages(request.messages);
  if (rest.length === 0) {
    throw new AiProviderError("At least one user message is required.", {
      code: "invalid_request",
      provider: "anthropic",
    });
  }

  const body: Record<string, unknown> = {
    model,
    max_tokens: 1024,
    stream: true,
    messages: rest.map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    })),
  };
  if (system) {
    body.system = system;
  }

  let response;
  try {
    response = await aiHttpFetch({
      url: ANTHROPIC_URL,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": request.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });
  } catch (error) {
    if (isAbortError(error) || request.signal?.aborted) {
      throw new AiProviderError("Request cancelled.", {
        code: "cancelled",
        provider: "anthropic",
        cause: error,
      });
    }
    throw new AiProviderError(
      error instanceof Error
        ? error.message
        : "Network error while contacting Anthropic.",
      {
        code: "network",
        provider: "anthropic",
        cause: error,
      },
    );
  }

  if (!response.ok) {
    throw mapHttpError("anthropic", response.status, response.body);
  }

  let usage: AiChatChunk["usage"];
  for await (const data of parseSseText(response.body)) {
    let parsed: {
      type?: string;
      delta?: { type?: string; text?: string };
      usage?: { input_tokens?: number; output_tokens?: number };
      message?: { usage?: { input_tokens?: number; output_tokens?: number } };
    };
    try {
      parsed = JSON.parse(data) as typeof parsed;
    } catch {
      continue;
    }

    if (parsed.type === "content_block_delta" && parsed.delta?.text) {
      yield { text: parsed.delta.text };
    }
    if (parsed.type === "message_start" && parsed.message?.usage) {
      usage = {
        inputTokens: parsed.message.usage.input_tokens,
        outputTokens: parsed.message.usage.output_tokens,
      };
    }
    if (parsed.type === "message_delta" && parsed.usage) {
      usage = {
        inputTokens: usage?.inputTokens ?? parsed.usage.input_tokens,
        outputTokens: parsed.usage.output_tokens,
      };
    }
  }

  yield { done: true, usage };
}

async function testAnthropic(request: AiTestConnectionRequest): Promise<void> {
  const model = request.model.trim();
  if (!model) {
    throw new AiProviderError("Model is required.", {
      code: "invalid_request",
      provider: "anthropic",
    });
  }

  let response;
  try {
    response = await aiHttpFetch({
      url: ANTHROPIC_URL,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": request.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: request.signal,
    });
  } catch (error) {
    if (isAbortError(error) || request.signal?.aborted) {
      throw new AiProviderError("Request cancelled.", {
        code: "cancelled",
        provider: "anthropic",
        cause: error,
      });
    }
    throw new AiProviderError(
      error instanceof Error
        ? error.message
        : "Network error while contacting Anthropic.",
      {
        code: "network",
        provider: "anthropic",
        cause: error,
      },
    );
  }

  if (!response.ok) {
    throw mapHttpError("anthropic", response.status, response.body);
  }
}

export const anthropicClient: AiProviderClient = {
  chat: streamAnthropic,
  testConnection: testAnthropic,
};
