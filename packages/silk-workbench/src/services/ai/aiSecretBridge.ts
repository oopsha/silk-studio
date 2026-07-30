import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AiProviderId } from "../../platform/configuration/configurationDefaults";
import {
  devSecretDelete,
  devSecretGet,
  devSecretSet,
  shouldUseDevSecretStore,
} from "../secrets/devSecretStore";

const memorySecrets = new Map<AiProviderId, string>();
const DEV_NAMESPACE = "ai";
const keychainMigrateAttempted = new Set<string>();

function useBrowserMemoryOnly(): boolean {
  return !isTauri();
}

export async function aiSecretSet(
  provider: AiProviderId,
  apiKey: string,
): Promise<void> {
  if (useBrowserMemoryOnly()) {
    memorySecrets.set(provider, apiKey);
    return;
  }
  if (shouldUseDevSecretStore()) {
    devSecretSet(DEV_NAMESPACE, provider, apiKey);
    keychainMigrateAttempted.add(provider);
    return;
  }
  await invoke("ai_secret_set", { provider, apiKey });
}

export async function aiSecretGet(provider: AiProviderId): Promise<string> {
  if (useBrowserMemoryOnly()) {
    return memorySecrets.get(provider) ?? "";
  }
  if (shouldUseDevSecretStore()) {
    const local = devSecretGet(DEV_NAMESPACE, provider);
    if (local) return local;

    if (keychainMigrateAttempted.has(provider)) {
      return "";
    }
    keychainMigrateAttempted.add(provider);

    try {
      const fromKeychain = await invoke<string>("ai_secret_get", { provider });
      if (fromKeychain) {
        devSecretSet(DEV_NAMESPACE, provider, fromKeychain);
      }
      return fromKeychain;
    } catch (error) {
      console.warn(
        "[secrets] failed to migrate AI API key from Keychain",
        error,
      );
      return "";
    }
  }
  return invoke<string>("ai_secret_get", { provider });
}

export async function aiSecretDelete(provider: AiProviderId): Promise<void> {
  if (useBrowserMemoryOnly()) {
    memorySecrets.delete(provider);
    return;
  }
  if (shouldUseDevSecretStore()) {
    devSecretDelete(DEV_NAMESPACE, provider);
    keychainMigrateAttempted.add(provider);
    return;
  }
  await invoke("ai_secret_delete", { provider });
}
