import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  devSecretDelete,
  devSecretGet,
  devSecretSet,
  shouldUseDevSecretStore,
} from "@silk-studio/workbench/services/secrets/devSecretStore.ts";

const memorySecrets = new Map<string, string>();
const DEV_NAMESPACE = "connection";
/** Avoid repeated Keychain prompts when a profile has no password stored. */
const keychainMigrateAttempted = new Set<string>();

function useBrowserMemoryOnly(): boolean {
  return !isTauri();
}

export async function secretSet(
  profileId: string,
  password: string,
): Promise<void> {
  if (useBrowserMemoryOnly()) {
    memorySecrets.set(profileId, password);
    return;
  }
  if (shouldUseDevSecretStore()) {
    devSecretSet(DEV_NAMESPACE, profileId, password);
    keychainMigrateAttempted.add(profileId);
    return;
  }
  await invoke("secret_set", { profileId, password });
}

export async function secretGet(profileId: string): Promise<string> {
  if (useBrowserMemoryOnly()) {
    return memorySecrets.get(profileId) ?? "";
  }
  if (shouldUseDevSecretStore()) {
    const local = devSecretGet(DEV_NAMESPACE, profileId);
    if (local) return local;

    if (keychainMigrateAttempted.has(profileId)) {
      return "";
    }
    keychainMigrateAttempted.add(profileId);

    // One-time Keychain → localStorage migration so existing passwords keep working.
    try {
      const fromKeychain = await invoke<string>("secret_get", { profileId });
      if (fromKeychain) {
        devSecretSet(DEV_NAMESPACE, profileId, fromKeychain);
      }
      return fromKeychain;
    } catch (error) {
      console.warn(
        "[secrets] failed to migrate connection password from Keychain",
        error,
      );
      return "";
    }
  }
  return invoke<string>("secret_get", { profileId });
}

export async function secretDelete(profileId: string): Promise<void> {
  if (useBrowserMemoryOnly()) {
    memorySecrets.delete(profileId);
    return;
  }
  if (shouldUseDevSecretStore()) {
    devSecretDelete(DEV_NAMESPACE, profileId);
    keychainMigrateAttempted.add(profileId);
    return;
  }
  await invoke("secret_delete", { profileId });
}
