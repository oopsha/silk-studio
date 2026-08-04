import type { SqlClause } from "./sqlCompletionClause";
import type { SqlCompletionBucket } from "./sqlCompletionPolicy";
import { completionBucketsForClause } from "./sqlCompletionPolicy";

/** Hard caps so large schemas cannot flood Monaco Suggest. */
export const MAX_SCHEMA_SUGGESTIONS = 40;
export const MAX_TABLE_SUGGESTIONS = 80;
export const MAX_COLUMN_SUGGESTIONS = 150;
export const MAX_FUNCTION_SUGGESTIONS = 60;
export const MAX_ROUTINE_SUGGESTIONS = 80;
export const MAX_TOTAL_SUGGESTIONS = 200;

/** How long column JDBC results stay warm (connection switch still clears). */
export const COLUMN_CACHE_TTL_MS = 5 * 60 * 1000;

/** Wait at most this long for schema objects before returning partial results. */
export const SCHEMA_LOAD_BUDGET_MS = 120;

/**
 * sortText prefix from clause bucket order (earlier bucket → higher in list).
 * Monaco sorts sortText ascending.
 */
export function bucketSortPrefix(
  clause: SqlClause,
  bucket: SqlCompletionBucket,
): string {
  const order = completionBucketsForClause(clause);
  const index = order.indexOf(bucket);
  const rank = index < 0 ? 90 : index;
  return String(rank).padStart(2, "0");
}

export function capSuggestions<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return items.slice(0, max);
}

/** Prefer exact / shorter prefix matches within the same bucket. */
export function matchSortSuffix(label: string, partial: string): string {
  const needle = partial.toLowerCase();
  const name = label.toLowerCase();
  if (!needle) return `2_${name}`;
  if (name === needle) return `0_${name}`;
  if (name.startsWith(needle)) return `1_${name}`;
  return `2_${name}`;
}
