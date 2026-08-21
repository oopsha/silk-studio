import { useEffect, useState } from "react";
import type { MetadataIndex } from "@silk-studio/db-protocol";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { bridgeListIndexes } from "../../services/connection/connectionBridge";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import {
  getCachedObjectPreview,
  setCachedObjectPreview,
} from "../../services/connection/objectPreviewCache";
import "./TablePropertySection.css";

type CachedIndexesPreview = { indexes: MetadataIndex[] };

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ({ status: "ready" } & CachedIndexesPreview);

type IndexesPreviewProps = {
  objectRef: ObjectEditorRef;
};

function IndexesPreview({ objectRef }: IndexesPreviewProps) {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const cached = getCachedObjectPreview<CachedIndexesPreview>(
      "indexes",
      objectRef,
    );
    if (cached) {
      setLoadState({ status: "ready", ...cached });
      return;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });

    bridgeListIndexes(
      objectRef.profileId,
      objectRef.schemaName,
      objectRef.objectName,
      objectRef.catalogName ?? undefined,
    )
      .then((result) => {
        if (cancelled) return;
        const ready: CachedIndexesPreview = { indexes: result.indexes };
        setLoadState({ status: "ready", ...ready });
        setCachedObjectPreview("indexes", objectRef, ready);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadState({
          status: "error",
          message: formatErrorMessage(error, t("app.indexes.loadFailed")),
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
      <div className="table-property-section__status">{t("app.indexes.loading")}</div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="table-property-section__status table-property-section__status--error">
        {loadState.message}
      </div>
    );
  }

  if (loadState.indexes.length === 0) {
    return (
      <div className="table-property-section__status">{t("app.indexes.empty")}</div>
    );
  }

  return (
    <div className="table-property-section">
      <table className="table-property-section__table">
        <thead>
          <tr>
            <th className="table-property-section__index-cell">#</th>
            <th>{t("app.indexes.name")}</th>
            <th>{t("app.indexes.unique")}</th>
            <th>{t("app.indexes.columns")}</th>
          </tr>
        </thead>
        <tbody>
          {loadState.indexes.map((index, position) => (
            <tr key={index.name}>
              <td className="table-property-section__index-cell">{position + 1}</td>
              <td>{index.name}</td>
              <td>{index.unique ? t("app.indexes.yes") : t("app.indexes.no")}</td>
              <td>{index.columns.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default IndexesPreview;
