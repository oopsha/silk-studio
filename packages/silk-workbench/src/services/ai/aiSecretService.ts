import { ConfigurationService } from "../../platform/configuration/configurationService";
import type { AiProviderId } from "../../platform/configuration/configurationDefaults";
import {
  extractLegacyAiApiKey,
  saveConfiguration,
} from "../../platform/configuration/configurationStorage";
import {
  aiSecretDelete,
  aiSecretGet,
  aiSecretSet,
} from "./aiSecretBridge";

type AiSecretListener = () => void;

class AiSecretServiceImpl {
  private readonly hasKeyByProvider = new Map<AiProviderId, boolean>();
  private readonly listeners = new Set<AiSecretListener>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private watchedProvider: AiProviderId | null = null;

  initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInitialize().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  hasApiKey(provider: AiProviderId = ConfigurationService.getValue("ai.provider")): boolean {
    return this.hasKeyByProvider.get(provider) === true;
  }

  async getApiKey(
    provider: AiProviderId = ConfigurationService.getValue("ai.provider"),
  ): Promise<string> {
    await this.initialize();
    const key = (await aiSecretGet(provider)).trim();
    this.hasKeyByProvider.set(provider, key.length > 0);
    return key;
  }

  async setApiKey(provider: AiProviderId, apiKey: string): Promise<void> {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      throw new Error("API key is required.");
    }
    await aiSecretSet(provider, trimmed);
    this.hasKeyByProvider.set(provider, true);
    this.fireDidChange();
  }

  async deleteApiKey(provider: AiProviderId): Promise<void> {
    await aiSecretDelete(provider);
    this.hasKeyByProvider.set(provider, false);
    this.fireDidChange();
  }

  async refreshProvider(provider: AiProviderId): Promise<boolean> {
    const key = (await aiSecretGet(provider)).trim();
    const hasKey = key.length > 0;
    this.hasKeyByProvider.set(provider, hasKey);
    this.fireDidChange();
    return hasKey;
  }

  onDidChange(listener: AiSecretListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async doInitialize(): Promise<void> {
    await this.migrateLegacyPlaintextKey();
    const provider = ConfigurationService.getValue("ai.provider");
    this.watchedProvider = provider;
    await this.refreshProvider(provider);
    ConfigurationService.onDidChange(() => {
      const next = ConfigurationService.getValue("ai.provider");
      if (next === this.watchedProvider) return;
      this.watchedProvider = next;
      void this.refreshProvider(next);
    });
    this.initialized = true;
  }

  private async migrateLegacyPlaintextKey(): Promise<void> {
    const legacy = extractLegacyAiApiKey();
    if (!legacy) return;

    const provider = ConfigurationService.getValue("ai.provider");
    const existing = (await aiSecretGet(provider)).trim();
    if (!existing) {
      await aiSecretSet(provider, legacy);
      this.hasKeyByProvider.set(provider, true);
    }

    // Rewrite configuration without the plaintext key.
    saveConfiguration(ConfigurationService.getAll());
    this.fireDidChange();
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const AiSecretService = new AiSecretServiceImpl();
