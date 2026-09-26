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
import ColumnGrid, { type ColumnGridColumn } from "./ColumnGrid";
import "./ColumnsPreview.css";

type CachedColumnsPreview = {
  columns: MetadataColumn[];
  primaryKeyOrders: Map<string, number>;
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
          primaryKeyOrders: new Map(
            primaryKeysResult.keys.map((key, index) => [key.name.toLowerCase(), index + 1]),
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

  const rows = loadState.columns.map((column, index) => ({ ...column, rowId: String(index) }));
  const columns: ColumnGridColumn<(typeof rows)[number]>[] = [
    { field: "name", title: t("app.columns.name"), value: (row) => row.name },
    { field: "pk", title: t("app.columns.primaryKeyOrder"), width: 90, value: (row) => String(loadState.primaryKeyOrders.get(row.name.toLowerCase()) ?? "") },
    { field: "type", title: t("app.columns.type"), value: (row) => formatColumnType(row) },
    { field: "nullable", title: t("app.columns.nullable"), value: (row) => row.nullable === undefined ? "" : row.nullable ? t("app.columns.yes") : t("app.columns.no") },
    { field: "defaultValue", title: t("app.columns.defaultValue"), value: (row) => row.defaultValue ?? "" },
    { field: "comment", title: t("app.columns.comment"), value: (row) => row.comment ?? "" },
  ];
  return <ColumnGrid rows={rows} columns={columns} filename={`${objectRef.objectName}-columns`} />;
}

export default ColumnsPreview;
