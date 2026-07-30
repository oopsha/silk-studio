import { useSyncExternalStore } from "react";
import { AiAuditLogService } from "./aiAuditLogService";
import type { AiAuditLogEntry } from "./aiAuditLogTypes";

function subscribe(onStoreChange: () => void): () => void {
  return AiAuditLogService.onDidChange(onStoreChange);
}

function getSnapshot(): AiAuditLogEntry[] {
  return AiAuditLogService.getEntries();
}

export function useAiAuditLog(): AiAuditLogEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
