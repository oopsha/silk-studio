/** Cell values as shown for copy/CSV (null → display token). */
export function formatExportCell(
  value: string | null | undefined,
  nullDisplay: string,
): string {
  if (value === null || value === undefined) {
    return nullDisplay;
  }
  return String(value);
}

/** Tab-separated values for Excel-friendly clipboard paste. */
export function toTsv(
  columns: string[],
  rows: Array<Array<string | null>>,
  nullDisplay: string,
  options?: { includeHeader?: boolean },
): string {
  const includeHeader = options?.includeHeader ?? true;
  const lines: string[] = [];
  if (includeHeader && columns.length > 0) {
    lines.push(columns.map(escapeTsvField).join("\t"));
  }
  for (const row of rows) {
    lines.push(
      columns
        .map((_, index) =>
          escapeTsvField(formatExportCell(row[index], nullDisplay)),
        )
        .join("\t"),
    );
  }
  return lines.join("\n");
}

/**
 * CSV for file export. Filtered/sorted view is the caller's responsibility.
 * RFC-style quoting: fields with comma, quote, or newline are quoted.
 */
export function toCsv(
  columns: string[],
  rows: Array<Array<string | null>>,
  nullDisplay: string,
  options?: { includeHeader?: boolean },
): string {
  const includeHeader = options?.includeHeader ?? true;
  const lines: string[] = [];
  if (includeHeader && columns.length > 0) {
    lines.push(columns.map(escapeCsvField).join(","));
  }
  for (const row of rows) {
    lines.push(
      columns
        .map((_, index) =>
          escapeCsvField(formatExportCell(row[index], nullDisplay)),
        )
        .join(","),
    );
  }
  // Excel on Windows often expects UTF-8 BOM for non-ASCII.
  return `\uFEFF${lines.join("\r\n")}`;
}

function escapeTsvField(value: string): string {
  if (/[\t\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
