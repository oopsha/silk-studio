import { useEffect, useState } from "react";
import type { ConnectionDependency, MetadataObjectKind } from "@silk-studio/db-protocol";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import {
  bridgeListObjectDependencies,
  bridgeListObjectDependents,
} from "../../services/connection/connectionDependenciesBridge";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import type { ExplorerObjectRef } from "../../services/connection/explorerObjectActions";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import { openObjectEditor } from "../../services/connection/objectEditorService";
import { openObjectDdl } from "../../services/connection/ddlEditorService";
import {
  getCachedObjectPreview,
  setCachedObjectPreview,
} from "../../services/connection/objectPreviewCache";
import "./TablePropertySection.css";
import "./DependenciesPreview.css";

/**
 * Maps a dependency's driver-specific `type` text (Oracle's ALL_DEPENDENCIES.TYPE, or the
 * literal 'TABLE'/'VIEW' this app's own Postgres view-dependency query emits) to the
 * MetadataObjectKind the Object Editor / DDL viewer route on. Kinds with no Object Editor
 * destination (INDEX, SEQUENCE, SYNONYM, TRIGGER, TYPE, ...) resolve to null — double-click
 * is a no-op for those rows. PACKAGE BODY isn't independently addressable (see
 * DbDialect#collectPackageMembers's doc comment), so it opens the package itself.
 */
function resolveOpenableKind(dependencyType: string): MetadataObjectKind | null {
  switch (dependencyType.trim().toUpperCase()) {
    case "TABLE":
    case "USER_TABLE":
    case "SYSTEM_TABLE":
      return "table";
    case "VIEW":
    case "MATERIALIZED VIEW":
      return "view";
    case "PROCEDURE":
    case "SQL_STORED_PROCEDURE":
      return "procedure";
    case "FUNCTION":
    case "SQL_SCALAR_FUNCTION":
    case "SQL_TABLE_VALUED_FUNCTION":
    case "SQL_INLINE_TABLE_VALUED_FUNCTION":
      return "function";
    case "PACKAGE":
    case "PACKAGE BODY":
      return "package";
    case "TRIGGER":
    case "SQL_TRIGGER":
      return "trigger";
    default:
      return null;
  }
}

/** Opens a dependency-table row's referenced object, routing table/view to the Object Editor
 *  and procedure/function/package to the DDL viewer — same split as {@link
 *  defaultObjectAction} in explorerObjectActions.ts. No-op when the row's type isn't openable. */
function openDependencyEntry(objectRef: ObjectEditorRef, entry: ConnectionDependency): void {
  const kind = resolveOpenableKind(entry.type);
  if (!kind) return;
  const target: ExplorerObjectRef = {
    profileId: objectRef.profileId,
    schemaName: entry.schema,
    object: { name: entry.name, kind },
    catalogName: objectRef.catalogName,
  };
  if (kind === "table" || kind === "view") {
    openObjectEditor(target);
  } else {
    openObjectDdl(target);
  }
}

type CachedDependenciesPreview = {
  dependencies: ConnectionDependency[];
  dependents: ConnectionDependency[];
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ({ status: "ready" } & CachedDependenciesPreview);

type DependenciesPreviewProps = {
  objectRef: ObjectEditorRef;
};

function DependencyTable({
  entries,
  emptyLabel,
  nameHeader,
  objectRef,
  openHint,
}: {
  entries: ConnectionDependency[];
  emptyLabel: string;
  nameHeader: [string, string, string];
  objectRef: ObjectEditorRef;
  openHint: string;
}) {
  if (entries.length === 0) {
    return <div className="table-property-section__status">{emptyLabel}</div>;
  }
  return (
    <table className="table-property-section__table">
      <thead>
        <tr>
          <th className="table-property-section__index-cell">#</th>
          <th>{nameHeader[0]}</th>
          <th>{nameHeader[1]}</th>
          <th>{nameHeader[2]}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, position) => {
          const openable = resolveOpenableKind(entry.type) !== null;
          return (
            <tr
              key={`${entry.schema}.${entry.name}.${entry.type}`}
              className={openable ? "table-property-section__row--clickable" : undefined}
              onDoubleClick={openable ? () => openDependencyEntry(objectRef, entry) : undefined}
              title={openable ? openHint : undefined}
            >
              <td className="table-property-section__index-cell">{position + 1}</td>
              <td>{`${entry.schema}.${entry.name}`}</td>
              <td>{entry.type}</td>
              <td>{entry.dependencyType ?? ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DependenciesPreview({ objectRef }: DependenciesPreviewProps) {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const cached = getCachedObjectPreview<CachedDependenciesPreview>(
      "dependencies",
      objectRef,
    );
    if (cached) {
      setLoadState({ status: "ready", ...cached });
      return;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });

    Promise.all([
      bridgeListObjectDependencies(
        objectRef.profileId,
        objectRef.schemaName,
        objectRef.objectName,
        objectRef.kind,
        undefined,
        objectRef.catalogName ?? undefined,
      ),
      bridgeListObjectDependents(
        objectRef.profileId,
        objectRef.schemaName,
        objectRef.objectName,
        objectRef.kind,
        undefined,
        objectRef.catalogName ?? undefined,
      ),
    ])
      .then(([dependenciesResult, dependentsResult]) => {
        if (cancelled) return;
        const ready: CachedDependenciesPreview = {
          dependencies: dependenciesResult.dependencies,
          dependents: dependentsResult.dependents,
        };
        setLoadState({ status: "ready", ...ready });
        setCachedObjectPreview("dependencies", objectRef, ready);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadState({
          status: "error",
          message: formatErrorMessage(error, t("app.dependencies.loadFailed")),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    objectRef.profileId,
    objectRef.schemaName,
    objectRef.objectName,
    objectRef.kind,
    objectRef.catalogName,
    t,
  ]);

  if (loadState.status === "loading") {
    return (
      <div className="table-property-section__status">{t("app.dependencies.loading")}</div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="table-property-section__status table-property-section__status--error">
        {loadState.message}
      </div>
    );
  }

  const nameHeader: [string, string, string] = [
    t("app.dependencies.name"),
    t("app.dependencies.type"),
    t("app.dependencies.dependencyType"),
  ];

  return (
    <div className="dependencies-preview">
      <div className="dependencies-preview__group">
        <div className="dependencies-preview__group-title">
          {t("app.dependencies.usesTitle")}
        </div>
        <DependencyTable
          entries={loadState.dependencies}
          emptyLabel={t("app.dependencies.usesEmpty")}
          nameHeader={nameHeader}
          objectRef={objectRef}
          openHint={t("app.dependencies.openHint")}
        />
      </div>
      <div className="dependencies-preview__group">
        <div className="dependencies-preview__group-title">
          {t("app.dependencies.usedByTitle")}
        </div>
        <DependencyTable
          entries={loadState.dependents}
          emptyLabel={t("app.dependencies.usedByEmpty")}
          nameHeader={nameHeader}
          objectRef={objectRef}
          openHint={t("app.dependencies.openHint")}
        />
      </div>
    </div>
  );
}

export default DependenciesPreview;
