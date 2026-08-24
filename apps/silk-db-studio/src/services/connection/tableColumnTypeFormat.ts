import type { MetadataColumn } from "@silk-studio/db-protocol";

const SIZED_CHAR_OR_BINARY_TYPE = /CHAR|TEXT|STRING|BINARY|RAW/;
const SIZED_NUMERIC_TYPE = /^(NUMBER|NUMERIC|DECIMAL|DEC)/;
const MAX_MEANINGFUL_COLUMN_SIZE = 1_000_000_000;

export type ColumnSizeClass = "sized-numeric" | "sized-char" | "unsized";

/**
 * Whether a type name takes a `(length)` or `(precision,scale)` suffix — shared by the read-only
 * Columns grid (to decide whether to render a size) and the table structure editor (to decide
 * whether the Length/Scale inputs are enabled for a given row).
 */
export function classifyColumnSize(typeName: string | undefined): ColumnSizeClass {
  if (!typeName) return "unsized";
  const upperTypeName = typeName.toUpperCase();
  if (SIZED_NUMERIC_TYPE.test(upperTypeName)) return "sized-numeric";
  if (SIZED_CHAR_OR_BINARY_TYPE.test(upperTypeName)) return "sized-char";
  return "unsized";
}

/**
 * Renders `typeName(columnSize)` / `typeName(columnSize,decimalDigits)` / bare `typeName`,
 * exactly as the (formerly ColumnsPreview-local) read-only Columns grid has always done. Also
 * used by the table structure editor's diff so a cosmetic re-render (`NUMBER(10)` vs
 * `NUMBER(10,0)`) never produces a spurious ALTER.
 */
export function formatColumnTypeParts(
  typeName: string | undefined,
  columnSize: number | undefined,
  decimalDigits: number | undefined,
): string {
  if (!typeName) return "";

  const hasMeaningfulSize =
    columnSize !== undefined &&
    columnSize > 0 &&
    columnSize < MAX_MEANINGFUL_COLUMN_SIZE;

  const sizeClass = classifyColumnSize(typeName);

  if (hasMeaningfulSize && sizeClass === "sized-numeric") {
    return decimalDigits
      ? `${typeName}(${columnSize},${decimalDigits})`
      : `${typeName}(${columnSize})`;
  }

  if (hasMeaningfulSize && sizeClass === "sized-char") {
    return `${typeName}(${columnSize})`;
  }

  return typeName;
}

export function formatColumnType(column: MetadataColumn): string {
  return formatColumnTypeParts(column.typeName, column.columnSize, column.decimalDigits);
}
