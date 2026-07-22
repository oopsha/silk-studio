import type { ReactNode } from "react";
import { ConfigurationService } from "../../platform/configuration/configurationService";
import type {
  AiProviderId,
  ColorThemeId,
  LineNumbersMode,
  WordWrapMode,
} from "../../platform/configuration/configurationDefaults";
import { useConfiguration } from "../../platform/configuration/useConfiguration";
import {
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
};

function SettingRow({ title, description, children }: SettingRowProps) {
  return (
    <div className="settings-row">
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
        description="한 번에 조회할 최대 행 수입니다. 다음 쿼리 실행부터 적용됩니다."
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

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">AI</h2>
      <p className="settings-placeholder settings-placeholder--intro">
        AI 어시스턴트 본 기능은 roadmap 8번에서 구현됩니다. 여기서는 BYOK,
        모델, 컨텍스트 범위 등 기본 설정만 저장합니다. API 키는 현재{" "}
        <code>localStorage</code>에 저장되며, 이후 Tauri 보안 저장소로
        이전됩니다.
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
        description="BYOK(Bring Your Own Key) 제공자를 선택합니다."
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
      <SettingRow
        title="API Key"
        description="제공자 API 키입니다. 비워 두면 AI Chat이 구성 대기 상태로 표시됩니다."
      >
        <input
          className="settings-control"
          type="password"
          autoComplete="off"
          placeholder="sk-..."
          value={configuration["ai.apiKey"]}
          onChange={(event) =>
            ConfigurationService.updateValue("ai.apiKey", event.target.value)
          }
        />
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
