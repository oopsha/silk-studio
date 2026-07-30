import type { AiProviderId } from "../../platform/configuration/configurationDefaults";
import type { AiProviderErrorCode } from "./aiProviderTypes";

export type AiAuditKind = "chat" | "test_connection";
export type AiAuditStatus = "success" | "error" | "cancelled";

/** Metadata-only audit entry — never stores prompts or API keys. */
export type AiAuditLogEntry = {
  id: string;
  at: number;
  kind: AiAuditKind;
  provider: AiProviderId;
  model: string;
  status: AiAuditStatus;
  inputTokens?: number;
  outputTokens?: number;
  /** Rough USD estimate from the v1 pricing table; omitted when tokens unknown. */
  estimatedCostUsd?: number;
  errorCode?: AiProviderErrorCode;
  durationMs?: number;
};

export type AiAuditLogRecordInput = {
  kind: AiAuditKind;
  provider: AiProviderId;
  model: string;
  status: AiAuditStatus;
  inputTokens?: number;
  outputTokens?: number;
  errorCode?: AiProviderErrorCode;
  durationMs?: number;
};
