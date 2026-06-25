import { isTauri } from "@tauri-apps/api/core";
import { basenameFromPath } from "./languageFromPath";

export async function pickAndReadTextFile(): Promise<{
  path: string;
  content: string;
} | null> {
  if (!isTauri()) {
    return pickFileInBrowser();
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const { readTextFile } = await import("@tauri-apps/plugin-fs");

  const selected = await open({
    multiple: false,
    directory: false,
  });

  if (!selected || Array.isArray(selected)) {
    return null;
  }

  const content = await readTextFile(selected);
  return { path: selected, content };
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

function pickFileInBrowser(): Promise<{ path: string; content: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.style.display = "none";

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        resolve(null);
        return;
      }

      const content = await file.text();
      resolve({ path: file.name, content });
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
