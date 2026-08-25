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
import type {
  OracleConnectType,
  StructuredConnectionFields,
} from "../../services/connection/connectionUrlBuilder";
import {
  DEFAULT_PORT_BY_DRIVER,
  buildJdbcUrl,
  parseJdbcUrl,
} from "../../services/connection/connectionUrlBuilder";
import {
  EMPTY_SSM_TUNNEL_CONFIG,
  tunnelSessionKey,
  type SsmTunnelConfig,
  type TunnelProgressPhase,
} from "../../services/connection/ssmTunnelTypes";
import { listSsmInstances } from "../../services/connection/ssmTunnelService";
import type { SsmInstanceSummary } from "../../services/connection/ssmTunnelBridge";
import { AWS_REGIONS } from "../../services/connection/awsRegions";
import {
  EMPTY_SSH_TUNNEL_CONFIG,
  type SecondHopConfig,
  type SshAuthMethod,
  type SshTunnelConfig,
  type SshTunnelProgressPhase,
} from "../../services/connection/sshTunnelTypes";
import {
  sshSecretGet,
  sshSecretSet,
} from "../../services/connection/sshTunnelSecretBridge";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import "./ConnectionEditor.css";

type HostPortState = { host: string; port: string };
type OracleFieldsState = { database: string; oracleConnectType: OracleConnectType };

const EMPTY_HOST_PORT: HostPortState = { host: "", port: "" };
const EMPTY_ORACLE_FIELDS: OracleFieldsState = {
  database: "",
  oracleConnectType: "service",
};

const EMPTY_FORM: ConnectionProfileInput = {
  name: "",
  driverId: "oracle",
  url: DEFAULT_ORACLE_URL,
  user: "",
  password: "",
  catalog: "",
  defaultSchema: "",
  showSystemObjects: false,
  ssmTunnel: EMPTY_SSM_TUNNEL_CONFIG,
  sshTunnel: EMPTY_SSH_TUNNEL_CONFIG,
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
  const [rawMode, setRawMode] = useState(false);
  const [rawModeHint, setRawModeHint] = useState<string | null>(null);
  const [hostPort, setHostPort] = useState<HostPortState>(EMPTY_HOST_PORT);
  const [oracleFields, setOracleFields] = useState<OracleFieldsState>(EMPTY_ORACLE_FIELDS);
  const [ssmInstances, setSsmInstances] = useState<SsmInstanceSummary[]>([]);
  const [sshPassword, setSshPassword] = useState("");
  const [sshPassphrase, setSshPassphrase] = useState("");
  const [targetPassword, setTargetPassword] = useState("");
  const [targetPassphrase, setTargetPassphrase] = useState("");
  const [savePassword, setSavePassword] = useState(true);
  const driver = getConnectionDriver(form.driverId);

  function tunnelProgressMessage(
    progress: TunnelProgressPhase | SshTunnelProgressPhase,
  ): string {
    switch (progress.phase) {
      case "openingBrowser":
        return t("app.connection.ssmProgressOpeningBrowser");
      case "waitingForSignIn":
        return t("app.connection.ssmProgressWaitingForSignIn").replace(
          "{code}",
          progress.userCode,
        );
      case "loadingInstances":
        return t("app.connection.ssmProgressLoadingInstances");
      case "startingTunnel":
        return t("app.connection.tunnelProgressStartingTunnel");
      case "connectingDatabase":
        return t("app.connection.tunnelProgressConnectingDatabase");
    }
  }

  function updateSsmTunnel(patch: Partial<SsmTunnelConfig>) {
    setForm((current) => ({
      ...current,
      ssmTunnel: { ...current.ssmTunnel, ...patch },
    }));
  }

  function updateSshTunnel(patch: Partial<SshTunnelConfig>) {
    setForm((current) => ({
      ...current,
      sshTunnel: { ...current.sshTunnel, ...patch },
    }));
  }

  function updateSecondHop(patch: Partial<SecondHopConfig>) {
    setForm((current) => ({
      ...current,
      sshTunnel: {
        ...current.sshTunnel,
        secondHop: { ...current.sshTunnel.secondHop, ...patch },
      },
    }));
  }

  /**
   * Parses `url` for `driverId` and syncs host/port/Oracle-database state from it.
   * On success, seeds `catalogSeed` (non-Oracle "database") into the given setter and
   * enters structured mode; on failure, clears structured state and forces Raw mode —
   * an existing URL that can't be losslessly represented must never be silently rebuilt.
   */
  function syncStructuredFromUrl(
    driverId: ConnectionDriverId,
    url: string,
    onCatalogSeed?: (database: string) => void,
  ): StructuredConnectionFields | null {
    const parsed = parseJdbcUrl(driverId, url);
    if (parsed) {
      setHostPort({ host: parsed.host, port: parsed.port });
      setOracleFields({
        database: parsed.database,
        oracleConnectType: parsed.oracleConnectType,
      });
      setRawMode(false);
      setRawModeHint(null);
      if (driverId !== "oracle") {
        onCatalogSeed?.(parsed.database);
      }
      return parsed;
    }
    setHostPort(EMPTY_HOST_PORT);
    setOracleFields(EMPTY_ORACLE_FIELDS);
    setRawMode(true);
    setRawModeHint(null);
    return null;
  }

  function buildUrlFromCurrentFields(
    driverId: ConnectionDriverId,
    nextHostPort: HostPortState,
    nextCatalog: string,
    nextOracleFields: OracleFieldsState,
  ): string {
    return buildJdbcUrl(driverId, {
      host: nextHostPort.host,
      port: nextHostPort.port,
      database: driverId === "oracle" ? nextOracleFields.database : nextCatalog,
      oracleConnectType: nextOracleFields.oracleConnectType,
    });
  }

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
        syncStructuredFromUrl(EMPTY_FORM.driverId, EMPTY_FORM.url);
        setSshPassword("");
        setSshPassphrase("");
        setTargetPassword("");
        setTargetPassphrase("");
        setSavePassword(true);
        return;
      }

      const profile = ConnectionService.getProfile(id);
      if (!profile) {
        setError(I18nService.t("app.connection.notFound"));
        setForm(EMPTY_FORM);
        syncStructuredFromUrl(EMPTY_FORM.driverId, EMPTY_FORM.url);
        setSshPassword("");
        setSshPassphrase("");
        setTargetPassword("");
        setTargetPassphrase("");
        setSavePassword(true);
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
        ssmTunnel: profile.ssmTunnel ?? EMPTY_SSM_TUNNEL_CONFIG,
        sshTunnel: profile.sshTunnel ?? EMPTY_SSH_TUNNEL_CONFIG,
      });
      syncStructuredFromUrl(profile.driverId, profile.url);
      const password = await ConnectionService.getPassword(id);
      const [loadedSshPassword, loadedSshPassphrase, loadedTargetPassword, loadedTargetPassphrase] =
        await Promise.all([
          sshSecretGet(id, "password"),
          sshSecretGet(id, "passphrase"),
          sshSecretGet(id, "targetPassword"),
          sshSecretGet(id, "targetPassphrase"),
        ]);
      if (!cancelled) {
        setForm((current) => ({ ...current, password }));
        setSshPassword(loadedSshPassword);
        setSshPassphrase(loadedSshPassphrase);
        setTargetPassword(loadedTargetPassword);
        setTargetPassphrase(loadedTargetPassphrase);
        setSavePassword(true);
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
      {busy && message === t("app.connection.tunnelProgressConnectingDatabase") ? (
        <p className="connection-editor__feedback">{t("app.connection.connectingHint")}</p>
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
              const created = await ConnectionService.createProfile(form, { savePassword });
              if (savePassword) {
                await Promise.all([
                  sshSecretSet(created.id, "password", sshPassword),
                  sshSecretSet(created.id, "passphrase", sshPassphrase),
                  sshSecretSet(created.id, "targetPassword", targetPassword),
                  sshSecretSet(created.id, "targetPassphrase", targetPassphrase),
                ]);
              }
              setMessage(t("app.connection.created"));
              if (activeTab) {
                EditorService.closeTab(activeTab.id);
              }
              ConnectionEditorService.openConnection(created.id);
              return;
            }
            await ConnectionService.updateProfile(profileId, form, { savePassword });
            if (savePassword) {
              await Promise.all([
                sshSecretSet(profileId, "password", sshPassword),
                sshSecretSet(profileId, "passphrase", sshPassphrase),
                sshSecretSet(profileId, "targetPassword", targetPassword),
                sshSecretSet(profileId, "targetPassphrase", targetPassphrase),
              ]);
            }
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
              const previousDefault = getConnectionDriver(form.driverId).defaultUrl;
              const nextDefault = getConnectionDriver(nextDriverId).defaultUrl;
              const urlIsUnset =
                form.url.trim() === "" || form.url.trim() === previousDefault;
              const nextUrl = urlIsUnset ? nextDefault : form.url;

              const parsed = parseJdbcUrl(nextDriverId, nextUrl);
              const nextCatalog = getConnectionDriver(nextDriverId).supportsCatalog
                ? (parsed && nextDriverId !== "oracle" ? parsed.database : form.catalog)
                : "";

              if (parsed) {
                setHostPort({ host: parsed.host, port: parsed.port });
                setOracleFields({
                  database: parsed.database,
                  oracleConnectType: parsed.oracleConnectType,
                });
                setRawMode(false);
              } else {
                setHostPort(EMPTY_HOST_PORT);
                setOracleFields(EMPTY_ORACLE_FIELDS);
                setRawMode(true);
              }
              setRawModeHint(null);

              setForm((current) => ({
                ...current,
                driverId: nextDriverId,
                url: nextUrl,
                catalog: nextCatalog,
              }));
            }}
          >
            {CONNECTION_DRIVERS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="connection-editor__field connection-editor__field--checkbox">
          <span className="connection-editor__checkbox-row">
            <input
              type="checkbox"
              checked={rawMode}
              onChange={(event) => {
                if (event.target.checked) {
                  setRawMode(true);
                  setRawModeHint(null);
                  return;
                }
                const parsed = parseJdbcUrl(form.driverId, form.url);
                if (!parsed) {
                  setRawModeHint(t("app.connection.rawUrlCannotSimplify"));
                  return;
                }
                setHostPort({ host: parsed.host, port: parsed.port });
                setOracleFields({
                  database: parsed.database,
                  oracleConnectType: parsed.oracleConnectType,
                });
                setRawMode(false);
                setRawModeHint(null);
                if (form.driverId !== "oracle") {
                  setForm((current) => ({ ...current, catalog: parsed.database }));
                }
              }}
            />
            <span>{t("app.connection.rawUrlToggle")}</span>
          </span>
          {rawModeHint ? (
            <span className="connection-editor__hint">{rawModeHint}</span>
          ) : null}
        </label>
        {rawMode ? (
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
        ) : (
          <>
            <div className="connection-editor__host-row">
              <label className="connection-editor__field connection-editor__field--host">
                <span>{t("app.connection.host")}</span>
                <input
                  className="connection-editor__input"
                  value={hostPort.host}
                  onChange={(event) => {
                    const nextHostPort = { ...hostPort, host: event.target.value };
                    setHostPort(nextHostPort);
                    setForm((current) => ({
                      ...current,
                      url: buildUrlFromCurrentFields(
                        current.driverId,
                        nextHostPort,
                        current.catalog,
                        oracleFields,
                      ),
                    }));
                  }}
                />
              </label>
              <label className="connection-editor__field connection-editor__field--port">
                <span>{t("app.connection.port")}</span>
                <input
                  className="connection-editor__input"
                  value={hostPort.port}
                  placeholder={String(DEFAULT_PORT_BY_DRIVER[form.driverId])}
                  onChange={(event) => {
                    const nextHostPort = { ...hostPort, port: event.target.value };
                    setHostPort(nextHostPort);
                    setForm((current) => ({
                      ...current,
                      url: buildUrlFromCurrentFields(
                        current.driverId,
                        nextHostPort,
                        current.catalog,
                        oracleFields,
                      ),
                    }));
                  }}
                />
              </label>
            </div>
            {form.ssmTunnel.enabled ? (
              <span className="connection-editor__hint">
                {t("app.connection.ssmHostHint")}
              </span>
            ) : null}
            {form.driverId === "oracle" ? (
              <>
                <label className="connection-editor__field">
                  <span>{driver.catalogLabel}</span>
                  <input
                    className="connection-editor__input"
                    value={oracleFields.database}
                    onChange={(event) => {
                      const nextOracleFields = {
                        ...oracleFields,
                        database: event.target.value,
                      };
                      setOracleFields(nextOracleFields);
                      setForm((current) => ({
                        ...current,
                        url: buildUrlFromCurrentFields(
                          current.driverId,
                          hostPort,
                          current.catalog,
                          nextOracleFields,
                        ),
                      }));
                    }}
                    spellCheck={false}
                  />
                </label>
                <label className="connection-editor__field">
                  <span>{t("app.connection.oracleConnectType")}</span>
                  <span className="connection-editor__checkbox-row">
                    <label>
                      <input
                        type="radio"
                        name="oracleConnectType"
                        checked={oracleFields.oracleConnectType === "service"}
                        onChange={() => {
                          const nextOracleFields = {
                            ...oracleFields,
                            oracleConnectType: "service" as const,
                          };
                          setOracleFields(nextOracleFields);
                          setForm((current) => ({
                            ...current,
                            url: buildUrlFromCurrentFields(
                              current.driverId,
                              hostPort,
                              current.catalog,
                              nextOracleFields,
                            ),
                          }));
                        }}
                      />{" "}
                      {t("app.connection.oracleServiceName")}
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="oracleConnectType"
                        checked={oracleFields.oracleConnectType === "sid"}
                        onChange={() => {
                          const nextOracleFields = {
                            ...oracleFields,
                            oracleConnectType: "sid" as const,
                          };
                          setOracleFields(nextOracleFields);
                          setForm((current) => ({
                            ...current,
                            url: buildUrlFromCurrentFields(
                              current.driverId,
                              hostPort,
                              current.catalog,
                              nextOracleFields,
                            ),
                          }));
                        }}
                      />{" "}
                      {t("app.connection.oracleSid")}
                    </label>
                  </span>
                </label>
              </>
            ) : driver.supportsCatalog ? (
              <label className="connection-editor__field">
                <span>{driver.catalogLabel}</span>
                <input
                  className="connection-editor__input"
                  value={form.catalog}
                  onChange={(event) => {
                    const nextCatalog = event.target.value;
                    setForm((current) => ({
                      ...current,
                      catalog: nextCatalog,
                      url: buildUrlFromCurrentFields(
                        current.driverId,
                        hostPort,
                        nextCatalog,
                        oracleFields,
                      ),
                    }));
                  }}
                  placeholder={t("app.connection.catalogPlaceholder")}
                  spellCheck={false}
                />
                {driver.catalogHint ? (
                  <span className="connection-editor__hint">{driver.catalogHint}</span>
                ) : null}
              </label>
            ) : null}
          </>
        )}
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
        <label className="connection-editor__field connection-editor__field--checkbox">
          <span className="connection-editor__checkbox-row">
            <input
              type="checkbox"
              checked={savePassword}
              onChange={(event) => setSavePassword(event.target.checked)}
            />
            <span>{t("app.connection.savePassword")}</span>
          </span>
          <span className="connection-editor__hint">
            {t("app.connection.savePasswordHint")}
          </span>
        </label>
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
        <label className="connection-editor__field connection-editor__field--checkbox">
          <span className="connection-editor__checkbox-row">
            <input
              type="checkbox"
              checked={form.ssmTunnel.enabled}
              onChange={(event) => {
                const enabled = event.target.checked;
                updateSsmTunnel({ enabled });
                if (enabled) updateSshTunnel({ enabled: false });
              }}
            />
            <span>{t("app.connection.ssmTunnelToggle")}</span>
          </span>
          <span className="connection-editor__hint">{t("app.connection.ssmTunnelHint")}</span>
        </label>
        {form.ssmTunnel.enabled ? (
          <>
            <label className="connection-editor__field">
              <span>{t("app.connection.ssmRegion")}</span>
              <input
                className="connection-editor__input"
                list="connection-editor-aws-regions"
                value={form.ssmTunnel.region}
                onChange={(event) => updateSsmTunnel({ region: event.target.value })}
                spellCheck={false}
              />
              <datalist id="connection-editor-aws-regions">
                {AWS_REGIONS.map((region) => (
                  <option key={region} value={region} />
                ))}
              </datalist>
            </label>
            <label className="connection-editor__field">
              <span>{t("app.connection.ssmSsoStartUrl")}</span>
              <input
                className="connection-editor__input"
                value={form.ssmTunnel.ssoStartUrl}
                onChange={(event) => updateSsmTunnel({ ssoStartUrl: event.target.value })}
                placeholder={t("app.connection.ssmSsoStartUrlPlaceholder")}
                spellCheck={false}
              />
            </label>
            <label className="connection-editor__field">
              <span>{t("app.connection.ssmTargetInstance")}</span>
              <div className="connection-editor__schema-row">
                <input
                  className="connection-editor__input"
                  list="connection-editor-ssm-instances"
                  value={form.ssmTunnel.targetInstanceId}
                  onChange={(event) =>
                    updateSsmTunnel({ targetInstanceId: event.target.value })
                  }
                  placeholder={t("app.connection.ssmTargetInstancePlaceholder")}
                  spellCheck={false}
                />
                <datalist id="connection-editor-ssm-instances">
                  {ssmInstances.map((instance) => (
                    <option key={instance.instanceId} value={instance.instanceId}>
                      {[instance.name, instance.pingStatus]
                        .filter((part) => part)
                        .join(" — ")}
                    </option>
                  ))}
                </datalist>
                <button
                  type="button"
                  className="connection-editor__button"
                  disabled={
                    busy ||
                    !form.ssmTunnel.region.trim() ||
                    !form.ssmTunnel.ssoStartUrl.trim()
                  }
                  title={t("app.connection.ssmLoadInstancesTitle")}
                  onClick={() =>
                    void run(async () => {
                      const key = tunnelSessionKey(
                        profileId !== "new" ? profileId : undefined,
                        form.ssmTunnel,
                      );
                      const result = await listSsmInstances(
                        key,
                        form.ssmTunnel.region,
                        form.ssmTunnel.ssoStartUrl,
                        (progress) => setMessage(tunnelProgressMessage(progress)),
                      );
                      setSsmInstances(result);
                      setMessage(
                        t("app.connection.ssmInstancesLoaded").replace(
                          "{n}",
                          String(result.length),
                        ),
                      );
                    })
                  }
                >
                  {t("app.connection.ssmLoadInstances")}
                </button>
              </div>
            </label>
          </>
        ) : null}
        <label className="connection-editor__field connection-editor__field--checkbox">
          <span className="connection-editor__checkbox-row">
            <input
              type="checkbox"
              checked={form.sshTunnel.enabled}
              onChange={(event) => {
                const enabled = event.target.checked;
                updateSshTunnel({ enabled });
                if (enabled) updateSsmTunnel({ enabled: false });
              }}
            />
            <span>{t("app.connection.sshTunnelToggle")}</span>
          </span>
          <span className="connection-editor__hint">{t("app.connection.sshTunnelHint")}</span>
        </label>
        {form.sshTunnel.enabled ? (
          <>
            <label className="connection-editor__field">
              <span>{t("app.connection.sshJumpHost")}</span>
              <input
                className="connection-editor__input"
                value={form.sshTunnel.host}
                onChange={(event) => updateSshTunnel({ host: event.target.value })}
                spellCheck={false}
              />
            </label>
            <label className="connection-editor__field">
              <span>{t("app.connection.sshJumpPort")}</span>
              <input
                className="connection-editor__input"
                value={form.sshTunnel.port}
                onChange={(event) => updateSshTunnel({ port: event.target.value })}
                spellCheck={false}
              />
            </label>
            <label className="connection-editor__field">
              <span>{t("app.connection.sshUsername")}</span>
              <input
                className="connection-editor__input"
                value={form.sshTunnel.username}
                onChange={(event) => updateSshTunnel({ username: event.target.value })}
                spellCheck={false}
              />
            </label>
            <label className="connection-editor__field">
              <span>{t("app.connection.sshAuthMethod")}</span>
              <select
                className="connection-editor__input"
                value={form.sshTunnel.authMethod}
                onChange={(event) =>
                  updateSshTunnel({ authMethod: event.target.value as SshAuthMethod })
                }
              >
                <option value="password">{t("app.connection.sshAuthPassword")}</option>
                <option value="privateKey">{t("app.connection.sshAuthPrivateKey")}</option>
              </select>
            </label>
            {form.sshTunnel.authMethod === "password" ? (
              <label className="connection-editor__field">
                <span>{t("app.connection.sshPassword")}</span>
                <input
                  className="connection-editor__input"
                  type="password"
                  autoComplete="off"
                  value={sshPassword}
                  onChange={(event) => setSshPassword(event.target.value)}
                />
              </label>
            ) : (
              <>
                <label className="connection-editor__field">
                  <span>{t("app.connection.sshPrivateKeyPath")}</span>
                  <div className="connection-editor__schema-row">
                    <input
                      className="connection-editor__input"
                      value={form.sshTunnel.privateKeyPath ?? ""}
                      onChange={(event) =>
                        updateSshTunnel({ privateKeyPath: event.target.value })
                      }
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="connection-editor__button"
                      onClick={() =>
                        void run(async () => {
                          const path = await openFilePicker({
                            multiple: false,
                            directory: false,
                          });
                          if (typeof path === "string") {
                            updateSshTunnel({ privateKeyPath: path });
                          }
                        })
                      }
                    >
                      {t("app.connection.sshBrowse")}
                    </button>
                  </div>
                </label>
                <label className="connection-editor__field">
                  <span>{t("app.connection.sshPassphrase")}</span>
                  <input
                    className="connection-editor__input"
                    type="password"
                    autoComplete="off"
                    value={sshPassphrase}
                    onChange={(event) => setSshPassphrase(event.target.value)}
                  />
                </label>
              </>
            )}
            <label className="connection-editor__field connection-editor__field--checkbox">
              <span className="connection-editor__checkbox-row">
                <input
                  type="checkbox"
                  checked={form.sshTunnel.secondHop.enabled}
                  onChange={(event) => updateSecondHop({ enabled: event.target.checked })}
                />
                <span>{t("app.connection.sshSecondHopToggle")}</span>
              </span>
              <span className="connection-editor__hint">
                {t("app.connection.sshSecondHopHint")}
              </span>
            </label>
            {form.sshTunnel.secondHop.enabled ? (
              <>
                <label className="connection-editor__field">
                  <span>{t("app.connection.sshSecondHopHost")}</span>
                  <input
                    className="connection-editor__input"
                    value={form.sshTunnel.secondHop.host}
                    onChange={(event) => updateSecondHop({ host: event.target.value })}
                    spellCheck={false}
                  />
                </label>
                <label className="connection-editor__field">
                  <span>{t("app.connection.sshJumpPort")}</span>
                  <input
                    className="connection-editor__input"
                    value={form.sshTunnel.secondHop.port}
                    onChange={(event) => updateSecondHop({ port: event.target.value })}
                    spellCheck={false}
                  />
                </label>
                <label className="connection-editor__field">
                  <span>{t("app.connection.sshUsername")}</span>
                  <input
                    className="connection-editor__input"
                    value={form.sshTunnel.secondHop.username}
                    onChange={(event) => updateSecondHop({ username: event.target.value })}
                    spellCheck={false}
                  />
                </label>
                <label className="connection-editor__field">
                  <span>{t("app.connection.sshAuthMethod")}</span>
                  <select
                    className="connection-editor__input"
                    value={form.sshTunnel.secondHop.authMethod}
                    onChange={(event) =>
                      updateSecondHop({ authMethod: event.target.value as SshAuthMethod })
                    }
                  >
                    <option value="password">{t("app.connection.sshAuthPassword")}</option>
                    <option value="privateKey">{t("app.connection.sshAuthPrivateKey")}</option>
                  </select>
                </label>
                {form.sshTunnel.secondHop.authMethod === "password" ? (
                  <label className="connection-editor__field">
                    <span>{t("app.connection.sshPassword")}</span>
                    <input
                      className="connection-editor__input"
                      type="password"
                      autoComplete="off"
                      value={targetPassword}
                      onChange={(event) => setTargetPassword(event.target.value)}
                    />
                  </label>
                ) : (
                  <>
                    <label className="connection-editor__field">
                      <span>{t("app.connection.sshPrivateKeyPath")}</span>
                      <div className="connection-editor__schema-row">
                        <input
                          className="connection-editor__input"
                          value={form.sshTunnel.secondHop.privateKeyPath ?? ""}
                          onChange={(event) =>
                            updateSecondHop({ privateKeyPath: event.target.value })
                          }
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          className="connection-editor__button"
                          onClick={() =>
                            void run(async () => {
                              const path = await openFilePicker({
                                multiple: false,
                                directory: false,
                              });
                              if (typeof path === "string") {
                                updateSecondHop({ privateKeyPath: path });
                              }
                            })
                          }
                        >
                          {t("app.connection.sshBrowse")}
                        </button>
                      </div>
                    </label>
                    <label className="connection-editor__field">
                      <span>{t("app.connection.sshPassphrase")}</span>
                      <input
                        className="connection-editor__input"
                        type="password"
                        autoComplete="off"
                        value={targetPassphrase}
                        onChange={(event) => setTargetPassphrase(event.target.value)}
                      />
                    </label>
                  </>
                )}
              </>
            ) : null}
          </>
        ) : null}
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
                if (form.sshTunnel.enabled) {
                  // Test can run before Save — persist the in-progress password/passphrase
                  // under the same key testCredentials() will look them up with, since
                  // SshTunnelConfig itself never carries secrets (see sshTunnelTypes.ts).
                  const sshTunnelKey = profileId !== "new" ? profileId : "pending-ssh";
                  await Promise.all([
                    sshSecretSet(sshTunnelKey, "password", sshPassword),
                    sshSecretSet(sshTunnelKey, "passphrase", sshPassphrase),
                    sshSecretSet(sshTunnelKey, "targetPassword", targetPassword),
                    sshSecretSet(sshTunnelKey, "targetPassphrase", targetPassphrase),
                  ]);
                }
                await ConnectionService.testCredentials(form, {
                  profileId: profileId !== "new" ? profileId : undefined,
                  onProgress: (progress) => setMessage(tunnelProgressMessage(progress)),
                });
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
                  await ConnectionService.connect(profileId, {
                    onProgress: (progress) => setMessage(tunnelProgressMessage(progress)),
                  });
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
