import { isTauri } from "@tauri-apps/api/core";
import { basenameFromPath } from "./languageFromPath";

export type PickedTextFiles =
  | { kind: "paths"; paths: string[] }
  | {
      kind: "contents";
      files: Array<{ path: string; content: string }>;
      skipped: number;
    };

export async function pickTextFiles(): Promise<PickedTextFiles | null> {
  if (!isTauri()) {
    const files = await pickFilesInBrowser();
    return files ? { kind: "contents", ...files } : null;
  }

  const { open } = await import("@tauri-apps/plugin-dialog");

  const selected = await open({
    multiple: true,
    directory: false,
  });

  if (!selected) {
    return null;
  }

  return {
    kind: "paths",
    paths: Array.isArray(selected) ? selected : [selected],
  };
}

export async function pickSavePath(defaultPath?: string): Promise<string | null> {
  if (!isTauri()) {
    return defaultPath ?? "untitled.txt";
  }

  const { save } = await import("@tauri-apps/plugin-dialog");
  const selected = await save({
    defaultPath,
  });

  return selected ?? null;
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  if (!isTauri()) {
    downloadTextFile(path, content);
    return;
  }

  const { writeTextFile: writeFile } = await import("@tauri-apps/plugin-fs");
  await writeFile(path, content);
}

/** Read a file by absolute path (desktop) or reject in browser. */
export async function readTextFileAtPath(path: string): Promise<string> {
  if (!isTauri()) {
    throw new Error("Reading by path requires the desktop app.");
  }
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  return readTextFile(path);
}

function pickFilesInBrowser(): Promise<{
  files: Array<{ path: string; content: string }>;
  skipped: number;
} | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.display = "none";

    input.addEventListener("change", async () => {
      const selectedFiles = Array.from(input.files ?? []);
      input.remove();
      if (selectedFiles.length === 0) {
        resolve(null);
        return;
      }

      const filesToRead = selectedFiles.slice(0, 20);
      const files = await Promise.all(
        filesToRead.map(async (file) => ({
          path: file.name,
          content: await file.text(),
        })),
      );
      resolve({ files, skipped: Math.max(0, selectedFiles.length - filesToRead.length) });
    });

    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });

    document.body.appendChild(input);
    input.click();
  });
}

function downloadTextFile(path: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = basenameFromPath(path);
  anchor.click();
  URL.revokeObjectURL(url);
}
