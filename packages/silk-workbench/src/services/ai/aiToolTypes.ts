import type { AiProviderId } from "../../platform/configuration/configurationDefaults";
import type { AiTokenUsage } from "./aiProviderTypes";

/** JSON Schema object for a tool's parameters. */
export type AiToolParametersSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type AiToolDefinition = {
  name: string;
  description: string;
  parameters: AiToolParametersSchema;
};

export type AiToolCall = {
  id: string;
  name: string;
  /** Raw JSON arguments string from the model. */
  arguments: string;
  /**
   * Gemini 3 thought signature from the functionCall part. Must be echoed
   * back on the same part in the next generateContent request.
   */
  thoughtSignature?: string;
};

/** Wire-format messages used during a tool-calling loop (not persisted in the UI transcript). */
export type AiWireMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls?: AiToolCall[];
    }
  | {
      role: "tool";
      toolCallId: string;
      name: string;
      content: string;
    };

export type AiChatTurnRequest = {
  provider: AiProviderId;
  model: string;
  messages: AiWireMessage[];
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
  tools?: AiToolDefinition[];
};

export type AiChatTurnResult = {
  text: string;
  toolCalls?: AiToolCall[];
  usage?: AiTokenUsage;
};

export type AiToolHostAdapter = {
  /** Read-only tools available for the current connection, or empty when unavailable. */
  getTools: () => AiToolDefinition[];
  executeTool: (
    name: string,
    argsJson: string,
    signal?: AbortSignal,
  ) => Promise<string>;
};
