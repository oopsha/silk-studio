import { parseDelimitedFile, parseExcelWorkbook } from "./queryResultImport";

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const file = event.data;
    const source = /\.(xlsx|xls)$/i.test(file.name)
      ? await parseExcelWorkbook(await file.arrayBuffer())
      : { kind: "delimited" as const, parsed: parseDelimitedFile(await file.text()) };
    self.postMessage({ source });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
