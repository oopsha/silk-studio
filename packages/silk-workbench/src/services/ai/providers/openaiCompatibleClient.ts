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
  normalizeBaseUrl,
  parseSseText,
  splitSystemMessages,
} from "../aiProviderHttp";

function toOpenAiMessages(messages: AiChatRequest["messages"]) {
  const { system, rest } = splitSystemMessages(messages);
  const mapped = rest.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  if (system) {
    mapped.unshift({ role: "system", content: system });
  }
  return mapped;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

async function* streamOpenAiCompatible(
  request: AiChatRequest,
  provider: "openai" | "custom",
): AsyncGenerator<AiChatChunk, void, undefined> {
  const model = request.model.trim();
  if (!model) {
    throw new AiProviderError("Model is required.", {
      code: "invalid_request",
      provider,
    });
  }

  const baseUrl = normalizeBaseUrl(request.baseUrl);
  const url = `${baseUrl}/chat/completions`;
  const messages = toOpenAiMessages(request.messages);
  if (messages.length === 0) {
    throw new AiProviderError("At least one message is required.", {
      code: "invalid_request",
      provider,
    });
  }

  let response;
  try {
    response = await aiHttpFetch({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: request.signal,
    });
  } catch (error) {
    if (isAbortError(error) || request.signal?.aborted) {
      throw new AiProviderError("Request cancelled.", {
        code: "cancelled",
        provider,
        cause: error,
      });
    }
    throw new AiProviderError(
      error instanceof Error
        ? error.message
        : "Network error while contacting the provider.",
      {
        code: "network",
        provider,
        cause: error,
      },
    );
  }

  if (!response.ok) {
    throw mapHttpError(provider, response.status, response.body);
  }

  let usage: AiChatChunk["usage"];
  for await (const data of parseSseText(response.body)) {
    let parsed: {
      choices?: Array<{ delta?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      parsed = JSON.parse(data) as typeof parsed;
    } catch {
      continue;
    }

    const text = parsed.choices?.[0]?.delta?.content;
    if (text) {
      yield { text };
    }
    if (parsed.usage) {
      usage = {
        inputTokens: parsed.usage.prompt_tokens,
        outputTokens: parsed.usage.completion_tokens,
      };
    }
  }

  yield { done: true, usage };
}

async function testOpenAiCompatible(
  request: AiTestConnectionRequest,
  provider: "openai" | "custom",
): Promise<void> {
  const model = request.model.trim();
  if (!model) {
    throw new AiProviderError("Model is required.", {
      code: "invalid_request",
      provider,
    });
  }

  const baseUrl = normalizeBaseUrl(request.baseUrl);
  const url = `${baseUrl}/chat/completions`;
  let response;
  try {
    response = await aiHttpFetch({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 8,
      }),
      signal: request.signal,
    });
  } catch (error) {
    if (isAbortError(error) || request.signal?.aborted) {
      throw new AiProviderError("Request cancelled.", {
        code: "cancelled",
        provider,
        cause: error,
      });
    }
    throw new AiProviderError(
      error instanceof Error
        ? error.message
        : "Network error while contacting the provider.",
      {
        code: "network",
        provider,
        cause: error,
      },
    );
  }

  if (!response.ok) {
    throw mapHttpError(provider, response.status, response.body);
  }
}

export const openaiClient: AiProviderClient = {
  chat: (request) =>
    streamOpenAiCompatible(
      { ...request, baseUrl: "https://api.openai.com/v1" },
      "openai",
    ),
  testConnection: (request) =>
    testOpenAiCompatible(
      { ...request, baseUrl: "https://api.openai.com/v1" },
      "openai",
    ),
};

export const customOpenAiClient: AiProviderClient = {
  chat: (request) => streamOpenAiCompatible(request, "custom"),
  testConnection: (request) => testOpenAiCompatible(request, "custom"),
};
