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
  normalizeGeminiModelId,
  parseSseText,
  splitSystemMessages,
} from "../aiProviderHttp";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

function toGeminiContents(messages: AiChatRequest["messages"]) {
  const { system, rest } = splitSystemMessages(messages);
  const contents = rest.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
  return { system, contents };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
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

  const { system, contents } = toGeminiContents(request.messages);
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

  // Validate key + model availability first (clearer than generateContent quirks).
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
  testConnection: testGemini,
};
