import { aiHttpFetch } from "../aiHttpBridge";
import { dumpAiHttpExchange } from "../aiHttpDebugDump";
import {
  AiProviderError,
  type AiChatChunk,
  type AiChatRequest,
  type AiProviderClient,
  type AiTestConnectionRequest,
} from "../aiProviderTypes";
import {
  mapHttpError,
  normalizeGeminiModelId,
  parseSseText,
} from "../aiProviderHttp";
import type {
  AiChatTurnRequest,
  AiChatTurnResult,
  AiToolCall,
  AiToolDefinition,
  AiWireMessage,
} from "../aiToolTypes";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

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

function toGeminiParameters(parameters: AiToolDefinition["parameters"]) {
  // Gemini functionDeclarations.parameters is a subset of JSON Schema and rejects
  // fields like `additionalProperties` (OpenAI/Anthropic accept them).
  const { additionalProperties: _ignored, ...rest } = parameters;
  return rest;
}

function toGeminiTools(tools: AiToolDefinition[] | undefined) {
  if (!tools || tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: toGeminiParameters(tool.parameters),
      })),
    },
  ];
}

/**
 * Gemini requires alternating user/model turns. Tool results are user-role
 * functionResponse parts; assistant tool calls are model-role functionCall parts.
 */
function toGeminiContents(messages: AiWireMessage[]) {
  const contents: Array<{ role: string; parts: unknown[] }> = [];

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "user") {
      contents.push({
        role: "user",
        parts: [{ text: message.content }],
      });
      continue;
    }

    if (message.role === "assistant") {
      const parts: unknown[] = [];
      if (message.content.trim()) {
        parts.push({ text: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        let args: unknown = {};
        try {
          args = JSON.parse(call.arguments || "{}");
        } catch {
          args = {};
        }
        const part: Record<string, unknown> = {
          functionCall: {
            name: call.name,
            args,
          },
        };
        // Gemini 3 requires echoing thoughtSignature on functionCall parts.
        if (call.thoughtSignature) {
          part.thoughtSignature = call.thoughtSignature;
        }
        parts.push(part);
      }
      if (parts.length === 0) {
        parts.push({ text: "" });
      }
      contents.push({ role: "model", parts });
      continue;
    }

    // tool → user functionResponse (may merge consecutive tool messages)
    if (message.role !== "tool") {
      continue;
    }
    let args: unknown = {};
    try {
      args = JSON.parse(message.content);
    } catch {
      args = { result: message.content };
    }
    const part = {
      functionResponse: {
        name: message.name,
        response:
          args && typeof args === "object"
            ? args
            : { result: message.content },
      },
    };
    const last = contents[contents.length - 1];
    if (last?.role === "user" && Array.isArray(last.parts)) {
      const hasFunctionResponse = last.parts.some(
        (item) =>
          item &&
          typeof item === "object" &&
          "functionResponse" in (item as object),
      );
      if (hasFunctionResponse) {
        last.parts.push(part);
        continue;
      }
    }
    contents.push({ role: "user", parts: [part] });
  }

  return contents;
}

function readThoughtSignature(part: object): string | undefined {
  const record = part as {
    thoughtSignature?: unknown;
    thought_signature?: unknown;
  };
  const raw = record.thoughtSignature ?? record.thought_signature;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function parseGeminiToolCalls(
  parts: unknown[] | undefined,
): AiToolCall[] | undefined {
  if (!parts || parts.length === 0) return undefined;
  const calls: AiToolCall[] = [];
  let index = 0;
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const functionCall = (
      part as { functionCall?: { name?: string; args?: unknown } }
    ).functionCall;
    if (!functionCall?.name) continue;
    index += 1;
    const thoughtSignature = readThoughtSignature(part);
    calls.push({
      id: `gemini-tool-${index}-${functionCall.name}`,
      name: functionCall.name,
      arguments: JSON.stringify(functionCall.args ?? {}),
      ...(thoughtSignature ? { thoughtSignature } : {}),
    });
  }
  return calls.length > 0 ? calls : undefined;
}

async function completeGemini(
  request: AiChatTurnRequest,
): Promise<AiChatTurnResult> {
  const model = normalizeGeminiModelId(request.model);
  if (!model) {
    throw new AiProviderError("Model is required.", {
      code: "invalid_request",
      provider: "gemini",
    });
  }

  const { system, rest } = splitWireSystem(request.messages);
  const contents = toGeminiContents(rest);
  if (contents.length === 0) {
    throw new AiProviderError("At least one user message is required.", {
      code: "invalid_request",
      provider: "gemini",
    });
  }

  const body: Record<string, unknown> = { contents };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }
  const tools = toGeminiTools(request.tools);
  if (tools) {
    body.tools = tools;
  }

  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`;
  const requestBody = JSON.stringify(body);

  let response;
  try {
    response = await aiHttpFetch({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": request.apiKey,
      },
      body: requestBody,
      signal: request.signal,
    });
  } catch (error) {
    if (isAbortError(error) || request.signal?.aborted) {
      throw new AiProviderError("Request cancelled.", {
        code: "cancelled",
        provider: "gemini",
        cause: error,
      });
    }
    throw new AiProviderError(
      error instanceof Error
        ? error.message
        : "Network error while contacting Gemini.",
      {
        code: "network",
        provider: "gemini",
        cause: error,
      },
    );
  }

  dumpAiHttpExchange({
    provider: "gemini",
    operation: "generateContent",
    url,
    requestBody,
    status: response.status,
    responseBody: response.body,
  });

  if (!response.ok) {
    throw mapHttpError("gemini", response.status, response.body);
  }

  let parsed: {
    candidates?: Array<{
      content?: { parts?: Array<Record<string, unknown>> };
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };
  try {
    parsed = JSON.parse(response.body) as typeof parsed;
  } catch (error) {
    throw new AiProviderError("Invalid JSON response from Gemini.", {
      code: "unknown",
      provider: "gemini",
      cause: error,
    });
  }

  const parts = parsed.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
  const toolCalls = parseGeminiToolCalls(parts);

  return {
    text,
    toolCalls,
    usage: parsed.usageMetadata
      ? {
          inputTokens: parsed.usageMetadata.promptTokenCount,
          outputTokens: parsed.usageMetadata.candidatesTokenCount,
        }
      : undefined,
  };
}

function toGeminiStreamContents(messages: AiChatRequest["messages"]) {
  const { system, rest } = splitWireSystem(
    messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  );
  const contents = rest
    .filter(
      (message): message is { role: "user" | "assistant"; content: string } =>
        message.role === "user" || message.role === "assistant",
    )
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));
  return { system, contents };
}

async function* streamGemini(
  request: AiChatRequest,
): AsyncGenerator<AiChatChunk, void, undefined> {
  const model = normalizeGeminiModelId(request.model);
  if (!model) {
    throw new AiProviderError("Model is required.", {
      code: "invalid_request",
      provider: "gemini",
    });
  }

  const { system, contents } = toGeminiStreamContents(request.messages);
  if (contents.length === 0) {
    throw new AiProviderError("At least one user message is required.", {
      code: "invalid_request",
      provider: "gemini",
    });
  }

  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const body: Record<string, unknown> = { contents };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  let response;
  try {
    response = await aiHttpFetch({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": request.apiKey,
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });
  } catch (error) {
    if (isAbortError(error) || request.signal?.aborted) {
      throw new AiProviderError("Request cancelled.", {
        code: "cancelled",
        provider: "gemini",
        cause: error,
      });
    }
    throw new AiProviderError(
      error instanceof Error
        ? error.message
        : "Network error while contacting Gemini.",
      {
        code: "network",
        provider: "gemini",
        cause: error,
      },
    );
  }

  if (!response.ok) {
    throw mapHttpError("gemini", response.status, response.body);
  }

  let usage: AiChatChunk["usage"];
  for await (const data of parseSseText(response.body)) {
    let parsed: {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };
    try {
      parsed = JSON.parse(data) as typeof parsed;
    } catch {
      continue;
    }

    const text = parsed.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("");
    if (text) {
      yield { text };
    }
    if (parsed.usageMetadata) {
      usage = {
        inputTokens: parsed.usageMetadata.promptTokenCount,
        outputTokens: parsed.usageMetadata.candidatesTokenCount,
      };
    }
  }

  yield { done: true, usage };
}

async function testGemini(request: AiTestConnectionRequest): Promise<void> {
  const model = normalizeGeminiModelId(request.model) || "gemini-3.5-flash";

  let meta;
  try {
    meta = await aiHttpFetch({
      url: `${GEMINI_BASE}/models/${encodeURIComponent(model)}`,
      method: "GET",
      headers: {
        "x-goog-api-key": request.apiKey,
      },
      signal: request.signal,
    });
  } catch (error) {
    if (isAbortError(error) || request.signal?.aborted) {
      throw new AiProviderError("Request cancelled.", {
        code: "cancelled",
        provider: "gemini",
        cause: error,
      });
    }
    throw new AiProviderError(
      error instanceof Error
        ? error.message
        : "Network error while contacting Gemini.",
      {
        code: "network",
        provider: "gemini",
        cause: error,
      },
    );
  }

  if (!meta.ok) {
    throw mapHttpError("gemini", meta.status, meta.body);
  }

  let response;
  try {
    response = await aiHttpFetch({
      url: `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": request.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 64 },
      }),
      signal: request.signal,
    });
  } catch (error) {
    if (isAbortError(error) || request.signal?.aborted) {
      throw new AiProviderError("Request cancelled.", {
        code: "cancelled",
        provider: "gemini",
        cause: error,
      });
    }
    throw new AiProviderError(
      error instanceof Error
        ? error.message
        : "Network error while contacting Gemini.",
      {
        code: "network",
        provider: "gemini",
        cause: error,
      },
    );
  }

  if (!response.ok) {
    throw mapHttpError("gemini", response.status, response.body);
  }
}

export const geminiClient: AiProviderClient = {
  chat: streamGemini,
  completeTurn: completeGemini,
  testConnection: testGemini,
};
