import { useEffect, useState } from "react";
import type { MetadataColumn } from "@silk-studio/db-protocol";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { bridgeListColumns } from "../../services/connection/connectionBridge";
import { bridgeListPrimaryKeys } from "../../services/connection/connectionPrimaryKeysBridge";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import {
  getCachedObjectPreview,
  setCachedObjectPreview,
} from "../../services/connection/objectPreviewCache";
import { formatColumnType } from "../../services/connection/tableColumnTypeFormat";
import "./ColumnsPreview.css";

type CachedColumnsPreview = {
  columns: MetadataColumn[];
  primaryKeyNames: Set<string>;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ({ status: "ready" } & CachedColumnsPreview);

type ColumnsPreviewProps = {
  objectRef: ObjectEditorRef;
};

function ColumnsPreview({ objectRef }: ColumnsPreviewProps) {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const cached = getCachedObjectPreview<CachedColumnsPreview>(
      "columns",
      objectRef,
    );
    if (cached) {
      setLoadState({ status: "ready", ...cached });
      return;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });

    void Promise.all([
      bridgeListColumns(
        objectRef.profileId,
        objectRef.schemaName,
        objectRef.objectName,
        objectRef.catalogName ?? undefined,
      ),
      bridgeListPrimaryKeys(
        objectRef.profileId,
        objectRef.schemaName,
        objectRef.objectName,
        objectRef.catalogName ?? undefined,
      ),
    ])
      .then(([columnsResult, primaryKeysResult]) => {
        if (cancelled) return;
        const ready: CachedColumnsPreview = {
          columns: columnsResult.columns,
          primaryKeyNames: new Set(
            primaryKeysResult.keys.map((key) => key.name.toLowerCase()),
          ),
        };
        setLoadState({ status: "ready", ...ready });
        setCachedObjectPreview("columns", objectRef, ready);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadState({
          status: "error",
          message: formatErrorMessage(error, t("app.columns.loadFailed")),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    objectRef.profileId,
    objectRef.schemaName,
    objectRef.objectName,
    objectRef.catalogName,
    t,
  ]);

  if (loadState.status === "loading") {
    return (
      <div className="columns-preview__status">{t("app.columns.loading")}</div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="columns-preview__status columns-preview__status--error">
        {loadState.message}
      </div>
    );
  }

  return (
    <div className="columns-preview">
      <table className="columns-preview__table">
        <thead>
          <tr>
            <th className="columns-preview__index-cell">#</th>
            <th>{t("app.columns.name")}</th>
            <th className="columns-preview__pk-cell">{t("app.columns.primaryKey")}</th>
            <th>{t("app.columns.type")}</th>
            <th>{t("app.columns.nullable")}</th>
            <th>{t("app.columns.defaultValue")}</th>
            <th>{t("app.columns.comment")}</th>
          </tr>
        </thead>
        <tbody>
          {loadState.columns.map((column, index) => (
            <tr key={column.name}>
              <td className="columns-preview__index-cell">{index + 1}</td>
              <td>{column.name}</td>
              <td className="columns-preview__pk-cell">
                {loadState.primaryKeyNames.has(column.name.toLowerCase())
                  ? "✓"
                  : ""}
              </td>
              <td>{formatColumnType(column)}</td>
              <td>
                {column.nullable === undefined
                  ? ""
                  : column.nullable
                    ? t("app.columns.yes")
                    : t("app.columns.no")}
              </td>
              <td>{column.defaultValue ?? ""}</td>
              <td>{column.comment ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ColumnsPreview;
