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
} from "../aiProviderHttp";
import type {
  AiChatTurnRequest,
  AiChatTurnResult,
  AiToolCall,
  AiToolDefinition,
  AiWireMessage,
} from "../aiToolTypes";

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function toOpenAiTools(tools: AiToolDefinition[] | undefined) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function toOpenAiWireMessages(messages: AiWireMessage[]) {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool" as const,
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: {
            name: call.name,
            arguments: call.arguments,
          },
        })),
      };
    }
    return {
      role: message.role,
      content: message.content,
    };
  });
}

function parseToolCalls(raw: unknown): AiToolCall[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const calls: AiToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as {
      id?: string;
      function?: { name?: string; arguments?: string };
    };
    const id = typeof entry.id === "string" ? entry.id : "";
    const name =
      typeof entry.function?.name === "string" ? entry.function.name : "";
    const args =
      typeof entry.function?.arguments === "string"
        ? entry.function.arguments
        : "{}";
    if (!id || !name) continue;
    calls.push({ id, name, arguments: args });
  }
  return calls.length > 0 ? calls : undefined;
}

async function completeOpenAiCompatible(
  request: AiChatTurnRequest,
  provider: "openai" | "custom",
): Promise<AiChatTurnResult> {
  const model = request.model.trim();
  if (!model) {
    throw new AiProviderError("Model is required.", {
      code: "invalid_request",
      provider,
    });
  }

  const baseUrl = normalizeBaseUrl(request.baseUrl);
  const url = `${baseUrl}/chat/completions`;
  const messages = toOpenAiWireMessages(request.messages);
  if (messages.length === 0) {
    throw new AiProviderError("At least one message is required.", {
      code: "invalid_request",
      provider,
    });
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
  };
  const tools = toOpenAiTools(request.tools);
  if (tools) {
    body.tools = tools;
    body.tool_choice = "auto";
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
      body: JSON.stringify(body),
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

  let parsed: {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: unknown;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    parsed = JSON.parse(response.body) as typeof parsed;
  } catch (error) {
    throw new AiProviderError("Invalid JSON response from provider.", {
      code: "unknown",
      provider,
      cause: error,
    });
  }

  const message = parsed.choices?.[0]?.message;
  const text =
    typeof message?.content === "string" ? message.content.trim() : "";
  const toolCalls = parseToolCalls(message?.tool_calls);
  return {
    text,
    toolCalls,
    usage: parsed.usage
      ? {
          inputTokens: parsed.usage.prompt_tokens,
          outputTokens: parsed.usage.completion_tokens,
        }
      : undefined,
  };
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
  const messages = toOpenAiWireMessages(
    request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  );
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
  completeTurn: (request) =>
    completeOpenAiCompatible(
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
  completeTurn: (request) => completeOpenAiCompatible(request, "custom"),
  testConnection: (request) => testOpenAiCompatible(request, "custom"),
};
