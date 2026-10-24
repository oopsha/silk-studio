import type { MetadataColumn } from "@silk-studio/db-protocol";

export type EmptyCellPolicy = { kind: "null" | "empty" | "value"; value?: string };
export type ImportColumn = { name: string; sourceIndex: number; empty: EmptyCellPolicy };
export type FileImportPlan = { columns: ImportColumn[]; rows: string[][]; firstFileRow: number; clearExisting: boolean };
export type ImportColumnIssue = { column: string; count: number; firstFileRow: number; reason: "notNull" | "number" | "length" };

export function importCell(value: string | undefined, policy: EmptyCellPolicy): string | null {
  const text = value ?? "";
  if (text !== "") return text;
  return policy.kind === "null" ? null : policy.kind === "value" ? policy.value ?? "" : "";
}

export function validateImport(plan: FileImportPlan, metadata: MetadataColumn[], oracle: boolean): ImportColumnIssue[] {
  const issues: ImportColumnIssue[] = [];
  for (const column of plan.columns) {
    const meta = metadata.find((item) => item.name.toLowerCase() === column.name.toLowerCase());
    const type = meta?.typeName?.toUpperCase() ?? "";
    const numeric = /^(NUMBER|NUMERIC|DECIMAL|DEC|INTEGER|INT|INT2|INT4|INT8|SMALLINT|TINYINT|BIGINT|FLOAT|FLOAT4|FLOAT8|REAL|DOUBLE|MONEY|SMALLMONEY)\b/.test(type);
    const counts = new Map<ImportColumnIssue["reason"], ImportColumnIssue>();
    plan.rows.forEach((row, index) => {
      const value = importCell(row[column.sourceIndex], column.empty);
      let reason: ImportColumnIssue["reason"] | undefined;
      if (meta?.nullable === false && (value === null || (oracle && value === ""))) reason = "notNull";
      else if (value !== null && numeric && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) reason = "number";
      else if (value !== null && /CHAR|VARCHAR/.test(type) && meta?.columnSize && Array.from(value).length > meta.columnSize) reason = "length";
      if (reason) {
        const issue = counts.get(reason);
        if (issue) issue.count++;
        else counts.set(reason, { column: column.name, count: 1, firstFileRow: plan.firstFileRow + index, reason });
      }
    });
    issues.push(...counts.values());
  }
  return issues;
}
