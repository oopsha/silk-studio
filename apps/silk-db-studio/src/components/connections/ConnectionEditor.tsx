import { useEffect, useMemo, useState } from "react";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { I18nService } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import { shouldUseDevSecretStore } from "@silk-studio/workbench/services/secrets/devSecretStore.ts";
import { ConnectionEditorService } from "../../services/connection/connectionEditorService";
import { ConnectionService } from "../../services/connection/connectionService";
import { ConnectionTreeService } from "../../services/connection/connectionTreeService";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import { useConnectionState } from "../../services/connection/useConnectionState";
import {
  useConnectionTree,
  getExplorerSchemas,
} from "../../services/connection/useConnectionTree";
import type {
  ConnectionDriverId,
  ConnectionProfileInput,
} from "../../services/connection/connectionTypes";
import {
  CONNECTION_DRIVERS,
  DEFAULT_ORACLE_URL,
  getConnectionDriver,
} from "../../services/connection/connectionTypes";
import { showSystemObjectsHint } from "../../services/connection/systemNamespaces";
import "./ConnectionEditor.css";

const EMPTY_FORM: ConnectionProfileInput = {
  name: "",
  driverId: "oracle",
  url: DEFAULT_ORACLE_URL,
  user: "",
  password: "",
  catalog: "",
  defaultSchema: "",
  showSystemObjects: false,
};

function ConnectionEditor() {
  const { t } = useI18n();
  const activeTab = useActiveEditor();
  const profileId = ConnectionEditorService.getProfileIdFromUri(activeTab?.uri);
  const connection = useConnectionState();
  const isEditingConnectedProfile =
    profileId !== null &&
    profileId !== "new" &&
    connection.connectedProfileIds.includes(profileId);
  const tree = useConnectionTree(
    isEditingConnectedProfile ? profileId : null,
  );
  const [form, setForm] = useState<ConnectionProfileInput>(EMPTY_FORM);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const driver = getConnectionDriver(form.driverId);

  const schemaOptions = useMemo(() => {
    const names = getExplorerSchemas(tree).map((schema) => schema.name);
    const selected = form.defaultSchema.trim();
    if (selected && !names.some((name) => name === selected)) {
      return [selected, ...names];
    }
    return names;
  }, [form.defaultSchema, tree]);

  useEffect(() => {
    if (!profileId) return;
    const id = profileId;
    let cancelled = false;

    async function load() {
      setMessage(null);
      setError(null);
      if (id === "new") {
        setForm(EMPTY_FORM);
        return;
      }

      const profile = ConnectionService.getProfile(id);
      if (!profile) {
        setError(I18nService.t("app.connection.notFound"));
        setForm(EMPTY_FORM);
        return;
      }

      setForm({
        name: profile.name,
        driverId: profile.driverId,
        url: profile.url,
        user: profile.user,
        password: "",
        catalog: profile.catalog,
        defaultSchema: profile.defaultSchema,
        showSystemObjects: profile.showSystemObjects,
      });
      const password = await ConnectionService.getPassword(id);
      if (!cancelled) {
        setForm((current) => ({ ...current, password }));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  if (!profileId) {
    return (
      <main className="connection-editor">
        <p className="connection-editor__error">
          {t("app.connection.invalidEditor")}
        </p>
      </main>
    );
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(formatErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="connection-editor">
      <header className="connection-editor__header">
        <h2 className="connection-editor__title">
          {profileId === "new"
            ? t("app.connection.newTitle")
            : t("app.connection.editTitle")}
        </h2>
        <p className="connection-editor__intro">
          {shouldUseDevSecretStore()
            ? t("app.connection.introDev")
            : t("app.connection.introRelease")}
        </p>
      </header>

      {message ? (
        <p className="connection-editor__feedback connection-editor__feedback--success">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="connection-editor__feedback connection-editor__feedback--error">
          {error}
        </p>
      ) : null}

      <form
        className="connection-editor__form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            if (profileId === "new") {
              const created = await ConnectionService.createProfile(form);
              setMessage(t("app.connection.created"));
              if (activeTab) {
                EditorService.closeTab(activeTab.id);
              }
              ConnectionEditorService.openConnection(created.id);
              return;
            }
            await ConnectionService.updateProfile(profileId, form);
            setMessage(t("app.connection.saved"));
          });
        }}
      >
        <label className="connection-editor__field">
          <span>{t("app.connection.name")}</span>
          <input
            className="connection-editor__input"
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            placeholder={t("app.connection.namePlaceholder")}
          />
        </label>
        <label className="connection-editor__field">
          <span>{t("app.connection.driver")}</span>
          <select
            className="connection-editor__input"
            value={form.driverId}
            onChange={(event) => {
              const nextDriverId = event.target.value as ConnectionDriverId;
              setForm((current) => {
                const previousDefault = getConnectionDriver(
                  current.driverId,
                ).defaultUrl;
                const nextDefault = getConnectionDriver(nextDriverId).defaultUrl;
                const urlIsUnset =
                  current.url.trim() === "" ||
                  current.url.trim() === previousDefault;
                return {
                  ...current,
                  driverId: nextDriverId,
                  url: urlIsUnset ? nextDefault : current.url,
                  catalog: getConnectionDriver(nextDriverId).supportsCatalog
                    ? current.catalog
                    : "",
                };
              });
            }}
          >
            {CONNECTION_DRIVERS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="connection-editor__field">
          <span>{t("app.connection.jdbcUrl")}</span>
          <input
            className="connection-editor__input"
            value={form.url}
            onChange={(event) =>
              setForm((current) => ({ ...current, url: event.target.value }))
            }
          />
        </label>
        <label className="connection-editor__field">
          <span>{t("app.connection.user")}</span>
          <input
            className="connection-editor__input"
            value={form.user}
            onChange={(event) =>
              setForm((current) => ({ ...current, user: event.target.value }))
            }
          />
        </label>
        <label className="connection-editor__field">
          <span>{t("app.connection.password")}</span>
          <input
            className="connection-editor__input"
            type="password"
            autoComplete="off"
            value={form.password}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                password: event.target.value,
              }))
            }
          />
        </label>
        {driver.supportsCatalog ? (
          <label className="connection-editor__field">
            <span>{driver.catalogLabel}</span>
            <input
              className="connection-editor__input"
              value={form.catalog}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  catalog: event.target.value,
                }))
              }
              placeholder={t("app.connection.catalogPlaceholder")}
              spellCheck={false}
            />
            {driver.catalogHint ? (
              <span className="connection-editor__hint">{driver.catalogHint}</span>
            ) : null}
          </label>
        ) : null}
        {driver.showSchemaField ? (
          <label className="connection-editor__field">
            <span>{driver.schemaLabel}</span>
            <div className="connection-editor__schema-row">
              <input
                className="connection-editor__input"
                list="connection-editor-schemas"
                value={form.defaultSchema}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    defaultSchema: event.target.value,
                  }))
                }
                placeholder={t("app.connection.schemaPlaceholder")}
                spellCheck={false}
              />
              <datalist id="connection-editor-schemas">
                {schemaOptions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <button
                type="button"
                className="connection-editor__button"
                disabled={busy || !isEditingConnectedProfile}
                title={
                  isEditingConnectedProfile
                    ? t("app.connection.loadSchemasTitle")
                    : t("app.connection.loadSchemasNeedConnect")
                }
                onClick={() =>
                  void run(async () => {
                    if (typeof profileId !== "string" || profileId === "new") {
                      return;
                    }
                    await ConnectionTreeService.loadSchemas(profileId, true);
                    setMessage(t("app.connection.schemasRefreshed"));
                  })
                }
              >
                {t("app.connection.loadSchemas")}
              </button>
            </div>
            <span className="connection-editor__hint">{driver.schemaHint}</span>
          </label>
        ) : (
          <p className="connection-editor__hint">
            {t("app.connection.noSchemaConcept")
              .replace("{driver}", driver.label)
              .replace("{catalog}", driver.catalogLabel)}
          </p>
        )}
        <label className="connection-editor__field connection-editor__field--checkbox">
          <span className="connection-editor__checkbox-row">
            <input
              type="checkbox"
              checked={form.showSystemObjects}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  showSystemObjects: event.target.checked,
                }))
              }
            />
            <span>{t("app.connection.showSystemObjects")}</span>
          </span>
          <span className="connection-editor__hint">
            {showSystemObjectsHint(form.driverId)}
          </span>
        </label>
        <div className="connection-editor__actions">
          <button
            type="submit"
            className="connection-editor__button connection-editor__button--primary"
            disabled={busy}
          >
            {t("common.save")}
          </button>
          <button
            type="button"
            className="connection-editor__button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await ConnectionService.testCredentials(form);
                setMessage(t("app.connection.testPassed"));
              })
            }
          >
            {t("common.test")}
          </button>
          {profileId !== "new" ? (
            <button
              type="button"
              className="connection-editor__button connection-editor__button--primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await ConnectionService.connect(profileId);
                  setMessage(t("app.connection.connected"));
                })
              }
            >
              {t("common.connect")}
            </button>
          ) : null}
        </div>
      </form>
    </main>
  );
}

export default ConnectionEditor;
