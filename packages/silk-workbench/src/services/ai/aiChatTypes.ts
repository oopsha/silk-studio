import type { AiChatRole } from "./aiProviderTypes";

export type AiChatMessageStatus = "streaming" | "done" | "error";

export type AiChatUiMessage = {
  id: string;
  role: Extract<AiChatRole, "user" | "assistant">;
  content: string;
  status: AiChatMessageStatus;
  error?: string;
};

export type AiChatSessionState = {
  messages: AiChatUiMessage[];
  streaming: boolean;
  error: string | null;
};
