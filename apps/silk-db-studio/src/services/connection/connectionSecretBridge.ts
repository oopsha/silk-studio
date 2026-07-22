import { invoke, isTauri } from "@tauri-apps/api/core";

const memorySecrets = new Map<string, string>();

export async function secretSet(
  profileId: string,
  password: string,
): Promise<void> {
  if (!isTauri()) {
    memorySecrets.set(profileId, password);
    return;
  }
  await invoke("secret_set", { profileId, password });
}

export async function secretGet(profileId: string): Promise<string> {
  if (!isTauri()) {
    return memorySecrets.get(profileId) ?? "";
  }
  return invoke<string>("secret_get", { profileId });
}

export async function secretDelete(profileId: string): Promise<void> {
  if (!isTauri()) {
    memorySecrets.delete(profileId);
    return;
  }
  await invoke("secret_delete", { profileId });
}
