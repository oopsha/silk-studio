import { useEffect, useState } from "react";
import type { ConnectionDependency } from "@silk-studio/db-protocol";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import {
  bridgeListObjectDependencies,
  bridgeListObjectDependents,
} from "../../services/connection/connectionDependenciesBridge";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import "./TablePropertySection.css";
import "./DependenciesPreview.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      dependencies: ConnectionDependency[];
      dependents: ConnectionDependency[];
    };

type DependenciesPreviewProps = {
  objectRef: ObjectEditorRef;
};

function DependencyTable({
  entries,
  emptyLabel,
  nameHeader,
}: {
  entries: ConnectionDependency[];
  emptyLabel: string;
  nameHeader: [string, string, string];
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
        {entries.map((entry, position) => (
          <tr key={`${entry.schema}.${entry.name}.${entry.type}`}>
            <td className="table-property-section__index-cell">{position + 1}</td>
            <td>{`${entry.schema}.${entry.name}`}</td>
            <td>{entry.type}</td>
            <td>{entry.dependencyType ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DependenciesPreview({ objectRef }: DependenciesPreviewProps) {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
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
        setLoadState({
          status: "ready",
          dependencies: dependenciesResult.dependencies,
          dependents: dependentsResult.dependents,
        });
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
        />
      </div>
    </div>
  );
}

export default DependenciesPreview;
