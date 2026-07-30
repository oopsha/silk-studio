import { invoke, isTauri } from "@tauri-apps/api/core";

export type AiHttpFetchRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type AiHttpFetchResult = {
  status: number;
  ok: boolean;
  body: string;
};

type NativeAiHttpResponse = {
  status: number;
  body: string;
};

/**
 * Outbound AI HTTP. In Tauri this goes through Rust (avoids webview CORS /
 * custom-header quirks). In the browser it falls back to fetch.
 */
export async function aiHttpFetch(
  request: AiHttpFetchRequest,
): Promise<AiHttpFetchResult> {
  const method = (request.method ?? "GET").toUpperCase();
  const headers = request.headers ?? {};

  if (isTauri()) {
    if (request.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const response = await invoke<NativeAiHttpResponse>("ai_http_fetch", {
      request: {
        url: request.url,
        method,
        headers,
        body: request.body ?? null,
      },
    });
    if (request.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      body: response.body,
    };
  }

  const response = await fetch(request.url, {
    method,
    headers,
    body: request.body,
    signal: request.signal,
  });
  const body = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    body,
  };
}
