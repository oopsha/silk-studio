import { useEffect, useMemo, useState } from "react";
import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import { ConnectionEditorService } from "../../services/connection/connectionEditorService";
import { ConnectionService } from "../../services/connection/connectionService";
import { ConnectionTreeService } from "../../services/connection/connectionTreeService";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import { useConnectionState } from "../../services/connection/useConnectionState";
import { useConnectionTree } from "../../services/connection/useConnectionTree";
import type {
  ConnectionDriverId,
  ConnectionProfileInput,
} from "../../services/connection/connectionTypes";
import {
  CONNECTION_DRIVERS,
  DEFAULT_ORACLE_URL,
  getConnectionDriver,
} from "../../services/connection/connectionTypes";
import { shouldUseDevSecretStore } from "@silk-studio/workbench/services/secrets/devSecretStore.ts";
import "./ConnectionEditor.css";

const EMPTY_FORM: ConnectionProfileInput = {
  name: "",
  driverId: "oracle",
  url: DEFAULT_ORACLE_URL,
  user: "",
  password: "",
  catalog: "",
  defaultSchema: "",
};

function ConnectionEditor() {
  const activeTab = useActiveEditor();
  const profileId = ConnectionEditorService.getProfileIdFromUri(activeTab?.uri);
  const connection = useConnectionState();
  const isEditingConnectedProfile =
    profileId !== null &&
    profileId !== "new" &&
    connection.connectedProfileId === profileId;
  const tree = useConnectionTree(
    isEditingConnectedProfile ? profileId : null,
  );
  const [form, setForm] = useState<ConnectionProfileInput>(EMPTY_FORM);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const driver = getConnectionDriver(form.driverId);

  const schemaOptions = useMemo(() => {
    const names = tree.schemas.map((schema) => schema.name);
    const selected = form.defaultSchema.trim();
    if (selected && !names.some((name) => name === selected)) {
      return [selected, ...names];
    }
    return names;
  }, [form.defaultSchema, tree.schemas]);

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
        setError("Connection profile not found.");
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
        <p className="connection-editor__error">Invalid connection editor.</p>
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
          {profileId === "new" ? "New Connection" : "Edit Connection"}
        </h2>
        <p className="connection-editor__intro">
          {shouldUseDevSecretStore()
            ? "개발 모드: 비밀번호는 localStorage에 보관합니다. Keychain에만 있던 값은 처음 한 번 암호를 허용하면 자동으로 이전되며, 이후에는 암호 창이 뜨지 않습니다."
            : "비밀번호는 Windows Credential Manager / macOS Keychain 등 OS 보안 저장소에 보관됩니다. Database/Schema 적용 방식은 드라이버마다 다릅니다."}
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
              setMessage("Connection profile created.");
              if (activeTab) {
                EditorService.closeTab(activeTab.id);
              }
              ConnectionEditorService.openConnection(created.id);
              return;
            }
            await ConnectionService.updateProfile(profileId, form);
            setMessage("Connection profile saved.");
          });
        }}
      >
        <label className="connection-editor__field">
          <span>Name</span>
          <input
            className="connection-editor__input"
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="Local Oracle"
          />
        </label>
        <label className="connection-editor__field">
          <span>Driver</span>
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
          <span>JDBC URL</span>
          <input
            className="connection-editor__input"
            value={form.url}
            onChange={(event) =>
              setForm((current) => ({ ...current, url: event.target.value }))
            }
          />
        </label>
        <label className="connection-editor__field">
          <span>User</span>
          <input
            className="connection-editor__input"
            value={form.user}
            onChange={(event) =>
              setForm((current) => ({ ...current, user: event.target.value }))
            }
          />
        </label>
        <label className="connection-editor__field">
          <span>Password</span>
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
              placeholder="Leave empty to use login's default database"
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
                placeholder="Leave empty to use login user"
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
                    ? "Refresh schema list from the active connection"
                    : "Connect this profile to load schemas"
                }
                onClick={() =>
                  void run(async () => {
                    if (typeof profileId !== "string" || profileId === "new") {
                      return;
                    }
                    await ConnectionTreeService.loadSchemas(profileId, true);
                    setMessage("Schema list refreshed.");
                  })
                }
              >
                Load schemas
              </button>
            </div>
            <span className="connection-editor__hint">{driver.schemaHint}</span>
          </label>
        ) : (
          <p className="connection-editor__hint">
            {driver.label} has no separate schema concept — the {driver.catalogLabel} field
            above is also the browsable namespace shown in the Explorer.
          </p>
        )}
        <div className="connection-editor__actions">
          <button
            type="submit"
            className="connection-editor__button connection-editor__button--primary"
            disabled={busy}
          >
            Save
          </button>
          <button
            type="button"
            className="connection-editor__button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await ConnectionService.testCredentials(form);
                setMessage("Connection test passed.");
              })
            }
          >
            Test
          </button>
          {profileId !== "new" ? (
            <button
              type="button"
              className="connection-editor__button connection-editor__button--primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await ConnectionService.connect(profileId);
                  setMessage("Connected.");
                })
              }
            >
              Connect
            </button>
          ) : null}
        </div>
      </form>
    </main>
  );
}

export default ConnectionEditor;
