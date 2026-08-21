import { useEffect, useState } from "react";
import type { MetadataForeignKey } from "@silk-studio/db-protocol";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { bridgeListForeignKeys } from "../../services/connection/connectionBridge";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import {
  getCachedObjectPreview,
  setCachedObjectPreview,
} from "../../services/connection/objectPreviewCache";
import "./TablePropertySection.css";

type CachedForeignKeysPreview = { foreignKeys: MetadataForeignKey[] };

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ({ status: "ready" } & CachedForeignKeysPreview);

type ForeignKeysPreviewProps = {
  objectRef: ObjectEditorRef;
};

function formatReferencedTable(fk: MetadataForeignKey): string {
  return fk.referencedSchema ? `${fk.referencedSchema}.${fk.referencedTable}` : fk.referencedTable;
}

function ForeignKeysPreview({ objectRef }: ForeignKeysPreviewProps) {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const cached = getCachedObjectPreview<CachedForeignKeysPreview>(
      "foreignKeys",
      objectRef,
    );
    if (cached) {
      setLoadState({ status: "ready", ...cached });
      return;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });

    bridgeListForeignKeys(
      objectRef.profileId,
      objectRef.schemaName,
      objectRef.objectName,
      objectRef.catalogName ?? undefined,
    )
      .then((result) => {
        if (cancelled) return;
        const ready: CachedForeignKeysPreview = {
          foreignKeys: result.foreignKeys,
        };
        setLoadState({ status: "ready", ...ready });
        setCachedObjectPreview("foreignKeys", objectRef, ready);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadState({
          status: "error",
          message: formatErrorMessage(error, t("app.foreignKeys.loadFailed")),
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
      <div className="table-property-section__status">{t("app.foreignKeys.loading")}</div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="table-property-section__status table-property-section__status--error">
        {loadState.message}
      </div>
    );
  }

  if (loadState.foreignKeys.length === 0) {
    return (
      <div className="table-property-section__status">{t("app.foreignKeys.empty")}</div>
    );
  }

  return (
    <div className="table-property-section">
      <table className="table-property-section__table">
        <thead>
          <tr>
            <th className="table-property-section__index-cell">#</th>
            <th>{t("app.foreignKeys.name")}</th>
            <th>{t("app.foreignKeys.columns")}</th>
            <th>{t("app.foreignKeys.referencedTable")}</th>
            <th>{t("app.foreignKeys.referencedColumns")}</th>
            <th>{t("app.foreignKeys.onUpdate")}</th>
            <th>{t("app.foreignKeys.onDelete")}</th>
          </tr>
        </thead>
        <tbody>
          {loadState.foreignKeys.map((fk, position) => (
            <tr key={fk.name}>
              <td className="table-property-section__index-cell">{position + 1}</td>
              <td>{fk.name}</td>
              <td>{fk.columns.join(", ")}</td>
              <td>{formatReferencedTable(fk)}</td>
              <td>{fk.referencedColumns.join(", ")}</td>
              <td>{fk.updateRule ?? ""}</td>
              <td>{fk.deleteRule ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ForeignKeysPreview;
