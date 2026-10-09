/** Files selected from the explorer wait here until the target data grid is ready. */
const pendingFiles = new Map<string, File>();
const listeners = new Set<() => void>();

export const TableDataImportService = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getFile(ownerId: string): File | null {
    return pendingFiles.get(ownerId) ?? null;
  },
  request(ownerId: string, file: File): void {
    pendingFiles.set(ownerId, file);
    listeners.forEach((listener) => listener());
  },
  consume(ownerId: string, file: File): void {
    if (pendingFiles.get(ownerId) !== file) return;
    pendingFiles.delete(ownerId);
    listeners.forEach((listener) => listener());
  },
};

export function selectTableImportFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xls,.xlsx,.csv,.tsv";
    input.hidden = true;
    const finish = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => finish(null), { once: true });
    document.body.append(input);
    input.click();
  });
}
