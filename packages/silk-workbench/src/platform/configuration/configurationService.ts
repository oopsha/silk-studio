import {
  CONFIGURATION_DEFAULTS,
  type ConfigurationKey,
  type WorkbenchConfiguration,
} from "./configurationDefaults";
import { applyWorkbenchConfiguration } from "./applyConfiguration";
import { loadConfiguration, saveConfiguration } from "./configurationStorage";
import { resolveAiModelForProvider } from "../../services/settings/aiSettingsConstants";
import { detectDefaultLocale, isLocaleId } from "../i18n/locale";

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

  /** Full settings export payload — safe to write to disk as-is (no secrets live here). */
  exportAll(): { formatVersion: 1; exportedAt: string; settings: WorkbenchConfiguration } {
    return {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      settings: this.values,
    };
  }

  /**
   * Replaces current settings with `data` (expected to be a `WorkbenchConfiguration`-shaped
   * object, e.g. from an imported export file). Every individual key is defended by
   * `mergeAndValidate` — this only guards the top-level shape. Returns `false` (no-op) if
   * `data` isn't an object at all.
   */
  importAll(data: unknown): boolean {
    if (!data || typeof data !== "object") return false;
    this.values = this.mergeAndValidate(data as Partial<WorkbenchConfiguration>);
    applyWorkbenchConfiguration(this.values);
    saveConfiguration(this.values);
    this.fireDidChange();
    return true;
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
    this.values = this.mergeAndValidate(loadConfiguration() ?? undefined);
  }

  /**
   * Merges `stored` (a possibly-partial, possibly-untrusted `WorkbenchConfiguration`) over
   * `CONFIGURATION_DEFAULTS`, validating/clamping every key. Shared by `restoreFromStorage`
   * (reading from localStorage) and `importAll` (reading from an imported export file) — both
   * inputs are equally untrusted, so both need the same defensive merge.
   */
  private mergeAndValidate(
    stored: Partial<WorkbenchConfiguration> | null | undefined,
  ): WorkbenchConfiguration {
    if (!stored) {
      return {
        ...CONFIGURATION_DEFAULTS,
        "workbench.locale": detectDefaultLocale(),
      };
    }

    const values: WorkbenchConfiguration = { ...CONFIGURATION_DEFAULTS };
    for (const key of Object.keys(CONFIGURATION_DEFAULTS) as ConfigurationKey[]) {
      if (stored[key] !== undefined) {
        (values as WorkbenchConfiguration)[key] = stored[key] as never;
      }
    }

    if (stored["workbench.locale"] === undefined) {
      values["workbench.locale"] = detectDefaultLocale();
    } else if (!isLocaleId(values["workbench.locale"])) {
      values["workbench.locale"] = detectDefaultLocale();
    }

    if (
      values["workbench.colorTheme"] !== "dark-2026" &&
      values["workbench.colorTheme"] !== "dark-plus"
    ) {
      values["workbench.colorTheme"] = CONFIGURATION_DEFAULTS["workbench.colorTheme"];
    }

    values["workbench.fontSize"] = clampNumber(
      values["workbench.fontSize"],
      10,
      20,
      CONFIGURATION_DEFAULTS["workbench.fontSize"],
    );
    values["editor.fontSize"] = clampNumber(
      values["editor.fontSize"],
      10,
      24,
      CONFIGURATION_DEFAULTS["editor.fontSize"],
    );
    values["editor.tabSize"] = clampNumber(
      values["editor.tabSize"],
      2,
      8,
      CONFIGURATION_DEFAULTS["editor.tabSize"],
    );
    values["queryResult.rowHeight"] = clampNumber(
      values["queryResult.rowHeight"],
      22,
      48,
      CONFIGURATION_DEFAULTS["queryResult.rowHeight"],
    );
    values["queryResult.fontSize"] = clampNumber(
      values["queryResult.fontSize"],
      10,
      16,
      CONFIGURATION_DEFAULTS["queryResult.fontSize"],
    );
    values["queryResult.maxRows"] = clampNumber(
      values["queryResult.maxRows"],
      1,
      5000,
      CONFIGURATION_DEFAULTS["queryResult.maxRows"],
    );
    if (typeof values["queryResult.nullDisplay"] !== "string") {
      values["queryResult.nullDisplay"] =
        CONFIGURATION_DEFAULTS["queryResult.nullDisplay"];
    } else {
      values["queryResult.nullDisplay"] =
        values["queryResult.nullDisplay"].slice(0, 32);
    }
    if (typeof values["queryResult.filterEnabled"] !== "boolean") {
      values["queryResult.filterEnabled"] =
        CONFIGURATION_DEFAULTS["queryResult.filterEnabled"];
    }
    values["database.queryTimeoutSec"] = clampNumber(
      values["database.queryTimeoutSec"],
      0,
      3600,
      CONFIGURATION_DEFAULTS["database.queryTimeoutSec"],
    );
    if (typeof values["database.autoCommit"] !== "boolean") {
      values["database.autoCommit"] =
        CONFIGURATION_DEFAULTS["database.autoCommit"];
    }
    if (typeof values["database.readOnly"] !== "boolean") {
      values["database.readOnly"] =
        CONFIGURATION_DEFAULTS["database.readOnly"];
    }
    if (typeof values["database.explorer.preloadDefaultSchema"] !== "boolean") {
      values["database.explorer.preloadDefaultSchema"] =
        CONFIGURATION_DEFAULTS["database.explorer.preloadDefaultSchema"];
    }
    if (typeof values["sql.parameters.anonymousEnabled"] !== "boolean") {
      values["sql.parameters.anonymousEnabled"] =
        CONFIGURATION_DEFAULTS["sql.parameters.anonymousEnabled"];
    }
    if (typeof values["sql.parameters.namedEnabled"] !== "boolean") {
      values["sql.parameters.namedEnabled"] =
        CONFIGURATION_DEFAULTS["sql.parameters.namedEnabled"];
    }
    if (typeof values["ai.enabled"] !== "boolean") {
      values["ai.enabled"] = CONFIGURATION_DEFAULTS["ai.enabled"];
    }
    if (
      values["ai.provider"] !== "gemini" &&
      values["ai.provider"] !== "openai" &&
      values["ai.provider"] !== "anthropic" &&
      values["ai.provider"] !== "custom"
    ) {
      values["ai.provider"] = CONFIGURATION_DEFAULTS["ai.provider"];
    }
    if (typeof values["ai.model"] !== "string") {
      values["ai.model"] = CONFIGURATION_DEFAULTS["ai.model"];
    } else {
      values["ai.model"] = resolveAiModelForProvider(
        values["ai.provider"],
        values["ai.model"].slice(0, 128),
      );
    }
    if (typeof values["ai.customBaseUrl"] !== "string") {
      values["ai.customBaseUrl"] =
        CONFIGURATION_DEFAULTS["ai.customBaseUrl"];
    } else {
      values["ai.customBaseUrl"] = values["ai.customBaseUrl"].slice(
        0,
        512,
      );
    }
    if (typeof values["ai.context.includeSchema"] !== "boolean") {
      values["ai.context.includeSchema"] =
        CONFIGURATION_DEFAULTS["ai.context.includeSchema"];
    }
    if (typeof values["ai.context.includeSelection"] !== "boolean") {
      values["ai.context.includeSelection"] =
        CONFIGURATION_DEFAULTS["ai.context.includeSelection"];
    }
    if (typeof values["ai.context.includeQueryHistory"] !== "boolean") {
      values["ai.context.includeQueryHistory"] =
        CONFIGURATION_DEFAULTS["ai.context.includeQueryHistory"];
    }
    if (typeof values["ai.context.includePlsqlDeps"] !== "boolean") {
      values["ai.context.includePlsqlDeps"] =
        CONFIGURATION_DEFAULTS["ai.context.includePlsqlDeps"];
    }
    if (typeof values["ai.allowExecute"] !== "boolean") {
      values["ai.allowExecute"] =
        CONFIGURATION_DEFAULTS["ai.allowExecute"];
    }
    if (typeof values["ai.debug.dumpHttp"] !== "boolean") {
      values["ai.debug.dumpHttp"] =
        CONFIGURATION_DEFAULTS["ai.debug.dumpHttp"];
    }

    return values;
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
