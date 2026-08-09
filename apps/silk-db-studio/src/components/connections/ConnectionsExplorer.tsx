import { useEffect, useMemo, useRef, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { CommandService } from "@silk-studio/workbench/platform/commands/commandService.ts";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import type {
  MetadataGroupId,
  MetadataObject,
  MetadataObjectKind,
} from "@silk-studio/db-protocol";
import { ConnectionEditorService } from "../../services/connection/connectionEditorService";
import { ConnectionService } from "../../services/connection/connectionService";
import { ConnectionTreeService } from "../../services/connection/connectionTreeService";
import {
  filterCatalogTree,
  filterSchemaTree,
  type FilteredSchemaView,
} from "../../services/connection/connectionTreeFilter";
import {
  buildCatalogMenuItems,
  buildGroupMenuItems,
  buildObjectMenuItems,
  buildSchemaMenuItems,
  defaultObjectAction,
  EXPLORER_COMMANDS,
  formatQualifiedName,
  type ExplorerMenuItem,
  type ExplorerMenuOptions,
  type ExplorerObjectRef,
} from "../../services/connection/explorerObjectActions";
import { ActiveDatabaseService } from "../../services/connection/activeDatabaseService";
import { ExplorerUiService } from "../../services/connection/explorerUiService";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import {
  getMetadataGroupDefinition,
  sortMetadataGroups,
} from "../../services/connection/metadataGroups";
import { useConnectionState } from "../../services/connection/useConnectionState";
import { useConnectionTree } from "../../services/connection/useConnectionTree";
import type { ConnectionProfile } from "../../services/connection/connectionTypes";
import { effectiveDefaultSchema } from "../../services/connection/connectionTypes";
import ExplorerContextMenu from "./ExplorerContextMenu";
import {
  beginExplorerObjectPointerDrag,
  shouldSuppressExplorerObjectClick,
} from "../../services/dnd/explorerObjectDrag";
import "./ConnectionsExplorer.css";


type ExpandedMap = Record<string, boolean>;

type SelectedObjectKey = string;

type ContextMenuState = {
  x: number;
  y: number;
  items: ExplorerMenuItem[];
  payload: unknown;
};

function objectIcon(kind: MetadataObjectKind): string {
  switch (kind) {
    case "view":
      return "symbol-interface";
    case "procedure":
      return "symbol-method";
    case "function":
      return "symbol-function";
    case "package":
      return "package";
    default:
      return "table";
  }
}

function objectSelectionKey(
  profileId: string,
  schemaName: string,
  objectName: string,
): SelectedObjectKey {
  return `${profileId}::${schemaName}::${objectName}`;
}

function ProfileTree({
  profile,
  isConnected,
  isActive,
  filter,
  selectedKey,
  onSelectObject,
  onOpenContextMenu,
  onFlash,
  menuOptions,
}: {
  profile: ConnectionProfile;
  isConnected: boolean;
  isActive: boolean;
  filter: string;
  selectedKey: SelectedObjectKey | null;
  onSelectObject: (key: SelectedObjectKey | null) => void;
  onOpenContextMenu: (state: ContextMenuState) => void;
  onFlash: (message: string) => void;
  menuOptions: ExplorerMenuOptions;
}) {
  const { t } = useI18n();
  const tree = useConnectionTree(isConnected ? profile.id : null);
  const [expanded, setExpanded] = useState<ExpandedMap>({});
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const filterActive = filter.trim().length > 0;

  useEffect(() => {
    if (!isConnected) {
      setExpanded({});
      setLocalError(null);
    }
  }, [isConnected]);

  useEffect(() => {
    let lastCollapse = ExplorerUiService.getCollapseGeneration();
    return ExplorerUiService.onDidChange(() => {
      const collapseGen = ExplorerUiService.getCollapseGeneration();
      if (collapseGen !== lastCollapse) {
        lastCollapse = collapseGen;
        setExpanded({});
      }

      const expand = ExplorerUiService.getExpandRequest();
      if (expand && expand.profileId === profile.id && isConnected) {
        const schemaKey = expand.catalogName
          ? `schema:${profile.id}:${expand.catalogName}:${expand.schemaName}`
          : `schema:${profile.id}:${expand.schemaName}`;
        setExpanded({
          [`profile:${profile.id}`]: true,
          ...(expand.catalogName
            ? { [`catalog:${profile.id}:${expand.catalogName}`]: true }
            : {}),
          [schemaKey]: true,
        });
        ExplorerUiService.clearExpandRequest();
      }
    });
  }, [profile.id, isConnected]);

  function toggle(key: string, defaultValue = false) {
    setExpanded((current) => ({
      ...current,
      [key]: !(current[key] ?? defaultValue),
    }));
  }

  function setExpandedValue(key: string, value: boolean) {
    setExpanded((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setLocalError(null);
    try {
      await action();
    } catch (error) {
      setLocalError(formatErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const useCatalogs = tree.catalogs.length > 0;
  const filteredSchemas = useMemo(
    () => filterSchemaTree(tree.schemas, filter),
    [tree.schemas, filter],
  );
  const filteredCatalogs = useMemo(
    () => filterCatalogTree(tree.catalogs, filter),
    [tree.catalogs, filter],
  );

  async function refreshSchema(schemaName: string, catalogName?: string) {
    await run(async () => {
      await ConnectionTreeService.refreshSchemaObjects(
        profile.id,
        schemaName,
        catalogName,
      );
      onFlash(
        catalogName
          ? `Refreshed ${catalogName}.${schemaName}`
          : `Refreshed ${schemaName}`,
      );
    });
  }

  async function refreshCatalog(catalogName: string) {
    await run(async () => {
      await ConnectionTreeService.loadCatalogSchemas(
        profile.id,
        catalogName,
        true,
      );
      onFlash(`Refreshed ${catalogName}`);
    });
  }

  async function handleObjectAction(ref: ExplorerObjectRef) {
    const action = defaultObjectAction(ref.object.kind, profile.driverId);
    const commandId =
      action === "openObjectEditor"
        ? EXPLORER_COMMANDS.openObjectEditor
        : action === "openSource"
          ? EXPLORER_COMMANDS.openSource
          : EXPLORER_COMMANDS.viewDdl;
    try {
      await CommandService.executeCommand(commandId, ref);
    } catch (error) {
      onFlash(formatErrorMessage(error, t("app.explorer.actionFailed")));
    }
  }

  const profileExpanded = expanded[`profile:${profile.id}`] ?? false;

  function renderSchemaEntry(
    entry: FilteredSchemaView,
    catalogName?: string,
  ) {
    if (!entry.visible) return null;
    const { schema } = entry;
    const schemaKey = catalogName
      ? `schema:${profile.id}:${catalogName}:${schema.name}`
      : `schema:${profile.id}:${schema.name}`;
    const forceExpand = filterActive && entry.visible;
    const schemaExpanded = expanded[schemaKey] ?? (forceExpand ? true : false);
    const effective = effectiveDefaultSchema(profile);
    const isDefaultSchema =
      effective.length > 0 &&
      schema.name.toLowerCase() === effective.toLowerCase();

    return (
      <div
        key={catalogName ? `${catalogName}:${schema.name}` : schema.name}
        className="connections-explorer__node"
      >
        <div
          className="connections-explorer__row"
          onContextMenu={(event) => {
            event.preventDefault();
            onOpenContextMenu({
              x: event.clientX,
              y: event.clientY,
              items: buildSchemaMenuItems(),
              payload: {
                profileId: profile.id,
                schemaName: schema.name,
                catalogName,
              },
            });
          }}
        >
          <button
            type="button"
            className="connections-explorer__twistie"
            aria-label={schemaExpanded ? t("common.collapse") : t("common.expand")}
            onClick={() => {
              const next = !schemaExpanded;
              setExpandedValue(schemaKey, next);
              if (next && schema.status === "idle") {
                void run(() =>
                  ConnectionTreeService.loadSchemaObjects(
                    profile.id,
                    schema.name,
                    false,
                    catalogName,
                  ),
                );
              }
            }}
          >
            <Codicon
              name={schemaExpanded ? "chevron-down" : "chevron-right"}
            />
          </button>
          <span
            className={`connections-explorer__label${
              isDefaultSchema
                ? " connections-explorer__label--default-schema"
                : ""
            }`}
            title={
              isDefaultSchema
                ? t("app.explorer.defaultSchemaTitle")
                : undefined
            }
          >
            <Codicon name="symbol-namespace" />
            <span>{schema.name}</span>
          </span>
          <div className="connections-explorer__row-actions">
            <button
              type="button"
              className="connections-explorer__icon-button"
              title={t("app.explorer.refreshNamed").replace("{name}", schema.name)}
              disabled={busy || !isConnected}
              onClick={(event) => {
                event.stopPropagation();
                void refreshSchema(schema.name, catalogName);
              }}
            >
              <Codicon name="refresh" />
            </button>
          </div>
        </div>
        {schemaExpanded ? (
          <div className="connections-explorer__children">
            {schema.status === "loading" ? (
              <div className="connections-explorer__empty">
                Loading objects…
              </div>
            ) : schema.status === "error" ? (
              <div className="connections-explorer__error">
                <span>{schema.errorMessage}</span>
                <button
                  type="button"
                  className="connections-explorer__link-button"
                  disabled={busy}
                  onClick={() => void refreshSchema(schema.name, catalogName)}
                >
                  {t("app.explorer.retry")}
                </button>
              </div>
            ) : schema.status === "idle" ? (
              <div className="connections-explorer__empty">
                {t("app.explorer.expandToLoadObjects")}
              </div>
            ) : entry.groups.length === 0 && filterActive ? (
              <div className="connections-explorer__empty">
                {t("app.explorer.noMatchingObjects")}
              </div>
            ) : (
              sortMetadataGroups(entry.groups.map((item) => item.group)).map(
                (group) => {
                  const definition = getMetadataGroupDefinition(group.id);
                  const filteredObjects =
                    entry.groups.find((item) => item.group.id === group.id)
                      ?.objects ?? group.objects;
                  const groupKey = catalogName
                    ? `group:${definition.id}:${profile.id}:${catalogName}:${schema.name}`
                    : `group:${definition.id}:${profile.id}:${schema.name}`;
                  const defaultExpanded = definition.id === "tables";
                  const groupForceExpand =
                    filterActive && filteredObjects.length > 0;
                  return (
                    <ObjectGroup
                      key={definition.id}
                      profileId={profile.id}
                      schemaName={schema.name}
                      menuOptions={menuOptions}
                      groupId={definition.id}
                      title={definition.title}
                      icon={definition.icon}
                      items={filteredObjects}
                      expanded={
                        expanded[groupKey] ??
                        (groupForceExpand || defaultExpanded)
                      }
                      selectedKey={selectedKey}
                      busy={busy}
                      onToggle={() => toggle(groupKey, defaultExpanded)}
                      onSelectObject={onSelectObject}
                      onOpenContextMenu={onOpenContextMenu}
                      onRefresh={() =>
                        void refreshSchema(schema.name, catalogName)
                      }
                      onObjectAction={(object) =>
                        void handleObjectAction({
                          profileId: profile.id,
                          schemaName: schema.name,
                          object,
                        })
                      }
                    />
                  );
                },
              )
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`connections-explorer__profile${
        isActive ? " connections-explorer__profile--active" : ""
      }${isConnected ? " connections-explorer__profile--connected" : ""}`}
    >
      <div className="connections-explorer__row">
        <button
          type="button"
          className="connections-explorer__twistie"
          aria-label={profileExpanded ? t("common.collapse") : t("common.expand")}
          onClick={() => {
            const next = !profileExpanded;
            setExpandedValue(`profile:${profile.id}`, next);
            if (next && isConnected && tree.status === "idle") {
              void run(() => ConnectionTreeService.loadSchemas(profile.id));
            }
          }}
        >
          <Codicon name={profileExpanded ? "chevron-down" : "chevron-right"} />
        </button>
        <button
          type="button"
          className="connections-explorer__label"
          title={
            profile.catalog.trim()
              ? `${profile.user} · ${profile.catalog} · ${profile.url}`
              : `${profile.user} · ${profile.url}`
          }
          onClick={() => ConnectionService.setActiveProfile(profile.id)}
          onDoubleClick={() =>
            void run(async () => {
              if (isConnected) {
                await ConnectionService.disconnect(profile.id);
              } else {
                await ConnectionService.connect(profile.id);
              }
            })
          }
        >
          <Codicon name="database" />
          <span className="connections-explorer__status" aria-hidden>
            {isConnected ? "●" : "○"}
          </span>
          <span>{profile.name}</span>
        </button>
        <div className="connections-explorer__row-actions">
          {isConnected ? (
            <button
              type="button"
              className="connections-explorer__icon-button"
              title={t("common.disconnect")}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await ConnectionService.disconnect(profile.id);
                })
              }
            >
              <Codicon name="debug-disconnect" />
            </button>
          ) : (
            <button
              type="button"
              className="connections-explorer__icon-button"
              title={t("common.connect")}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await ConnectionService.connect(profile.id);
                })
              }
            >
              <Codicon name="plug" />
            </button>
          )}
          <button
            type="button"
            className="connections-explorer__icon-button"
            title={t("app.explorer.refreshConnection")}
            disabled={busy || !isConnected}
            onClick={() =>
              void run(async () => {
                await ConnectionTreeService.loadSchemas(profile.id, true);
                onFlash(
                  tree.catalogs.length > 0
                    ? t("app.explorer.databasesRefreshed")
                    : t("app.explorer.schemasRefreshed"),
                );
              })
            }
          >
            <Codicon name="refresh" />
          </button>
          <button
            type="button"
            className="connections-explorer__icon-button"
            title={t("common.edit")}
            disabled={busy}
            onClick={() => ConnectionEditorService.openConnection(profile.id)}
          >
            <Codicon name="edit" />
          </button>
          <button
            type="button"
            className="connections-explorer__icon-button"
            title={t("common.duplicate")}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const duplicate = await ConnectionService.duplicateProfile(
                  profile.id,
                );
                ConnectionEditorService.openConnection(duplicate.id);
              })
            }
          >
            <Codicon name="copy" />
          </button>
          <button
            type="button"
            className="connections-explorer__icon-button"
            title={t("common.delete")}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await ConnectionService.deleteProfile(profile.id);
              })
            }
          >
            <Codicon name="trash" />
          </button>
        </div>
      </div>

      {localError || tree.errorMessage ? (
        <div className="connections-explorer__error">
          <span>{localError ?? tree.errorMessage}</span>
          {isConnected ? (
            <button
              type="button"
              className="connections-explorer__link-button"
              disabled={busy}
              onClick={() =>
                void run(() => ConnectionTreeService.loadSchemas(profile.id, true))
              }
            >
              {t("app.explorer.retry")}
            </button>
          ) : null}
        </div>
      ) : null}

      {profileExpanded ? (
        <div className="connections-explorer__children">
          {!isConnected ? (
            <div className="connections-explorer__empty">
              {t("app.explorer.connectToBrowse")}
            </div>
          ) : tree.status === "loading" ? (
            <div className="connections-explorer__empty">
              {useCatalogs ? t("app.explorer.loadingDatabases") : t("app.explorer.loadingSchemas")}
            </div>
          ) : useCatalogs ? (
            tree.catalogs.length === 0 ? (
              <div className="connections-explorer__empty">
                No databases found.
              </div>
            ) : filteredCatalogs.every((entry) => !entry.visible) ? (
              <div className="connections-explorer__empty">
                No matches for “{filter.trim()}”.
              </div>
            ) : (
              filteredCatalogs.map((entry) => {
                if (!entry.visible) return null;
                const { catalog } = entry;
                const catalogKey = `catalog:${profile.id}:${catalog.name}`;
                const forceExpand = filterActive && entry.visible;
                const catalogExpanded =
                  expanded[catalogKey] ?? (forceExpand ? true : false);
                const isCurrent =
                  tree.currentCatalog != null &&
                  catalog.name.toLowerCase() ===
                    tree.currentCatalog.toLowerCase();
                const isDefault =
                  profile.catalog.trim().length > 0 &&
                  catalog.name.toLowerCase() ===
                    profile.catalog.trim().toLowerCase();

                return (
                  <div
                    key={catalog.name}
                    className="connections-explorer__node"
                  >
                    <div
                      className="connections-explorer__row"
                      onContextMenu={(event) => {
                        event.preventDefault();
                        onOpenContextMenu({
                          x: event.clientX,
                          y: event.clientY,
                          items: buildCatalogMenuItems({
                            isCurrent,
                            isDefault,
                          }),
                          payload: {
                            profileId: profile.id,
                            catalogName: catalog.name,
                          },
                        });
                      }}
                    >
                      <button
                        type="button"
                        className="connections-explorer__twistie"
                        aria-label={catalogExpanded ? t("common.collapse") : t("common.expand")}
                        onClick={() => {
                          const next = !catalogExpanded;
                          setExpandedValue(catalogKey, next);
                          if (!next) return;
                          // Switch session + preload schemas/default objects (filter-ready).
                          void run(async () => {
                            await ActiveDatabaseService.useDatabase(
                              profile.id,
                              catalog.name,
                            );
                          });
                        }}
                      >
                        <Codicon
                          name={
                            catalogExpanded ? "chevron-down" : "chevron-right"
                          }
                        />
                      </button>
                      <span
                        className={`connections-explorer__label${
                          isCurrent
                            ? " connections-explorer__label--current-catalog"
                            : ""
                        }`}
                        title={
                          isCurrent
                            ? t("app.explorer.currentDatabaseTitle")
                            : undefined
                        }
                      >
                        <Codicon name="database" />
                        <span>{catalog.name}</span>
                      </span>
                      <div className="connections-explorer__row-actions">
                        <button
                          type="button"
                          className="connections-explorer__icon-button"
                          title={t("app.explorer.refreshNamed").replace("{name}", catalog.name)}
                          disabled={busy || !isConnected}
                          onClick={(event) => {
                            event.stopPropagation();
                            void refreshCatalog(catalog.name);
                          }}
                        >
                          <Codicon name="refresh" />
                        </button>
                      </div>
                    </div>
                    {catalogExpanded ? (
                      <div className="connections-explorer__children">
                        {catalog.status === "loading" ? (
                          <div className="connections-explorer__empty">
                            Loading schemas…
                          </div>
                        ) : catalog.status === "error" ? (
                          <div className="connections-explorer__error">
                            <span>{catalog.errorMessage}</span>
                            <button
                              type="button"
                              className="connections-explorer__link-button"
                              disabled={busy}
                              onClick={() => void refreshCatalog(catalog.name)}
                            >
                              {t("app.explorer.retry")}
                            </button>
                          </div>
                        ) : catalog.status === "idle" ? (
                          <div className="connections-explorer__empty">
                            {t("app.explorer.expandToLoadSchemas")}
                          </div>
                        ) : entry.schemas.every((schema) => !schema.visible) &&
                          filterActive ? (
                          <div className="connections-explorer__empty">
                            {t("app.explorer.noMatchingSchemas")}
                          </div>
                        ) : (
                          entry.schemas.map((schemaEntry) =>
                            renderSchemaEntry(schemaEntry, catalog.name),
                          )
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )
          ) : tree.schemas.length === 0 ? (
            <div className="connections-explorer__empty">
              {t("app.explorer.noSchemasFound")}
            </div>
          ) : filteredSchemas.every((entry) => !entry.visible) ? (
            <div className="connections-explorer__empty">
              No matches for “{filter.trim()}”.
            </div>
          ) : (
            filteredSchemas.map((entry) => renderSchemaEntry(entry))
          )}
        </div>
      ) : null}
    </div>
  );
}

function ObjectGroup({
  profileId,
  schemaName,
  groupId,
  title,
  icon,
  items,
  expanded,
  selectedKey,
  busy,
  onToggle,
  onSelectObject,
  onOpenContextMenu,
  onRefresh,
  onObjectAction,
  menuOptions,
}: {
  profileId: string;
  schemaName: string;
  menuOptions: ExplorerMenuOptions;
  groupId: MetadataGroupId;
  title: string;
  icon: string;
  items: MetadataObject[];
  expanded: boolean;
  selectedKey: SelectedObjectKey | null;
  busy: boolean;
  onToggle: () => void;
  onSelectObject: (key: SelectedObjectKey | null) => void;
  onOpenContextMenu: (state: ContextMenuState) => void;
  onRefresh: () => void;
  onObjectAction: (object: MetadataObject) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="connections-explorer__node">
      <div
        className="connections-explorer__row"
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenContextMenu({
            x: event.clientX,
            y: event.clientY,
            items: buildGroupMenuItems(),
            payload: { profileId, schemaName, groupId },
          });
        }}
      >
        <button
          type="button"
          className="connections-explorer__twistie"
          aria-label={expanded ? t("common.collapse") : t("common.expand")}
          onClick={onToggle}
        >
          <Codicon name={expanded ? "chevron-down" : "chevron-right"} />
        </button>
        <span className="connections-explorer__label">
          <Codicon name={icon} />
          <span>
            {title} ({items.length})
          </span>
        </span>
        <div className="connections-explorer__row-actions">
          <button
            type="button"
            className="connections-explorer__icon-button"
            title={t("app.explorer.refreshNamed").replace("{name}", title)}
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onRefresh();
            }}
          >
            <Codicon name="refresh" />
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="connections-explorer__children">
          {items.length === 0 ? (
            <div className="connections-explorer__empty">
              {t("app.explorer.none")}
            </div>
          ) : (
            items.map((item) => {
              const key = objectSelectionKey(profileId, schemaName, item.name);
              const selected = selectedKey === key;
              return (
                <div
                  key={item.name}
                  className={`connections-explorer__row connections-explorer__row--object${
                    selected ? " connections-explorer__row--selected" : ""
                  }`}
                  role="treeitem"
                  tabIndex={0}
                  aria-selected={selected}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    const qualified = formatQualifiedName(schemaName, item.name);
                    beginExplorerObjectPointerDrag({
                      payload: {
                        schemaName,
                        objectName: item.name,
                        kind: item.kind,
                        profileId,
                      },
                      label: qualified,
                      pointerId: event.pointerId,
                      clientX: event.clientX,
                      clientY: event.clientY,
                    });
                  }}
                  onClick={() => {
                    if (shouldSuppressExplorerObjectClick()) return;
                    onSelectObject(key);
                  }}
                  onDoubleClick={() => onObjectAction(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onObjectAction(item);
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onSelectObject(key);
                    onOpenContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      items: buildObjectMenuItems(item.kind, menuOptions),
                      payload: {
                        profileId,
                        schemaName,
                        object: item,
                      } satisfies ExplorerObjectRef,
                    });
                  }}
                >
                  <span className="connections-explorer__twistie-spacer" />
                  <span
                    className="connections-explorer__label"
                    title={formatQualifiedName(schemaName, item.name)}
                  >
                    <Codicon name={objectIcon(item.kind)} />
                    <span>{item.name}</span>
                  </span>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

function ConnectionsExplorer() {
  const { t } = useI18n();
  const connection = useConnectionState();
  const configuration = useConfiguration();
  const readOnly = configuration["database.readOnly"];
  const [filter, setFilter] = useState("");
  const [selectedKey, setSelectedKey] = useState<SelectedObjectKey | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const actionTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (actionTimerRef.current != null) {
        window.clearTimeout(actionTimerRef.current);
      }
    };
  }, []);

  function flash(message: string) {
    setActionMessage(message);
    if (actionTimerRef.current != null) {
      window.clearTimeout(actionTimerRef.current);
    }
    actionTimerRef.current = window.setTimeout(() => {
      setActionMessage(null);
      actionTimerRef.current = null;
    }, 2800);
  }

  async function handleMenuSelect(item: ExplorerMenuItem, payload: unknown) {
    if (item.stubMessage) {
      if (item.commandId) {
        await CommandService.executeCommand(item.commandId, payload);
      }
      flash(item.stubMessage);
      return;
    }

    if (item.commandId === EXPLORER_COMMANDS.copyName) {
      await CommandService.executeCommand(item.commandId, payload);
      flash(t("app.explorer.nameCopied"));
      return;
    }

    if (item.commandId === EXPLORER_COMMANDS.refreshSchema) {
      try {
        await CommandService.executeCommand(item.commandId, payload);
        const schemaName =
          payload &&
          typeof payload === "object" &&
          "schemaName" in payload &&
          typeof (payload as { schemaName: unknown }).schemaName === "string"
            ? (payload as { schemaName: string }).schemaName
            : "schema";
        flash(`Refreshed ${schemaName}`);
      } catch (error) {
        flash(formatErrorMessage(error, t("app.explorer.refreshFailed")));
      }
      return;
    }

    if (item.commandId === EXPLORER_COMMANDS.useDatabase) {
      try {
        await CommandService.executeCommand(item.commandId, payload);
        const catalogName =
          payload &&
          typeof payload === "object" &&
          "catalogName" in payload &&
          typeof (payload as { catalogName: unknown }).catalogName === "string"
            ? (payload as { catalogName: string }).catalogName
            : "";
        flash(
          catalogName
            ? t("app.explorer.usingDatabase").replace("{name}", catalogName)
            : t("app.explorer.useDatabase"),
        );
      } catch (error) {
        flash(formatErrorMessage(error, t("app.explorer.useDatabaseFailed")));
      }
      return;
    }

    if (item.commandId === EXPLORER_COMMANDS.setDefaultDatabase) {
      try {
        await CommandService.executeCommand(item.commandId, payload);
        const catalogName =
          payload &&
          typeof payload === "object" &&
          "catalogName" in payload &&
          typeof (payload as { catalogName: unknown }).catalogName === "string"
            ? (payload as { catalogName: string }).catalogName
            : "";
        flash(
          catalogName
            ? t("app.explorer.defaultDatabaseSet").replace(
                "{name}",
                catalogName,
              )
            : t("app.explorer.setDefaultDatabase"),
        );
      } catch (error) {
        flash(
          formatErrorMessage(
            error,
            t("app.explorer.setDefaultDatabaseFailed"),
          ),
        );
      }
      return;
    }

    if (item.commandId === EXPLORER_COMMANDS.refreshCatalog) {
      try {
        await CommandService.executeCommand(item.commandId, payload);
        const catalogName =
          payload &&
          typeof payload === "object" &&
          "catalogName" in payload &&
          typeof (payload as { catalogName: unknown }).catalogName === "string"
            ? (payload as { catalogName: string }).catalogName
            : "database";
        flash(t("app.explorer.refreshNamed").replace("{name}", catalogName));
      } catch (error) {
        flash(formatErrorMessage(error, t("app.explorer.refreshFailed")));
      }
      return;
    }

    if (
      item.commandId === EXPLORER_COMMANDS.openObjectEditor ||
      item.commandId === EXPLORER_COMMANDS.openSource ||
      item.commandId === EXPLORER_COMMANDS.openPackageBody ||
      item.commandId === EXPLORER_COMMANDS.viewDdl ||
      item.commandId === EXPLORER_COMMANDS.dropObject ||
      item.commandId === EXPLORER_COMMANDS.renameObject
    ) {
      try {
        await CommandService.executeCommand(item.commandId, payload);
      } catch (error) {
        flash(formatErrorMessage(error, t("app.explorer.actionFailed")));
      }
      return;
    }

    if (item.commandId) {
      await CommandService.executeCommand(item.commandId, payload);
    }
  }

  return (
    <div className="connections-explorer">
      <div className="connections-explorer__toolbar">
        <div className="connections-explorer__filter">
          <Codicon name="search" />
          <input
            type="search"
            className="connections-explorer__filter-input"
            placeholder={t("app.explorer.filterPlaceholder")}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label={t("app.explorer.filterAria")}
          />
          {filter ? (
            <button
              type="button"
              className="connections-explorer__icon-button"
              title={t("app.explorer.clearFilter")}
              aria-label={t("app.explorer.clearFilter")}
              onClick={() => setFilter("")}
            >
              <Codicon name="clear-all" />
            </button>
          ) : null}
          <button
            type="button"
            className="connections-explorer__icon-button"
            title={t("workbench.explorer.searchObjectsTitle")}
            aria-label={t("workbench.explorer.searchObjects")}
            disabled={connection.connectedProfileIds.length === 0}
            onClick={() =>
              void CommandService.executeCommand(EXPLORER_COMMANDS.searchObjects)
            }
          >
            <Codicon name="zoom-in" />
          </button>
        </div>
        {actionMessage ? (
          <div className="connections-explorer__action-msg" role="status">
            {actionMessage}
          </div>
        ) : null}
      </div>

      <div className="connections-explorer__body">
        {connection.profiles.length === 0 ? (
          <div className="connections-explorer__empty connections-explorer__empty--root">
            No connections yet. Use + to create one.
          </div>
        ) : (
          connection.profiles.map((profile) => (
            <ProfileTree
              key={profile.id}
              profile={profile}
              isActive={connection.activeProfileId === profile.id}
              isConnected={connection.connectedProfileIds.includes(profile.id)}
              filter={filter}
              selectedKey={selectedKey}
              onSelectObject={setSelectedKey}
              onOpenContextMenu={setContextMenu}
              onFlash={flash}
              menuOptions={{
                driverId: profile.driverId,
                readOnly,
                canMutate:
                  connection.connectedProfileIds.includes(profile.id) &&
                  connection.status === "connected" &&
                  !readOnly,
              }}
            />
          ))
        )}
        {connection.status === "error" && connection.errorMessage ? (
          <div className="connections-explorer__error connections-explorer__error--root">
            {connection.errorMessage}
          </div>
        ) : null}
      </div>

      {contextMenu ? (
        <ExplorerContextMenu
          anchor={{ top: contextMenu.y, left: contextMenu.x }}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
          onSelect={(item) => {
            void handleMenuSelect(item, contextMenu.payload);
          }}
        />
      ) : null}
    </div>
  );
}

export default ConnectionsExplorer;
