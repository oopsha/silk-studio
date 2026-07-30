import { useSyncExternalStore } from "react";
import { ConfigurationService } from "../../platform/configuration/configurationService";
import { AiSecretService } from "./aiSecretService";
import { getAiReadyState, type AiReadyState } from "./aiProviderService";

function subscribe(onStoreChange: () => void): () => void {
  const disposeConfig = ConfigurationService.onDidChange(onStoreChange);
  const disposeSecrets = AiSecretService.onDidChange(onStoreChange);
  return () => {
    disposeConfig();
    disposeSecrets();
  };
}

function getSnapshot(): AiReadyState {
  return getAiReadyState();
}

export function useAiReadyState(): AiReadyState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useAiHasApiKey(
  provider = ConfigurationService.getValue("ai.provider"),
): boolean {
  return useSyncExternalStore(
    subscribe,
    () => AiSecretService.hasApiKey(provider),
    () => AiSecretService.hasApiKey(provider),
  );
}
