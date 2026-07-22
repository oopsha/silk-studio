import { useEffect, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import type { MetadataObject, MetadataObjectKind } from "@silk-studio/db-protocol";
import { ConnectionEditorService } from "../../services/connection/connectionEditorService";
import { ConnectionService } from "../../services/connection/connectionService";
import { ConnectionTreeService } from "../../services/connection/connectionTreeService";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import {
  getMetadataGroupDefinition,
  sortMetadataGroups,
} from "../../services/connection/metadataGroups";
import { useConnectionState } from "../../services/connection/useConnectionState";
import { useConnectionTree } from "../../services/connection/useConnectionTree";
import type { ConnectionProfile } from "../../services/connection/connectionTypes";
import "./ConnectionsExplorer.css";

type ExpandedMap = Record<string, boolean>;

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

function ProfileTree({
  profile,
  isConnected,
  isActive,
}: {
  profile: ConnectionProfile;
  isConnected: boolean;
  isActive: boolean;
}) {
  const tree = useConnectionTree(isConnected ? profile.id : null);
  const [expanded, setExpanded] = useState<ExpandedMap>({});
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected) {
      setExpanded({});
      setLocalError(null);
    }
  }, [isConnected]);

  function toggle(key: string, defaultValue = false) {
    setExpanded((current) => ({
      ...current,
      [key]: !(current[key] ?? defaultValue),
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

  const profileExpanded = expanded[`profile:${profile.id}`] ?? isConnected;

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
          aria-label={profileExpanded ? "Collapse" : "Expand"}
          onClick={() => {
            const next = !profileExpanded;
            setExpanded((current) => ({
              ...current,
              [`profile:${profile.id}`]: next,
            }));
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
                await ConnectionService.disconnect();
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
              title="Disconnect"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await ConnectionService.disconnect();
                })
              }
            >
              <Codicon name="debug-disconnect" />
            </button>
          ) : (
            <button
              type="button"
              className="connections-explorer__icon-button"
              title="Connect"
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
            title="Refresh"
            disabled={busy || !isConnected}
            onClick={() =>
              void run(async () => {
                await ConnectionTreeService.loadSchemas(profile.id, true);
              })
            }
          >
            <Codicon name="refresh" />
          </button>
          <button
            type="button"
            className="connections-explorer__icon-button"
            title="Edit"
            disabled={busy}
            onClick={() => ConnectionEditorService.openConnection(profile.id)}
          >
            <Codicon name="edit" />
          </button>
          <button
            type="button"
            className="connections-explorer__icon-button"
            title="Duplicate"
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
            title="Delete"
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
          {localError ?? tree.errorMessage}
        </div>
      ) : null}

      {profileExpanded ? (
        <div className="connections-explorer__children">
          {!isConnected ? (
            <div className="connections-explorer__empty">
              Connect to browse schemas and objects.
            </div>
          ) : tree.status === "loading" ? (
            <div className="connections-explorer__empty">Loading schemas…</div>
          ) : tree.schemas.length === 0 ? (
            <div className="connections-explorer__empty">No schemas found.</div>
          ) : (
            tree.schemas.map((schema) => {
              const schemaKey = `schema:${profile.id}:${schema.name}`;
              const schemaExpanded = expanded[schemaKey] ?? false;
              const isDefaultSchema =
                profile.defaultSchema.trim().length > 0 &&
                schema.name.toLowerCase() ===
                  profile.defaultSchema.trim().toLowerCase();
              return (
                <div key={schema.name} className="connections-explorer__node">
                  <div className="connections-explorer__row">
                    <button
                      type="button"
                      className="connections-explorer__twistie"
                      onClick={() => {
                        const next = !schemaExpanded;
                        toggle(schemaKey);
                        if (next && schema.status === "idle") {
                          void run(() =>
                            ConnectionTreeService.loadSchemaObjects(
                              profile.id,
                              schema.name,
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
                        isDefaultSchema ? "Default schema for this connection" : undefined
                      }
                    >
                      <Codicon name="symbol-namespace" />
                      <span>{schema.name}</span>
                    </span>
                  </div>
                  {schemaExpanded ? (
                    <div className="connections-explorer__children">
                      {schema.status === "loading" ? (
                        <div className="connections-explorer__empty">
                          Loading objects…
                        </div>
                      ) : schema.status === "error" ? (
                        <div className="connections-explorer__error">
                          {schema.errorMessage}
                        </div>
                      ) : (
                        sortMetadataGroups(schema.groups).map((group) => {
                          const definition = getMetadataGroupDefinition(group.id);
                          const groupKey = `group:${definition.id}:${profile.id}:${schema.name}`;
                          const defaultExpanded = definition.id === "tables";
                          return (
                            <ObjectGroup
                              key={definition.id}
                              title={definition.title}
                              icon={definition.icon}
                              items={group.objects}
                              expanded={expanded[groupKey] ?? defaultExpanded}
                              onToggle={() => toggle(groupKey, defaultExpanded)}
                            />
                          );
                        })
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

function ObjectGroup({
  title,
  icon,
  items,
  expanded,
  onToggle,
}: {
  title: string;
  icon: string;
  items: MetadataObject[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="connections-explorer__node">
      <div className="connections-explorer__row">
        <button
          type="button"
          className="connections-explorer__twistie"
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
      </div>
      {expanded ? (
        <div className="connections-explorer__children">
          {items.length === 0 ? (
            <div className="connections-explorer__empty">None</div>
          ) : (
            items.map((item) => (
              <div key={item.name} className="connections-explorer__row">
                <span className="connections-explorer__twistie-spacer" />
                <span className="connections-explorer__label">
                  <Codicon name={objectIcon(item.kind)} />
                  <span>{item.name}</span>
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function ConnectionsExplorer() {
  const connection = useConnectionState();

  return (
    <div className="connections-explorer">
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
            isConnected={connection.connectedProfileId === profile.id}
          />
        ))
      )}
      {connection.status === "error" && connection.errorMessage ? (
        <div className="connections-explorer__error connections-explorer__error--root">
          {connection.errorMessage}
        </div>
      ) : null}
    </div>
  );
}

export default ConnectionsExplorer;
