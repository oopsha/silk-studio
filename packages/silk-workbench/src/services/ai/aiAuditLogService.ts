import { estimateAiCostUsd } from "./aiAuditLogPricing";
import { loadAiAuditLog, saveAiAuditLog } from "./aiAuditLogStorage";
import type {
  AiAuditLogEntry,
  AiAuditLogRecordInput,
} from "./aiAuditLogTypes";

type AiAuditLogListener = () => void;

class AiAuditLogServiceImpl {
  private entries: AiAuditLogEntry[] = loadAiAuditLog();
  private readonly listeners = new Set<AiAuditLogListener>();

  getEntries(): AiAuditLogEntry[] {
    return this.entries;
  }

  getTotalEstimatedCostUsd(): number {
    return this.entries.reduce(
      (sum, entry) => sum + (entry.estimatedCostUsd ?? 0),
      0,
    );
  }

  record(input: AiAuditLogRecordInput): AiAuditLogEntry {
    const estimatedCostUsd = estimateAiCostUsd(
      input.provider,
      input.model,
      input.inputTokens,
      input.outputTokens,
    );

    const entry: AiAuditLogEntry = {
      id: crypto.randomUUID(),
      at: Date.now(),
      kind: input.kind,
      provider: input.provider,
      model: input.model.trim().slice(0, 128) || "(unknown)",
      status: input.status,
    };

    if (typeof input.inputTokens === "number") {
      entry.inputTokens = Math.max(0, input.inputTokens);
    }
    if (typeof input.outputTokens === "number") {
      entry.outputTokens = Math.max(0, input.outputTokens);
    }
    if (estimatedCostUsd !== undefined) {
      entry.estimatedCostUsd = estimatedCostUsd;
    }
    if (typeof input.durationMs === "number") {
      entry.durationMs = Math.max(0, input.durationMs);
    }
    if (input.errorCode) {
      entry.errorCode = input.errorCode;
    }

    this.entries = [entry, ...this.entries];
    saveAiAuditLog(this.entries);
    this.fireDidChange();
    return entry;
  }

  clear(): void {
    if (this.entries.length === 0) return;
    this.entries = [];
    saveAiAuditLog(this.entries);
    this.fireDidChange();
  }

  /** Metadata-only JSON export (no prompts / keys). */
  exportJson(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        note: "Approximate costs only. No prompts or API keys are stored.",
        entries: this.entries,
      },
      null,
      2,
    );
  }

  onDidChange(listener: AiAuditLogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const AiAuditLogService = new AiAuditLogServiceImpl();
