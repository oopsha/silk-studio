/**
 * Vite/Tauri `tauri dev` sets `import.meta.env.DEV`.
 * Release builds must keep using the OS keychain — never enable this there.
 */
export function shouldUseDevSecretStore(): boolean {
  return import.meta.env.DEV === true;
}

function storageKey(namespace: string, id: string): string {
  return `silk.devSecret.${namespace}.${id}`;
}

export function devSecretGet(namespace: string, id: string): string {
  try {
    return localStorage.getItem(storageKey(namespace, id)) ?? "";
  } catch {
    return "";
  }
}

export function devSecretSet(
  namespace: string,
  id: string,
  value: string,
): void {
  try {
    localStorage.setItem(storageKey(namespace, id), value);
  } catch {
    // Quota / private mode — ignore.
  }
}

export function devSecretDelete(namespace: string, id: string): void {
  try {
    localStorage.removeItem(storageKey(namespace, id));
  } catch {
    // ignore
  }
}
