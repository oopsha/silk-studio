import { invoke, isTauri } from "@tauri-apps/api/core";

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Open an http(s) URL in the OS default browser (Tauri) or a new tab (browser).
 * Non-http(s) URLs are ignored.
 */
export async function openExternalUrl(href: string | undefined | null): Promise<void> {
  const raw = href?.trim();
  if (!raw || !isHttpUrl(raw)) return;

  if (isTauri()) {
    await invoke("open_external_url", { url: raw });
    return;
  }

  window.open(raw, "_blank", "noopener,noreferrer");
}
