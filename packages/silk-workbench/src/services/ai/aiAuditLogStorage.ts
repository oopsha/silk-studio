import type { AiProviderId } from "../../platform/configuration/configurationDefaults";
import type { AiProviderErrorCode } from "./aiProviderTypes";
import type {
  AiAuditKind,
  AiAuditLogEntry,
  AiAuditStatus,
} from "./aiAuditLogTypes";

export const AI_AUDIT_LOG_STORAGE_KEY = "silk-workbench.ai.auditLog.v1";
export const MAX_AI_AUDIT_LOG = 100;

const PROVIDERS = new Set<AiProviderId>([
  "gemini",
  "openai",
  "anthropic",
  "custom",
]);

const KINDS = new Set<AiAuditKind>(["chat", "test_connection"]);
const STATUSES = new Set<AiAuditStatus>(["success", "error", "cancelled"]);

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeEntry(value: unknown): AiAuditLogEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id) return null;
  if (typeof record.at !== "number" || !Number.isFinite(record.at)) return null;
  if (typeof record.kind !== "string" || !KINDS.has(record.kind as AiAuditKind)) {
    return null;
  }
  if (
    typeof record.provider !== "string" ||
    !PROVIDERS.has(record.provider as AiProviderId)
  ) {
    return null;
  }
  if (typeof record.model !== "string") return null;
  if (
    typeof record.status !== "string" ||
    !STATUSES.has(record.status as AiAuditStatus)
  ) {
    return null;
  }

  const entry: AiAuditLogEntry = {
    id: record.id,
    at: record.at,
    kind: record.kind as AiAuditKind,
    provider: record.provider as AiProviderId,
    model: record.model.slice(0, 128),
    status: record.status as AiAuditStatus,
  };

  const inputTokens = asOptionalNumber(record.inputTokens);
  const outputTokens = asOptionalNumber(record.outputTokens);
  const estimatedCostUsd = asOptionalNumber(record.estimatedCostUsd);
  const durationMs = asOptionalNumber(record.durationMs);
  if (inputTokens !== undefined) entry.inputTokens = Math.max(0, inputTokens);
  if (outputTokens !== undefined) entry.outputTokens = Math.max(0, outputTokens);
  if (estimatedCostUsd !== undefined) {
    entry.estimatedCostUsd = Math.max(0, estimatedCostUsd);
  }
  if (durationMs !== undefined) entry.durationMs = Math.max(0, durationMs);
  if (typeof record.errorCode === "string" && record.errorCode) {
    entry.errorCode = record.errorCode as AiProviderErrorCode;
  }

  return entry;
}

export function loadAiAuditLog(): AiAuditLogEntry[] {
  try {
    const raw = localStorage.getItem(AI_AUDIT_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeEntry)
      .filter((entry): entry is AiAuditLogEntry => entry !== null)
      .slice(0, MAX_AI_AUDIT_LOG);
  } catch {
    return [];
  }
}

export function saveAiAuditLog(entries: AiAuditLogEntry[]): void {
  try {
    localStorage.setItem(
      AI_AUDIT_LOG_STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_AI_AUDIT_LOG)),
    );
  } catch {
    // Quota / private mode — ignore.
  }
}
