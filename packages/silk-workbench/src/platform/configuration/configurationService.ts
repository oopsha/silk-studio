import {
  CONFIGURATION_DEFAULTS,
  type ConfigurationKey,
  type WorkbenchConfiguration,
} from "./configurationDefaults";
import { applyWorkbenchConfiguration } from "./applyConfiguration";
import { loadConfiguration, saveConfiguration } from "./configurationStorage";
import { resolveAiModelForProvider } from "../../services/settings/aiSettingsConstants";

type ConfigurationChangeListener = () => void;

class ConfigurationServiceImpl {
  private values: WorkbenchConfiguration = { ...CONFIGURATION_DEFAULTS };
  private readonly listeners = new Set<ConfigurationChangeListener>();

  constructor() {
    this.restoreFromStorage();
    applyWorkbenchConfiguration(this.values);
  }

  getValue<K extends ConfigurationKey>(
    key: K,
  ): WorkbenchConfiguration[K] {
    return this.values[key];
  }

  getAll(): Readonly<WorkbenchConfiguration> {
    return this.values;
  }

  updateValue<K extends ConfigurationKey>(
    key: K,
    value: WorkbenchConfiguration[K],
  ): void {
    if (this.values[key] === value) return;
    this.values = { ...this.values, [key]: value };
    applyWorkbenchConfiguration(this.values);
    saveConfiguration(this.values);
    this.fireDidChange();
  }

  onDidChange(listener: ConfigurationChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private restoreFromStorage(): void {
    const stored = loadConfiguration();
    if (!stored) return;

    this.values = { ...CONFIGURATION_DEFAULTS };
    for (const key of Object.keys(CONFIGURATION_DEFAULTS) as ConfigurationKey[]) {
      if (stored[key] !== undefined) {
        (this.values as WorkbenchConfiguration)[key] = stored[key] as never;
      }
    }

    if (
      this.values["workbench.colorTheme"] !== "dark-2026" &&
      this.values["workbench.colorTheme"] !== "dark-plus"
    ) {
      this.values["workbench.colorTheme"] = CONFIGURATION_DEFAULTS["workbench.colorTheme"];
    }

    this.values["workbench.fontSize"] = clampNumber(
      this.values["workbench.fontSize"],
      10,
      20,
      CONFIGURATION_DEFAULTS["workbench.fontSize"],
    );
    this.values["editor.fontSize"] = clampNumber(
      this.values["editor.fontSize"],
      10,
      24,
      CONFIGURATION_DEFAULTS["editor.fontSize"],
    );
    this.values["editor.tabSize"] = clampNumber(
      this.values["editor.tabSize"],
      2,
      8,
      CONFIGURATION_DEFAULTS["editor.tabSize"],
    );
    this.values["queryResult.rowHeight"] = clampNumber(
      this.values["queryResult.rowHeight"],
      22,
      48,
      CONFIGURATION_DEFAULTS["queryResult.rowHeight"],
    );
    this.values["queryResult.fontSize"] = clampNumber(
      this.values["queryResult.fontSize"],
      10,
      16,
      CONFIGURATION_DEFAULTS["queryResult.fontSize"],
    );
    this.values["queryResult.maxRows"] = clampNumber(
      this.values["queryResult.maxRows"],
      1,
      5000,
      CONFIGURATION_DEFAULTS["queryResult.maxRows"],
    );
    if (typeof this.values["queryResult.nullDisplay"] !== "string") {
      this.values["queryResult.nullDisplay"] =
        CONFIGURATION_DEFAULTS["queryResult.nullDisplay"];
    } else {
      this.values["queryResult.nullDisplay"] =
        this.values["queryResult.nullDisplay"].slice(0, 32);
    }
    if (typeof this.values["queryResult.filterEnabled"] !== "boolean") {
      this.values["queryResult.filterEnabled"] =
        CONFIGURATION_DEFAULTS["queryResult.filterEnabled"];
    }
    this.values["database.queryTimeoutSec"] = clampNumber(
      this.values["database.queryTimeoutSec"],
      5,
      600,
      CONFIGURATION_DEFAULTS["database.queryTimeoutSec"],
    );
    if (typeof this.values["database.autoCommit"] !== "boolean") {
      this.values["database.autoCommit"] =
        CONFIGURATION_DEFAULTS["database.autoCommit"];
    }
    if (typeof this.values["database.readOnly"] !== "boolean") {
      this.values["database.readOnly"] =
        CONFIGURATION_DEFAULTS["database.readOnly"];
    }
    if (typeof this.values["database.explorer.preloadDefaultSchema"] !== "boolean") {
      this.values["database.explorer.preloadDefaultSchema"] =
        CONFIGURATION_DEFAULTS["database.explorer.preloadDefaultSchema"];
    }
    if (typeof this.values["ai.enabled"] !== "boolean") {
      this.values["ai.enabled"] = CONFIGURATION_DEFAULTS["ai.enabled"];
    }
    if (
      this.values["ai.provider"] !== "gemini" &&
      this.values["ai.provider"] !== "openai" &&
      this.values["ai.provider"] !== "anthropic" &&
      this.values["ai.provider"] !== "custom"
    ) {
      this.values["ai.provider"] = CONFIGURATION_DEFAULTS["ai.provider"];
    }
    if (typeof this.values["ai.model"] !== "string") {
      this.values["ai.model"] = CONFIGURATION_DEFAULTS["ai.model"];
    } else {
      this.values["ai.model"] = resolveAiModelForProvider(
        this.values["ai.provider"],
        this.values["ai.model"].slice(0, 128),
      );
    }
    if (typeof this.values["ai.customBaseUrl"] !== "string") {
      this.values["ai.customBaseUrl"] =
        CONFIGURATION_DEFAULTS["ai.customBaseUrl"];
    } else {
      this.values["ai.customBaseUrl"] = this.values["ai.customBaseUrl"].slice(
        0,
        512,
      );
    }
    if (typeof this.values["ai.context.includeSchema"] !== "boolean") {
      this.values["ai.context.includeSchema"] =
        CONFIGURATION_DEFAULTS["ai.context.includeSchema"];
    }
    if (typeof this.values["ai.context.includeSelection"] !== "boolean") {
      this.values["ai.context.includeSelection"] =
        CONFIGURATION_DEFAULTS["ai.context.includeSelection"];
    }
    if (typeof this.values["ai.context.includeQueryHistory"] !== "boolean") {
      this.values["ai.context.includeQueryHistory"] =
        CONFIGURATION_DEFAULTS["ai.context.includeQueryHistory"];
    }
    if (typeof this.values["ai.allowExecute"] !== "boolean") {
      this.values["ai.allowExecute"] =
        CONFIGURATION_DEFAULTS["ai.allowExecute"];
    }
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function clampNumber(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export const ConfigurationService = new ConfigurationServiceImpl();
