import type { AiProviderId } from "../../platform/configuration/configurationDefaults";
import {
  AiProviderError,
  type AiChatMessage,
  type AiProviderErrorCode,
} from "./aiProviderTypes";

export function splitSystemMessages(messages: AiChatMessage[]): {
  system: string | undefined;
  rest: AiChatMessage[];
} {
  const systemParts: string[] = [];
  const rest: AiChatMessage[] = [];
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

export function normalizeBaseUrl(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : "https://api.openai.com/v1";
}

export function normalizeGeminiModelId(model: string): string {
  const trimmed = model.trim();
  return trimmed.replace(/^models\//i, "");
}

export function extractProviderErrorDetail(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { message?: string; status?: string; code?: number | string };
      message?: string;
    };
    if (typeof parsed.error?.message === "string" && parsed.error.message.trim()) {
      return parsed.error.message.trim();
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    // Not JSON — fall through.
  }
  return trimmed.slice(0, 400);
}

export function mapHttpError(
  provider: AiProviderId,
  status: number,
  body: string,
): AiProviderError {
  const detail = extractProviderErrorDetail(body);
  const lowered = `${detail}\n${body}`.toLowerCase();
  let code: AiProviderErrorCode = "unknown";
  if (
    status === 401 ||
    status === 403 ||
    lowered.includes("api_key_invalid") ||
    lowered.includes("api key not valid") ||
    lowered.includes("permission_denied") ||
    lowered.includes("unauthenticated") ||
    lowered.includes("authentication")
  ) {
    code = "unauthorized";
  } else if (status === 404) {
    code = "not_found";
  } else if (status === 429) {
    code =
      lowered.includes("quota") || lowered.includes("billing")
        ? "quota"
        : "rate_limit";
  } else if (
    status === 503 ||
    status === 502 ||
    status === 504 ||
    lowered.includes("high demand") ||
    lowered.includes("unavailable") ||
    lowered.includes("temporarily")
  ) {
    code = "unavailable";
  } else if (status >= 400 && status < 500) {
    code = "invalid_request";
  }

  return new AiProviderError(
    formatProviderErrorMessage(provider, code, status, detail || body),
    {
      code,
      provider,
      status,
    },
  );
}

export function formatProviderErrorMessage(
  provider: AiProviderId,
  code: AiProviderErrorCode,
  status?: number,
  body?: string,
): string {
  const detail = body?.trim();

  if (code === "unauthorized") {
    if (provider === "gemini") {
      return detail
        ? `Gemini auth failed: ${detail} Create a new key in Google AI Studio (or restrict the key to Generative Language API).`
        : "Gemini API key is invalid or unrestricted. Create a new AI Studio key (or restrict it to Generative Language API).";
    }
    return detail
      ? `API key rejected: ${detail}`
      : "API key is invalid or missing permission. Check the key in Settings.";
  }

  if (code === "not_found") {
    if (provider === "gemini") {
      return detail
        ? `Gemini model/endpoint not found: ${detail}`
        : "Gemini model was not found for this key. Try gemini-3.5-flash, or create a fresh AI Studio key restricted to Generative Language API.";
    }
    return detail
      ? `Model or endpoint not found: ${detail}`
      : "Model or endpoint was not found. Check the model ID and base URL.";
  }

  if (code === "rate_limit" || code === "quota") {
    if (provider === "gemini") {
      return detail
        ? `Gemini limit exceeded: ${detail}`
        : "Gemini Free Tier rate/daily limit exceeded (RPM/TPM/RPD). If billing is not linked, there is no extra charge — wait and retry, or switch model/project.";
    }
    return detail
      ? `Rate limit/quota: ${detail}`
      : "Provider rate limit or quota exceeded. Wait and retry, or check your plan.";
  }

  if (code === "unavailable") {
    if (provider === "gemini") {
      return "Gemini is temporarily overloaded (high demand). Wait a moment and retry, or switch to another model such as gemini-3.1-flash-lite.";
    }
    return "AI provider is temporarily unavailable. Wait a moment and retry, or try another model.";
  }

  if (code === "cancelled") {
    return "Request cancelled.";
  }
  if (code === "network") {
    return detail
      ? `Network error: ${detail}`
      : "Network error while contacting the AI provider.";
  }

  if (detail) {
    return status
      ? `AI provider error (${status}): ${detail}`
      : `AI provider error: ${detail}`;
  }
  return status ? `AI provider error (${status}).` : "AI provider error.";
}

export async function* parseSseText(
  text: string,
): AsyncGenerator<string, void, undefined> {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    yield data;
  }
}
