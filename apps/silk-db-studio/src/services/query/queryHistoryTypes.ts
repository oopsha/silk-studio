export type QueryHistoryStatus = "success" | "error" | "cancelled";

export type QueryHistoryEntry = {
  id: string;
  sql: string;
  status: QueryHistoryStatus;
  executedAt: number;
  durationMs: number;
  connectionProfileId: string | null;
  connectionName: string | null;
  driverId: string | null;
  /** Short result/error summary (no secrets). */
  summary: string;
};

export type QueryFavorite = {
  id: string;
  name: string;
  sql: string;
  createdAt: number;
  updatedAt: number;
};

export type QueryHistoryRecordInput = {
  sql: string;
  status: QueryHistoryStatus;
  durationMs: number;
  connectionProfileId: string | null;
  connectionName: string | null;
  driverId: string | null;
  summary: string;
};
