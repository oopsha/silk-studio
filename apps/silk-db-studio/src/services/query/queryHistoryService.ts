import {
  loadQueryHistory,
  MAX_QUERY_HISTORY,
  saveQueryHistory,
} from "./queryHistoryStorage";
import type {
  QueryHistoryEntry,
  QueryHistoryRecordInput,
} from "./queryHistoryTypes";

type HistoryListener = () => void;

class QueryHistoryServiceImpl {
  private entries: QueryHistoryEntry[] = loadQueryHistory();
  private readonly listeners = new Set<HistoryListener>();

  getEntries(): readonly QueryHistoryEntry[] {
    return this.entries;
  }

  record(input: QueryHistoryRecordInput): QueryHistoryEntry {
    const entry: QueryHistoryEntry = {
      id: crypto.randomUUID(),
      sql: input.sql,
      status: input.status,
      executedAt: Date.now(),
      durationMs: Math.max(0, Math.round(input.durationMs)),
      connectionProfileId: input.connectionProfileId,
      connectionName: input.connectionName,
      driverId: input.driverId,
      summary: truncate(input.summary, 240),
    };

    this.entries = [entry, ...this.entries].slice(0, MAX_QUERY_HISTORY);
    saveQueryHistory(this.entries);
    this.fireDidChange();
    return entry;
  }

  remove(id: string): void {
    const next = this.entries.filter((entry) => entry.id !== id);
    if (next.length === this.entries.length) return;
    this.entries = next;
    saveQueryHistory(this.entries);
    this.fireDidChange();
  }

  clear(): void {
    if (this.entries.length === 0) return;
    this.entries = [];
    saveQueryHistory(this.entries);
    this.fireDidChange();
  }

  onDidChange(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export const QueryHistoryService = new QueryHistoryServiceImpl();
