import { useEffect, useState } from "react";
import type { MetadataColumn } from "@silk-studio/db-protocol";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { bridgeListColumns } from "../../services/connection/connectionBridge";
import { bridgeListPrimaryKeys } from "../../services/connection/connectionPrimaryKeysBridge";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import "./ColumnsPreview.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      columns: MetadataColumn[];
      primaryKeyNames: Set<string>;
    };

type ColumnsPreviewProps = {
  objectRef: ObjectEditorRef;
};

const SIZED_CHAR_OR_BINARY_TYPE = /CHAR|TEXT|STRING|BINARY|RAW/;
const SIZED_NUMERIC_TYPE = /^(NUMBER|NUMERIC|DECIMAL|DEC)/;
const MAX_MEANINGFUL_COLUMN_SIZE = 1_000_000_000;

function formatColumnType(column: MetadataColumn): string {
  const { typeName, columnSize, decimalDigits } = column;
  if (!typeName) return "";

  const upperTypeName = typeName.toUpperCase();
  const hasMeaningfulSize =
    columnSize !== undefined &&
    columnSize > 0 &&
    columnSize < MAX_MEANINGFUL_COLUMN_SIZE;

  if (hasMeaningfulSize && SIZED_NUMERIC_TYPE.test(upperTypeName)) {
    return decimalDigits
      ? `${typeName}(${columnSize},${decimalDigits})`
      : `${typeName}(${columnSize})`;
  }

  if (hasMeaningfulSize && SIZED_CHAR_OR_BINARY_TYPE.test(upperTypeName)) {
    return `${typeName}(${columnSize})`;
  }

  return typeName;
}

function ColumnsPreview({ objectRef }: ColumnsPreviewProps) {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
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
        setLoadState({
          status: "ready",
          columns: columnsResult.columns,
          primaryKeyNames: new Set(
            primaryKeysResult.keys.map((key) => key.name.toLowerCase()),
          ),
        });
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
