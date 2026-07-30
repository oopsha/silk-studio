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
import { AiSecretService } from "../../services/ai/aiSecretService";
import { testConfiguredConnection } from "../../services/ai/aiProviderService";
import { AiProviderError } from "../../services/ai/aiProviderTypes";
import { useAiHasApiKey } from "../../services/ai/useAiReadyState";
import {
  AI_API_KEY_PLACEHOLDERS,
  AI_DEFAULT_MODEL,
  AI_MODEL_PRESETS,
  AI_PROVIDER_LABELS,
  resolveAiModelForProvider,
} from "../../services/settings/aiSettingsConstants";
import {
  SETTINGS_CATEGORY_AVAILABLE,
  SETTINGS_CATEGORY_LABELS,
} from "../../services/settings/settingsConstants";
import { SettingsService } from "../../services/settings/settingsService";
import { useSettingsCategory } from "../../services/settings/useSettingsCategory";
import "./SettingsEditor.css";

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

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Appearance</h2>
      <SettingRow
        title="Color Theme"
        description="워크벤치와 에디터에 적용할 색 테마입니다."
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
        title="UI Font Size"
        description="사이드바, 메뉴, 패널 등 워크벤치 UI 글꼴 크기입니다."
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

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Editor</h2>
      <SettingRow title="Font Size">
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
      <SettingRow title="Tab Size">
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
      <SettingRow title="Insert Spaces">
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
          <span>탭 키 입력 시 공백을 삽입합니다.</span>
        </label>
      </SettingRow>
      <SettingRow title="Line Numbers">
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
      <SettingRow title="Minimap">
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
          <span>에디터 미니맵을 표시합니다.</span>
        </label>
      </SettingRow>
      <SettingRow title="Word Wrap">
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

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Database</h2>
      <p className="settings-placeholder settings-placeholder--intro">
        Connection profiles are managed in the Explorer{" "}
        <strong>Connections</strong> view. This page only configures session
        options for query execution.
      </p>
      <h3 className="settings-section__subtitle">Session Options</h3>
      <SettingRow
        title="Query Timeout"
        description="쿼리 실행 제한 시간(초)입니다."
      >
        <input
          className="settings-control settings-control--number"
          type="number"
          min={5}
          max={600}
          value={configuration["database.queryTimeoutSec"]}
          onChange={(event) =>
            ConfigurationService.updateValue(
              "database.queryTimeoutSec",
              Number(event.target.value),
            )
          }
        />
      </SettingRow>
      <SettingRow title="Auto Commit">
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
          <span>JDBC 연결의 auto commit을 사용합니다.</span>
        </label>
      </SettingRow>
      <SettingRow
        title="Read Only"
        description="활성화하면 INSERT/UPDATE/DELETE/DDL 등 쓰기 쿼리를 차단합니다."
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
          <span>읽기 전용 보호를 사용합니다.</span>
        </label>
      </SettingRow>
      <SettingRow
        title="Preload Default Schema"
        description="연결 성공 후 기본 스키마 객체를 자동으로 로드합니다. Quick Pick 검색에 바로 쓰입니다."
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
          <span>기본 스키마를 미리 로드합니다.</span>
        </label>
      </SettingRow>
    </section>
  );
}

function QueryResultSettings() {
  const configuration = useConfiguration();

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Query Result</h2>
      <SettingRow
        title="Max Rows"
        description="한 번에 조회할 최대 행 수입니다. 초과분은 잘리고 Truncated 배지로 표시됩니다. 다음 쿼리 실행부터 적용됩니다."
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
      <SettingRow title="Row Height">
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
      <SettingRow title="Font Size">
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
        title="NULL Display"
        description="NULL 값을 결과 그리드에 표시할 문자열입니다."
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
      <SettingRow title="Column Filters">
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
          <span>결과 그리드 컬럼 필터를 기본으로 사용합니다.</span>
        </label>
      </SettingRow>
    </section>
  );
}

function AiSettings() {
  const configuration = useConfiguration();
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
    ? "Saved in OS keyring — enter a new key to replace"
    : AI_API_KEY_PLACEHOLDERS[provider];

  async function handleSaveKey(): Promise<void> {
    const next = draftKey.trim();
    if (!next) {
      setStatusTone("error");
      setStatusMessage("Enter an API key to save.");
      return;
    }
    setKeyBusy(true);
    setStatusMessage(null);
    try {
      await AiSecretService.setApiKey(provider, next);
      setDraftKey("");
      setStatusTone("success");
      setStatusMessage("API key saved to the OS keyring.");
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to save API key.",
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
      setStatusMessage("API key removed from the OS keyring.");
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to clear API key.",
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
      setStatusMessage("Connection test succeeded.");
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(
        error instanceof AiProviderError || error instanceof Error
          ? error.message
          : "Connection test failed.",
      );
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">AI</h2>
      <p className="settings-placeholder settings-placeholder--intro">
        BYOK(Bring Your Own Key)로 제공자 API를 직접 연결합니다. API 키는
        configuration이 아니라 <strong>OS 자격 증명 저장소(키링)</strong>에
        provider별로 보관됩니다. Chat UI는 이후 단계에서 연결됩니다.
      </p>
      <SettingRow title="Enable AI Assistant">
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
          <span>AI Chat 패널과 어시스턴트 기능을 사용합니다.</span>
        </label>
      </SettingRow>
      <SettingRow
        title="Provider"
        description="기본 제공자는 Google Gemini(AI Studio Free Tier)입니다."
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
        title="Model"
        description="사용할 모델 ID입니다. Custom 제공자는 직접 입력합니다."
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
          title="Custom Base URL"
          description="OpenAI-compatible Chat Completions 엔드포인트 (예: https://api.example.com/v1)."
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
        title="API Key"
        description={
          provider === "gemini"
            ? "Google AI Studio 키. Free Tier는 프로젝트 RPM/TPM/RPD 한도가 있으며, 빌링 미연결 시 초과분 자동 과금은 없습니다. 2026-06 이후 unrestricted 키는 거절될 수 있으니 AI Studio에서 새 키를 만들거나 Generative Language API로 제한하세요."
            : "제공자 API 키입니다. 저장 시 OS 키링에만 기록되며 localStorage에는 남지 않습니다."
        }
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
              ? "Key stored for this provider"
              : "No key stored for this provider"}
          </div>
          <div className="settings-ai-key__actions">
            <button
              type="button"
              className="settings-button"
              disabled={keyBusy || draftKey.trim().length === 0}
              onClick={() => void handleSaveKey()}
            >
              Save
            </button>
            <button
              type="button"
              className="settings-button"
              disabled={keyBusy || !hasStoredKey}
              onClick={() => void handleClearKey()}
            >
              Clear
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
              {testBusy ? "Testing…" : "Test connection"}
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
      <SettingRow title="Context: Schema">
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
          <span>연결된 DB 스키마·객체 메타데이터를 컨텍스트에 포함합니다.</span>
        </label>
      </SettingRow>
      <SettingRow title="Context: Editor Selection">
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
          <span>에디터에서 선택한 SQL 텍스트를 컨텍스트에 포함합니다.</span>
        </label>
      </SettingRow>
      <SettingRow title="Context: Query History">
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
          <span>최근 실행한 쿼리 기록을 컨텍스트에 포함합니다.</span>
        </label>
      </SettingRow>
      <SettingRow
        title="Allow SQL Execution"
        description="활성화하면 AI가 생성한 SQL 실행을 허용합니다. roadmap 8에서 권한 분리와 함께 적용됩니다."
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
          <span>AI가 제안한 SQL을 자동 실행할 수 있게 합니다.</span>
        </label>
      </SettingRow>
    </section>
  );
}

function SettingsEditor() {
  const category = useSettingsCategory();

  return (
    <main className="settings-editor">
      <aside className="settings-editor__sidebar">
        <div className="settings-editor__sidebar-title">Settings</div>
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
                {SETTINGS_CATEGORY_LABELS[item]}
                {!available ? (
                  <span className="settings-editor__nav-badge">Soon</span>
                ) : null}
              </button>
            );
          })}
        </nav>
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
