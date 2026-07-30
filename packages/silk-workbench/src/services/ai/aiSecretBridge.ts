import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AiProviderId } from "../../platform/configuration/configurationDefaults";

const memorySecrets = new Map<AiProviderId, string>();

export async function aiSecretSet(
  provider: AiProviderId,
  apiKey: string,
): Promise<void> {
  if (!isTauri()) {
    memorySecrets.set(provider, apiKey);
    return;
  }
  await invoke("ai_secret_set", { provider, apiKey });
}

export async function aiSecretGet(provider: AiProviderId): Promise<string> {
  if (!isTauri()) {
    return memorySecrets.get(provider) ?? "";
  }
  return invoke<string>("ai_secret_get", { provider });
}

export async function aiSecretDelete(provider: AiProviderId): Promise<void> {
  if (!isTauri()) {
    memorySecrets.delete(provider);
    return;
  }
  await invoke("ai_secret_delete", { provider });
}
