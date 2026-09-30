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
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  return {
    kind: "workbook",
    sheets: workbook.SheetNames.map((name: string) => {
      const sheet = workbook.Sheets[name];
      const cells = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        raw: false,
        blankrows: false,
      }) as unknown[][];
      const rows = cells.map((row) => row.map((value) => String(value ?? "")));
      const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
      return {
        name,
        rows: rows.map((row) => [...row, ...Array<string>(Math.max(0, width - row.length)).fill("")]),
      };
    }),
  };
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
