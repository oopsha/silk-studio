import type { SqlClause } from "./sqlCompletionClause";

/** Which suggestion buckets to include for a clause (I-A). */
export type SqlCompletionBucket =
  | "statement_start_keywords"
  | "from_keywords"
  | "select_list_keywords"
  | "expression_keywords"
  | "functions"
  | "schemas"
  | "tables"
  | "columns";

export function completionBucketsForClause(
  clause: SqlClause,
): readonly SqlCompletionBucket[] {
  switch (clause) {
    case "statement_start":
      return ["statement_start_keywords"];
    case "from":
    case "join":
      // Tables/CTEs first, then schemas, then JOIN keywords.
      return ["tables", "schemas", "from_keywords"];
    case "insert":
    case "update":
      return ["tables", "schemas"];
    case "select_list":
      // Columns beat functions when writing a select list.
      return [
        "columns",
        "functions",
        "select_list_keywords",
        "expression_keywords",
      ];
    case "where":
    case "having":
    case "on":
    case "group_by":
    case "order_by":
    case "set":
    case "values":
      return ["columns", "functions", "expression_keywords"];
    case "unknown":
      return [
        "statement_start_keywords",
        "tables",
        "schemas",
        "columns",
        "functions",
        "expression_keywords",
      ];
  }
}

export function wantsBucket(
  clause: SqlClause,
  bucket: SqlCompletionBucket,
): boolean {
  return completionBucketsForClause(clause).includes(bucket);
}
