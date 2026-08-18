import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ConfigurationService } from "../../platform/configuration/configurationService";
import type {
  AiProviderId,
  ColorThemeId,
  LineNumbersMode,
  WordWrapMode,
} from "../../platform/configuration/configurationDefaults";
import { useConfiguration } from "../../platform/configuration/useConfiguration";
import { useI18n } from "../../platform/i18n/useI18n";
import type { LocaleId } from "../../platform/i18n/locale";
import { AiSecretService } from "../../services/ai/aiSecretService";
import { testConfiguredConnection } from "../../services/ai/aiProviderService";
import { AiProviderError } from "../../services/ai/aiProviderTypes";
import { useAiHasApiKey } from "../../services/ai/useAiReadyState";
import { shouldUseDevSecretStore } from "../../services/secrets/devSecretStore";
import {
  AI_API_KEY_PLACEHOLDERS,
  AI_DEFAULT_MODEL,
  AI_MODEL_PRESETS,
  AI_PROVIDER_LABELS,
  resolveAiModelForProvider,
} from "../../services/settings/aiSettingsConstants";
import {
  SETTINGS_CATEGORY_AVAILABLE,
} from "../../services/settings/settingsConstants";
import type { SettingsCategory } from "../../services/settings/settingsConstants";
import { SettingsService } from "../../services/settings/settingsService";
import { useSettingsCategory } from "../../services/settings/useSettingsCategory";
import "./SettingsEditor.css";

const SETTINGS_CATEGORY_MESSAGE_KEYS = {
  appearance: "settings.category.appearance",
  editor: "settings.category.editor",
  database: "settings.category.database",
  queryResult: "settings.category.queryResult",
  ai: "settings.category.ai",
} as const satisfies Record<
  SettingsCategory,
  | "settings.category.appearance"
  | "settings.category.editor"
  | "settings.category.database"
  | "settings.category.queryResult"
  | "settings.category.ai"
>;

type SettingRowProps = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

function SettingRow({ title, description, children, className }: SettingRowProps) {
  return (
    <div className={`settings-row${className ? ` ${className}` : ""}`}>
      <div className="settings-row__meta">
        <div className="settings-row__title">{title}</div>
        {description ? (
          <div className="settings-row__description">{description}</div>
        ) : null}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

function AppearanceSettings() {
  const configuration = useConfiguration();
  const { t } = useI18n();

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">{t("settings.appearance.title")}</h2>
      <SettingRow
        title={t("settings.appearance.locale")}
        description={t("settings.appearance.localeDescription")}
      >
        <select
          className="settings-control"
          value={configuration["workbench.locale"]}
          onChange={(event) =>
            ConfigurationService.updateValue(
              "workbench.locale",
              event.target.value as LocaleId,
            )
          }
          aria-label={t("settings.appearance.locale")}
        >
          <option value="en">{t("locale.en")}</option>
          <option value="ko">{t("locale.ko")}</option>
        </select>
      </SettingRow>
      <SettingRow
        title={t("settings.appearance.colorTheme")}
        description={t("settings.appearance.colorThemeDescription")}
      >
        <select
          className="settings-control"
          value={configuration["workbench.colorTheme"]}
          onChange={(event) =>
            ConfigurationService.updateValue(
              "workbench.colorTheme",
              event.target.value as ColorThemeId,
            )
          }
        >
          <option value="dark-2026">Dark 2026</option>
          <option value="dark-plus">Dark+</option>
        </select>
      </SettingRow>
      <SettingRow
        title={t("settings.appearance.uiFontSize")}
        description={t("settings.appearance.uiFontSizeDescription")}
      >
        <input
          className="settings-control settings-control--number"
          type="number"
          min={10}
          max={20}
          value={configuration["workbench.fontSize"]}
          onChange={(event) =>
            ConfigurationService.updateValue(
              "workbench.fontSize",
              Number(event.target.value),
            )
          }
        />
      </SettingRow>
    </section>
  );
}

function EditorSettings() {
  const configuration = useConfiguration();
  const { t } = useI18n();

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">{t("settings.editor.title")}</h2>
      <SettingRow title={t("settings.editor.fontSize")}>
        <input
          className="settings-control settings-control--number"
          type="number"
          min={10}
          max={24}
          value={configuration["editor.fontSize"]}
          onChange={(event) =>
            ConfigurationService.updateValue(
              "editor.fontSize",
              Number(event.target.value),
            )
          }
        />
      </SettingRow>
      <SettingRow title={t("settings.editor.tabSize")}>
        <input
          className="settings-control settings-control--number"
          type="number"
          min={2}
          max={8}
          value={configuration["editor.tabSize"]}
          onChange={(event) =>
            ConfigurationService.updateValue(
              "editor.tabSize",
              Number(event.target.value),
            )
          }
        />
      </SettingRow>
      <SettingRow title={t("settings.editor.insertSpaces")}>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={configuration["editor.insertSpaces"]}
            onChange={(event) =>
              ConfigurationService.updateValue(
                "editor.insertSpaces",
                event.target.checked,
              )
            }
          />
          <span>{t("settings.editor.insertSpacesHint")}</span>
        </label>
      </SettingRow>
      <SettingRow title={t("settings.editor.lineNumbers")}>
        <select
          className="settings-control"
          value={configuration["editor.lineNumbers"]}
          onChange={(event) =>
            ConfigurationService.updateValue(
              "editor.lineNumbers",
              event.target.value as LineNumbersMode,
            )
          }
        >
          <option value="on">on</option>
          <option value="off">off</option>
          <option value="relative">relative</option>
        </select>
      </SettingRow>
      <SettingRow title={t("settings.editor.minimap")}>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={configuration["editor.minimap.enabled"]}
            onChange={(event) =>
              ConfigurationService.updateValue(
                "editor.minimap.enabled",
                event.target.checked,
              )
            }
          />
          <span>{t("settings.editor.minimapHint")}</span>
        </label>
      </SettingRow>
      <SettingRow title={t("settings.editor.stickyScroll")}>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={configuration["editor.stickyScroll.enabled"]}
            onChange={(event) =>
              ConfigurationService.updateValue(
                "editor.stickyScroll.enabled",
                event.target.checked,
              )
            }
          />
          <span>{t("settings.editor.stickyScrollHint")}</span>
        </label>
      </SettingRow>
      <SettingRow title={t("settings.editor.wordWrap")}>
        <select
          className="settings-control"
          value={configuration["editor.wordWrap"]}
          onChange={(event) =>
            ConfigurationService.updateValue(
              "editor.wordWrap",
              event.target.value as WordWrapMode,
            )
          }
        >
          <option value="off">off</option>
          <option value="on">on</option>
        </select>
      </SettingRow>
    </section>
  );
}

function DatabaseSettings() {
  const configuration = useConfiguration();
  const { t } = useI18n();

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">{t("settings.database.title")}</h2>
      <p className="settings-placeholder settings-placeholder--intro">
        {t("settings.database.intro")}
      </p>
      <h3 className="settings-section__subtitle">
        {t("settings.database.sessionOptions")}
      </h3>
      <SettingRow
        title={t("settings.database.queryTimeout")}
        description={t("settings.database.queryTimeoutDescription")}
      >
        <input
          className="settings-control settings-control--number"
          type="number"
          min={0}
          max={3600}
          value={configuration["database.queryTimeoutSec"]}
          onChange={(event) =>
            ConfigurationService.updateValue(
              "database.queryTimeoutSec",
              Number(event.target.value),
            )
          }
        />
      </SettingRow>
      <SettingRow title={t("settings.database.autoCommit")}>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={configuration["database.autoCommit"]}
            onChange={(event) =>
              ConfigurationService.updateValue(
                "database.autoCommit",
                event.target.checked,
              )
            }
          />
          <span>{t("settings.database.autoCommitHint")}</span>
        </label>
      </SettingRow>
      <SettingRow
        title={t("settings.database.readOnly")}
        description={t("settings.database.readOnlyDescription")}
      >
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={configuration["database.readOnly"]}
            onChange={(event) =>
              ConfigurationService.updateValue(
                "database.readOnly",
                event.target.checked,
              )
            }
          />
          <span>{t("settings.database.readOnlyHint")}</span>
        </label>
      </SettingRow>
      <SettingRow
        title={t("settings.database.preloadDefaultSchema")}
        description={t("settings.database.preloadDefaultSchemaDescription")}
      >
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={configuration["database.explorer.preloadDefaultSchema"]}
            onChange={(event) =>
              ConfigurationService.updateValue(
                "database.explorer.preloadDefaultSchema",
                event.target.checked,
              )
            }
          />
          <span>{t("settings.database.preloadDefaultSchemaHint")}</span>
        </label>
      </SettingRow>
      <SettingRow
        title={t("settings.database.prefetchAllDatabases")}
        description={t("settings.database.prefetchAllDatabasesDescription")}
      >
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={configuration["explorer.search.prefetchAllDatabases"]}
            onChange={(event) =>
              ConfigurationService.updateValue(
                "explorer.search.prefetchAllDatabases",
                event.target.checked,
              )
            }
          />
          <span>{t("settings.database.prefetchAllDatabasesHint")}</span>
        </label>
      </SettingRow>
      <h3 className="settings-section__subtitle">
        {t("settings.database.sqlParameters")}
      </h3>
      <SettingRow
        title={t("settings.database.anonymousParameters")}
        description={t("settings.database.anonymousParametersDescription")}
      >
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={configuration["sql.parameters.anonymousEnabled"]}
            onChange={(event) =>
              ConfigurationService.updateValue(
                "sql.parameters.anonymousEnabled",
                event.target.checked,
              )
            }
          />
          <span>{t("settings.database.anonymousParametersHint")}</span>
        </label>
      </SettingRow>
      <SettingRow
        title={t("settings.database.namedParameters")}
        description={t("settings.database.namedParametersDescription")}
      >
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={configuration["sql.parameters.namedEnabled"]}
            onChange={(event) =>
              ConfigurationService.updateValue(
                "sql.parameters.namedEnabled",
                event.target.checked,
              )
            }
          />
          <span>{t("settings.database.namedParametersHint")}</span>
        </label>
      </SettingRow>
      <SettingRow
        title={t("settings.database.namedParameterPrefix")}
        description={t("settings.database.namedParameterPrefixDescription")}
      >
        <input
          className="settings-control"
          type="text"
          maxLength={4}
          value={configuration["sql.parameters.namedPrefix"]}
          onChange={(event) =>
            ConfigurationService.updateValue(
              "sql.parameters.namedPrefix",
              event.target.value,
            )
          }
        />
      </SettingRow>
    </section>
  );
}

function QueryResultSettings() {
  const configuration = useConfiguration();
  const { t } = useI18n();

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">
        {t("settings.queryResult.title")}
      </h2>
      <SettingRow
        title={t("settings.queryResult.maxRows")}
        description={t("settings.queryResult.maxRowsDescription")}
      >
        <input
          className="settings-control settings-control--number"
          type="number"
          min={1}
          max={5000}
          value={configuration["queryResult.maxRows"]}
          onChange={(event) =>
            ConfigurationService.updateValue(
              "queryResult.maxRows",
              Number(event.target.value),
            )
          }
        />
      </SettingRow>
      <SettingRow title={t("settings.queryResult.rowHeight")}>
        <input
          className="settings-control settings-control--number"
          type="number"
          min={22}
          max={48}
          value={configuration["queryResult.rowHeight"]}
          onChange={(event) =>
            ConfigurationService.updateValue(
              "queryResult.rowHeight",
              Number(event.target.value),
            )
          }
        />
      </SettingRow>
      <SettingRow title={t("settings.queryResult.fontSize")}>
        <input
          className="settings-control settings-control--number"
          type="number"
          min={10}
          max={16}
          value={configuration["queryResult.fontSize"]}
          onChange={(event) =>
            ConfigurationService.updateValue(
              "queryResult.fontSize",
              Number(event.target.value),
            )
          }
        />
      </SettingRow>
      <SettingRow
        title={t("settings.queryResult.nullDisplay")}
        description={t("settings.queryResult.nullDisplayDescription")}
      >
        <input
          className="settings-control"
          type="text"
          maxLength={32}
          value={configuration["queryResult.nullDisplay"]}
          onChange={(event) =>
            ConfigurationService.updateValue(
              "queryResult.nullDisplay",
              event.target.value,
            )
          }
        />
      </SettingRow>
      <SettingRow title={t("settings.queryResult.columnFilters")}>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={configuration["queryResult.filterEnabled"]}
            onChange={(event) =>
              ConfigurationService.updateValue(
                "queryResult.filterEnabled",
                event.target.checked,
              )
            }
          />
          <span>{t("settings.queryResult.columnFiltersHint")}</span>
        </label>
      </SettingRow>
    </section>
  );
}

function AiSettings() {
  const configuration = useConfiguration();
  const { t } = useI18n();
  const provider = configuration["ai.provider"];
  const modelOptions = AI_MODEL_PRESETS[provider];
  const hasStoredKey = useAiHasApiKey(provider);
  const [draftKey, setDraftKey] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"info" | "error" | "success">(
    "info",
  );

  useEffect(() => {
    void AiSecretService.initialize().then(() =>
      AiSecretService.refreshProvider(provider),
    );
    setDraftKey("");
    setStatusMessage(null);
  }, [provider]);

  const keyPlaceholder = hasStoredKey
    ? t("settings.ai.keyPlaceholderReplace")
    : AI_API_KEY_PLACEHOLDERS[provider];

  async function handleSaveKey(): Promise<void> {
    const next = draftKey.trim();
    if (!next) {
      setStatusTone("error");
      setStatusMessage(t("settings.ai.enterKeyToSave"));
      return;
    }
    setKeyBusy(true);
    setStatusMessage(null);
    try {
      await AiSecretService.setApiKey(provider, next);
      setDraftKey("");
      setStatusTone("success");
      setStatusMessage(t("settings.ai.keySaved"));
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(
        error instanceof Error ? error.message : t("settings.ai.saveFailed"),
      );
    } finally {
      setKeyBusy(false);
    }
  }

  async function handleClearKey(): Promise<void> {
    setKeyBusy(true);
    setStatusMessage(null);
    try {
      await AiSecretService.deleteApiKey(provider);
      setDraftKey("");
      setStatusTone("info");
      setStatusMessage(t("settings.ai.keyRemoved"));
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(
        error instanceof Error ? error.message : t("settings.ai.clearFailed"),
      );
    } finally {
      setKeyBusy(false);
    }
  }

  async function handleTestConnection(): Promise<void> {
    setTestBusy(true);
    setStatusMessage(null);
    try {
      await testConfiguredConnection({
        apiKey: draftKey.trim() || undefined,
      });
      setStatusTone("success");
      setStatusMessage(t("settings.ai.testSucceeded"));
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(
        error instanceof AiProviderError || error instanceof Error
          ? error.message
          : t("settings.ai.testFailed"),
      );
    } finally {
      setTestBusy(false);
    }
  }

  const apiKeyDescription = shouldUseDevSecretStore()
    ? t("settings.ai.apiKeyDescDev")
    : provider === "gemini"
      ? t("settings.ai.apiKeyDescGemini")
      : t("settings.ai.apiKeyDescDefault");

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">{t("settings.ai.title")}</h2>
      <p className="settings-placeholder settings-placeholder--intro">
        {shouldUseDevSecretStore()
          ? t("settings.ai.introDev")
          : t("settings.ai.introRelease")}
      </p>
      <SettingRow title={t("settings.ai.enable")}>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={configuration["ai.enabled"]}
            onChange={(event) =>
              ConfigurationService.updateValue(
                "ai.enabled",
                event.target.checked,
              )
            }
          />
          <span>{t("settings.ai.enableHint")}</span>
        </label>
      </SettingRow>
      <SettingRow
        title={t("settings.ai.provider")}
        description={t("settings.ai.providerDescription")}
      >
        <select
          className="settings-control"
          value={provider}
          onChange={(event) => {
            const nextProvider = event.target.value as AiProviderId;
            ConfigurationService.updateValue("ai.provider", nextProvider);
            ConfigurationService.updateValue(
              "ai.model",
              resolveAiModelForProvider(
                nextProvider,
                configuration["ai.model"],
              ) || AI_DEFAULT_MODEL[nextProvider],
            );
          }}
        >
          {(Object.keys(AI_PROVIDER_LABELS) as AiProviderId[]).map((item) => (
            <option key={item} value={item}>
              {AI_PROVIDER_LABELS[item]}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        title={t("settings.ai.model")}
        description={t("settings.ai.modelDescription")}
      >
        {provider === "custom" ? (
          <input
            className="settings-control"
            type="text"
            placeholder="model-id"
            value={configuration["ai.model"]}
            onChange={(event) =>
              ConfigurationService.updateValue("ai.model", event.target.value)
            }
          />
        ) : (
          <select
            className="settings-control"
            value={configuration["ai.model"]}
            onChange={(event) =>
              ConfigurationService.updateValue("ai.model", event.target.value)
            }
          >
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        )}
      </SettingRow>
      {provider === "custom" ? (
        <SettingRow
          title={t("settings.ai.customBaseUrl")}
          description={t("settings.ai.customBaseUrlDescription")}
        >
          <input
            className="settings-control"
            type="url"
            autoComplete="off"
            placeholder="https://api.openai.com/v1"
            value={configuration["ai.customBaseUrl"]}
            onChange={(event) =>
              ConfigurationService.updateValue(
                "ai.customBaseUrl",
                event.target.value,
              )
            }
          />
        </SettingRow>
      ) : null}
      <SettingRow
        className="settings-row--ai-key"
        title={t("settings.ai.apiKey")}
        description={apiKeyDescription}
      >
        <div className="settings-ai-key">
          <input
            className="settings-control"
            type="password"
            autoComplete="off"
            placeholder={keyPlaceholder}
            value={draftKey}
            onChange={(event) => setDraftKey(event.target.value)}
          />
          <div className="settings-ai-key__meta">
            {hasStoredKey
              ? t("settings.ai.keyStored")
              : t("settings.ai.keyMissing")}
          </div>
          <div className="settings-ai-key__actions">
            <button
              type="button"
              className="settings-button"
              disabled={keyBusy || draftKey.trim().length === 0}
              onClick={() => void handleSaveKey()}
            >
              {t("common.save")}
            </button>
            <button
              type="button"
              className="settings-button"
              disabled={keyBusy || !hasStoredKey}
              onClick={() => void handleClearKey()}
            >
              {t("common.clear")}
            </button>
            <button
              type="button"
              className="settings-button"
              disabled={
                testBusy ||
                (!draftKey.trim() && !hasStoredKey) ||
                configuration["ai.model"].trim().length === 0
              }
              onClick={() => void handleTestConnection()}
            >
              {testBusy ? t("common.testing") : t("settings.ai.testConnection")}
            </button>
          </div>
          {statusMessage ? (
            <p
              className={`settings-ai-key__status settings-ai-key__status--${statusTone}`}
              role="status"
            >
              {statusMessage}
            </p>
          ) : null}
        </div>
      </SettingRow>
      <SettingRow title={t("settings.ai.contextSchema")}>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={configuration["ai.context.includeSchema"]}
            onChange={(event) =>
              ConfigurationService.updateValue(
                "ai.context.includeSchema",
                event.target.checked,
              )
            }
          />
          <span>{t("settings.ai.contextSchema")}</span>
        </label>
      </SettingRow>
      <SettingRow title={t("settings.ai.contextSelection")}>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={configuration["ai.context.includeSelection"]}
            onChange={(event) =>
              ConfigurationService.updateValue(
                "ai.context.includeSelection",
                event.target.checked,
              )
            }
          />
          <span>{t("settings.ai.contextSelection")}</span>
        </label>
      </SettingRow>
      <SettingRow title={t("settings.ai.contextHistory")}>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={configuration["ai.context.includeQueryHistory"]}
            onChange={(event) =>
              ConfigurationService.updateValue(
                "ai.context.includeQueryHistory",
                event.target.checked,
              )
            }
          />
          <span>{t("settings.ai.contextHistory")}</span>
        </label>
      </SettingRow>
      <SettingRow
        title={t("settings.ai.contextPlsqlDeps")}
        description={t("settings.ai.contextPlsqlDepsDescription")}
      >
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={configuration["ai.context.includePlsqlDeps"]}
            onChange={(event) =>
              ConfigurationService.updateValue(
                "ai.context.includePlsqlDeps",
                event.target.checked,
              )
            }
          />
          <span>{t("settings.ai.contextPlsqlDeps")}</span>
        </label>
      </SettingRow>
      <SettingRow
        title={t("settings.ai.allowExecute")}
        description={t("settings.ai.allowExecuteDescription")}
      >
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={configuration["ai.allowExecute"]}
            onChange={(event) =>
              ConfigurationService.updateValue(
                "ai.allowExecute",
                event.target.checked,
              )
            }
          />
          <span>{t("settings.ai.allowExecuteHint")}</span>
        </label>
      </SettingRow>
      {shouldUseDevSecretStore() ? (
        <SettingRow
          title={t("settings.ai.debugDumpHttp")}
          description={t("settings.ai.debugDumpHttpDescription")}
        >
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={configuration["ai.debug.dumpHttp"]}
              onChange={(event) =>
                ConfigurationService.updateValue(
                  "ai.debug.dumpHttp",
                  event.target.checked,
                )
              }
            />
            <span>{t("settings.ai.debugDumpHttpHint")}</span>
          </label>
        </SettingRow>
      ) : null}
    </section>
  );
}

type SettingsEditorProps = {
  /** Absent → the Export/Import buttons are hidden (e.g. host app has no file-I/O support). */
  onExportSettings?: () => Promise<boolean>;
  onImportSettings?: () => Promise<boolean>;
};

function SettingsEditor({ onExportSettings, onImportSettings }: SettingsEditorProps) {
  const category = useSettingsCategory();
  const { t } = useI18n();
  const [ioMessage, setIoMessage] = useState<string | null>(null);
  const [ioTone, setIoTone] = useState<"info" | "error" | "success">("info");
  const [ioBusy, setIoBusy] = useState(false);

  async function handleExport(): Promise<void> {
    if (!onExportSettings) return;
    setIoBusy(true);
    setIoMessage(null);
    try {
      const ok = await onExportSettings();
      setIoTone(ok ? "success" : "info");
      setIoMessage(ok ? t("settings.exportSuccess") : null);
    } catch (error) {
      setIoTone("error");
      setIoMessage(error instanceof Error ? error.message : t("settings.exportFailed"));
    } finally {
      setIoBusy(false);
    }
  }

  async function handleImport(): Promise<void> {
    if (!onImportSettings) return;
    setIoBusy(true);
    setIoMessage(null);
    try {
      const ok = await onImportSettings();
      setIoTone(ok ? "success" : "info");
      setIoMessage(ok ? t("settings.importSuccess") : null);
    } catch (error) {
      setIoTone("error");
      setIoMessage(error instanceof Error ? error.message : t("settings.importFailed"));
    } finally {
      setIoBusy(false);
    }
  }

  return (
    <main className="settings-editor" data-testid="settings-editor">
      <aside className="settings-editor__sidebar">
        <div className="settings-editor__sidebar-title">{t("settings.title")}</div>
        <nav className="settings-editor__nav">
          {SettingsService.getCategories().map((item) => {
            const available = SETTINGS_CATEGORY_AVAILABLE[item];
            return (
              <button
                key={item}
                type="button"
                className={`settings-editor__nav-item${
                  category === item ? " settings-editor__nav-item--active" : ""
                }${available ? "" : " settings-editor__nav-item--disabled"}`}
                disabled={!available}
                onClick={() => SettingsService.setActiveCategory(item)}
              >
                {t(SETTINGS_CATEGORY_MESSAGE_KEYS[item])}
                {!available ? (
                  <span className="settings-editor__nav-badge">
                    {t("settings.soon")}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
        {onExportSettings || onImportSettings ? (
          <div className="settings-editor__sidebar-footer">
            {onExportSettings ? (
              <button
                type="button"
                className="settings-button"
                disabled={ioBusy}
                onClick={() => void handleExport()}
              >
                {t("settings.export")}
              </button>
            ) : null}
            {onImportSettings ? (
              <button
                type="button"
                className="settings-button"
                disabled={ioBusy}
                onClick={() => void handleImport()}
              >
                {t("settings.import")}
              </button>
            ) : null}
            {ioMessage ? (
              <p className={`settings-editor__sidebar-status settings-editor__sidebar-status--${ioTone}`}>
                {ioMessage}
              </p>
            ) : null}
          </div>
        ) : null}
      </aside>
      <div className="settings-editor__content">
        {category === "appearance" ? <AppearanceSettings /> : null}
        {category === "editor" ? <EditorSettings /> : null}
        {category === "database" ? <DatabaseSettings /> : null}
        {category === "queryResult" ? <QueryResultSettings /> : null}
        {category === "ai" ? <AiSettings /> : null}
      </div>
    </main>
  );
}

export default SettingsEditor;
