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
} from "../aiProviderHttp";
import type {
  AiChatTurnRequest,
  AiChatTurnResult,
  AiToolCall,
  AiToolDefinition,
  AiWireMessage,
} from "../aiToolTypes";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function splitWireSystem(messages: AiWireMessage[]): {
  system: string | undefined;
  rest: AiWireMessage[];
} {
  const systemParts: string[] = [];
  const rest: AiWireMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      const text = message.content.trim();
      if (text) systemParts.push(text);
    } else {
      rest.push(message);
    }
  }
  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    rest,
  };
}

function toAnthropicTools(tools: AiToolDefinition[] | undefined) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

function toAnthropicMessages(messages: AiWireMessage[]) {
  const out: Array<{ role: "user" | "assistant"; content: unknown }> = [];

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
      continue;
    }

    if (message.role === "assistant") {
      const blocks: unknown[] = [];
      if (message.content.trim()) {
        blocks.push({ type: "text", text: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(call.arguments || "{}");
        } catch {
          input = {};
        }
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input,
        });
      }
      out.push({
        role: "assistant",
        content: blocks.length > 0 ? blocks : message.content,
      });
      continue;
    }

    // tool → user tool_result (merge consecutive)
    if (message.role !== "tool") {
      continue;
    }
    const block = {
      type: "tool_result",
      tool_use_id: message.toolCallId,
      content: message.content,
    };
    const last = out[out.length - 1];
    if (
      last?.role === "user" &&
      Array.isArray(last.content) &&
      last.content.some(
        (item) =>
          item &&
          typeof item === "object" &&
          (item as { type?: string }).type === "tool_result",
      )
    ) {
      (last.content as unknown[]).push(block);
    } else {
      out.push({ role: "user", content: [block] });
    }
  }

  return out;
}

function parseAnthropicToolCalls(content: unknown): {
  text: string;
  toolCalls?: AiToolCall[];
} {
  if (typeof content === "string") {
    return { text: content.trim() };
  }
  if (!Array.isArray(content)) {
    return { text: "" };
  }

  const textParts: string[] = [];
  const toolCalls: AiToolCall[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const entry = block as {
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
    };
    if (entry.type === "text" && typeof entry.text === "string") {
      textParts.push(entry.text);
    }
    if (
      entry.type === "tool_use" &&
      typeof entry.id === "string" &&
      typeof entry.name === "string"
    ) {
      toolCalls.push({
        id: entry.id,
        name: entry.name,
        arguments: JSON.stringify(entry.input ?? {}),
      });
    }
  }
  return {
    text: textParts.join("").trim(),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

async function completeAnthropic(
  request: AiChatTurnRequest,
): Promise<AiChatTurnResult> {
  const model = request.model.trim();
  if (!model) {
    throw new AiProviderError("Model is required.", {
      code: "invalid_request",
      provider: "anthropic",
    });
  }

  const { system, rest } = splitWireSystem(request.messages);
  const messages = toAnthropicMessages(rest);
  if (messages.length === 0) {
    throw new AiProviderError("At least one user message is required.", {
      code: "invalid_request",
      provider: "anthropic",
    });
  }

  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    messages,
  };
  if (system) {
    body.system = system;
  }
  const tools = toAnthropicTools(request.tools);
  if (tools) {
    body.tools = tools;
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

  let parsed: {
    content?: unknown;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  try {
    parsed = JSON.parse(response.body) as typeof parsed;
  } catch (error) {
    throw new AiProviderError("Invalid JSON response from Anthropic.", {
      code: "unknown",
      provider: "anthropic",
      cause: error,
    });
  }

  const { text, toolCalls } = parseAnthropicToolCalls(parsed.content);
  return {
    text,
    toolCalls,
    usage: parsed.usage
      ? {
          inputTokens: parsed.usage.input_tokens,
          outputTokens: parsed.usage.output_tokens,
        }
      : undefined,
  };
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

  const { system, rest } = splitWireSystem(
    request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  );
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
    messages: rest
      .filter(
        (message): message is { role: "user" | "assistant"; content: string } =>
          message.role === "user" || message.role === "assistant",
      )
      .map((message) => ({
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
  completeTurn: completeAnthropic,
  testConnection: testAnthropic,
};
