import { useEffect, useState } from "react";
import { ConfigurationService } from "../../platform/configuration/configurationService";
import type { AiProviderId } from "../../platform/configuration/configurationDefaults";
import { AiSecretService } from "./aiSecretService";
import { getAiReadyState, type AiReadyState } from "./aiProviderService";

function aiReadyStateEquals(left: AiReadyState, right: AiReadyState): boolean {
  if (left.ready && right.ready) return true;
  if (!left.ready && !right.ready) {
    return left.reason === right.reason && left.message === right.message;
  }
  return false;
}

/**
 * Subscribe to AI readiness. Prefer useState+effect over useSyncExternalStore:
 * getAiReadyState() always allocates a new object, which would tear the store
 * and infinite-loop re-renders when SecondarySidebar mounts.
 */
export function useAiReadyState(): AiReadyState {
  const [state, setState] = useState(() => getAiReadyState());

  useEffect(() => {
    function refresh() {
      setState((current) => {
        const next = getAiReadyState();
        return aiReadyStateEquals(current, next) ? current : next;
      });
    }

    const disposeConfig = ConfigurationService.onDidChange(refresh);
    const disposeSecrets = AiSecretService.onDidChange(refresh);
    refresh();
    return () => {
      disposeConfig();
      disposeSecrets();
    };
  }, []);

  return state;
}

export function useAiHasApiKey(provider?: AiProviderId): boolean {
  const resolvedProvider =
    provider ?? ConfigurationService.getValue("ai.provider");
  const [hasKey, setHasKey] = useState(() =>
    AiSecretService.hasApiKey(resolvedProvider),
  );

  useEffect(() => {
    function refresh() {
      setHasKey(AiSecretService.hasApiKey(resolvedProvider));
    }

    const disposeConfig = ConfigurationService.onDidChange(refresh);
    const disposeSecrets = AiSecretService.onDidChange(refresh);
    refresh();
    return () => {
      disposeConfig();
      disposeSecrets();
    };
  }, [resolvedProvider]);

  return hasKey;
}
