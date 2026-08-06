import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { ConfigurationService } from "../../platform/configuration/configurationService";
import { shouldUseDevSecretStore } from "../secrets/devSecretStore";

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * Temporary / developer-facing: when `ai.debug.dumpHttp` is on, open a JSON
 * editor tab with the outbound request body and inbound response (no API key).
 * No-op outside Vite/Tauri development builds.
 */
export function dumpAiHttpExchange(options: {
  provider: string;
  operation: string;
  url: string;
  requestBody: string | undefined;
  status: number;
  responseBody: string;
}): void {
  try {
    if (!shouldUseDevSecretStore()) return;
    if (!ConfigurationService.getValue("ai.debug.dumpHttp")) return;

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const label = `ai-${options.provider}-${options.operation}-${stamp}.json`;
    const payload = {
      url: options.url,
      request: options.requestBody
        ? tryParseJson(options.requestBody)
        : null,
      response: {
        status: options.status,
        body: tryParseJson(options.responseBody),
      },
    };

    EditorService.openEditor({
      label,
      languageId: "json",
      content: `${JSON.stringify(payload, null, 2)}\n`,
      preview: false,
    });
  } catch {
    // Debug aid only — never fail the chat path.
  }
}
