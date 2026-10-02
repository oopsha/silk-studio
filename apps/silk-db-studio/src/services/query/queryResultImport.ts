import type { CellObject } from "xlsx";

export type ParsedDelimitedFile = {
  delimiter: "," | "\t" | ";";
  rows: string[][];
};

export type ParsedImportSource =
  | { kind: "delimited"; parsed: ParsedDelimitedFile }
  | { kind: "workbook"; sheets: Array<{ name: string; rows: string[][] }> };

/** SheetJS reads both legacy BIFF .xls files and OOXML .xlsx files. */
export async function parseExcelWorkbook(data: ArrayBuffer): Promise<ParsedImportSource> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(data, { type: "array", cellNF: true });
  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
  return {
    kind: "workbook",
    sheets: workbook.SheetNames.map((name: string) => {
      const sheet = workbook.Sheets[name];
      const rows: string[][] = [];
      if (sheet["!ref"]) {
        const range = XLSX.utils.decode_range(sheet["!ref"]);
        for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
          const row: string[] = [];
          for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
            const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
            row.push(excelCellValue(cell, XLSX, date1904));
          }
          if (row.some((value) => value !== "")) rows.push(row);
        }
      }
      return { name, rows };
    }),
  };
}

/** Preserve Excel's displayed numeric precision while removing number-format decoration. */
function excelCellValue(cell: CellObject | undefined, XLSX: typeof import("xlsx"), date1904: boolean): string {
  if (cell?.v == null) return "";
  if (cell.t === "e") return cell.w ?? "#ERROR!";
  const format = String(cell.z ?? "");
  if (typeof cell.v !== "number") return String(cell.v);
  if (!XLSX.SSF.is_date(format)) {
    const displayed = cell.w ?? String(cell.v);
    if (format.includes("%")) return String(cell.v);
    const parenthesizedNegative = /^\(.*\)$/.test(displayed.trim());
    const numeric = displayed.replace(/,/g, "").replace(/[^\dEe+\-.]/g, "");
    if (!numeric || numeric === "." || numeric === "-" || numeric === "+") return String(cell.v);
    return parenthesizedNegative ? `-${numeric}` : numeric;
  }

  // Excel dates are serial numbers without a timezone. Format them directly to avoid shifting
  // a date/time through the machine timezone. Keep time-only cells free of Excel's base date.
  const tokens = format
    .replace(/"[^"]*"|\\./g, "")
    .replace(/\[([^\]]*)\]/g, (_match, value: string) => /^[hms]+$/i.test(value) ? value : "");
  const hasTime = /[hs]/i.test(tokens);
  const hasDate = /[yd]/i.test(tokens) || !hasTime;
  const date = XLSX.SSF.parse_date_code(cell.v, { date1904 });
  const fractional = date && Math.abs(date.u) >= 0.0005 ? ".000" : "";
  const targetFormat = hasDate
    ? `yyyy-mm-dd${hasTime ? ` hh:mm:ss${fractional}` : ""}`
    : `hh:mm:ss${fractional}`;
  return XLSX.SSF.format(targetFormat, cell.v, { date1904 });
}

/** Parse CSV/TSV text, including quoted delimiters and embedded newlines. */
export function parseDelimitedFile(text: string): ParsedDelimitedFile {
  const input = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\r" || char === "\n") {
      row.push(field);
      field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      if (char === "\r" && input[index + 1] === "\n") index += 1;
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }

  const width = rows.reduce((max, values) => Math.max(max, values.length), 0);
  return {
    delimiter,
    rows: rows.map((values) => [...values, ...Array(Math.max(0, width - values.length)).fill("")]),
  };
}

function detectDelimiter(text: string): "," | "\t" | ";" {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", "\t", ";"] as const;
  let best: (typeof candidates)[number] = ",";
  let maxCount = -1;
  for (const candidate of candidates) {
    let quoted = false;
    let count = 0;
    for (let index = 0; index < firstLine.length; index += 1) {
      if (firstLine[index] === '"') {
        if (quoted && firstLine[index + 1] === '"') index += 1;
        else quoted = !quoted;
      } else if (firstLine[index] === candidate && !quoted) {
        count += 1;
      }
    }
    if (count > maxCount) {
      maxCount = count;
      best = candidate;
    }
  }
  return best;
}
