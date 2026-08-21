import { useEffect, useState } from "react";
import type { MetadataReference } from "@silk-studio/db-protocol";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { bridgeListReferences } from "../../services/connection/connectionBridge";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import {
  getCachedObjectPreview,
  setCachedObjectPreview,
} from "../../services/connection/objectPreviewCache";
import "./TablePropertySection.css";

type CachedReferencesPreview = { references: MetadataReference[] };

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ({ status: "ready" } & CachedReferencesPreview);

type ReferencesPreviewProps = {
  objectRef: ObjectEditorRef;
};

function formatReferencingTable(ref: MetadataReference): string {
  return ref.referencingSchema ? `${ref.referencingSchema}.${ref.referencingTable}` : ref.referencingTable;
}

/** Object Editor "References" section — which *other* tables hold a FK pointing at this one,
 *  the mirror image of "Foreign Keys" (this table pointing at others). */
function ReferencesPreview({ objectRef }: ReferencesPreviewProps) {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const cached = getCachedObjectPreview<CachedReferencesPreview>(
      "references",
      objectRef,
    );
    if (cached) {
      setLoadState({ status: "ready", ...cached });
      return;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });

    bridgeListReferences(
      objectRef.profileId,
      objectRef.schemaName,
      objectRef.objectName,
      objectRef.catalogName ?? undefined,
    )
      .then((result) => {
        if (cancelled) return;
        const ready: CachedReferencesPreview = {
          references: result.references,
        };
        setLoadState({ status: "ready", ...ready });
        setCachedObjectPreview("references", objectRef, ready);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadState({
          status: "error",
          message: formatErrorMessage(error, t("app.references.loadFailed")),
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
      <div className="table-property-section__status">{t("app.references.loading")}</div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="table-property-section__status table-property-section__status--error">
        {loadState.message}
      </div>
    );
  }

  if (loadState.references.length === 0) {
    return (
      <div className="table-property-section__status">{t("app.references.empty")}</div>
    );
  }

  return (
    <div className="table-property-section">
      <table className="table-property-section__table">
        <thead>
          <tr>
            <th className="table-property-section__index-cell">#</th>
            <th>{t("app.references.name")}</th>
            <th>{t("app.references.referencingTable")}</th>
            <th>{t("app.references.referencingColumns")}</th>
            <th>{t("app.references.columns")}</th>
            <th>{t("app.references.onUpdate")}</th>
            <th>{t("app.references.onDelete")}</th>
          </tr>
        </thead>
        <tbody>
          {loadState.references.map((ref, position) => (
            <tr key={ref.name}>
              <td className="table-property-section__index-cell">{position + 1}</td>
              <td>{ref.name}</td>
              <td>{formatReferencingTable(ref)}</td>
              <td>{ref.referencingColumns.join(", ")}</td>
              <td>{ref.columns.join(", ")}</td>
              <td>{ref.updateRule ?? ""}</td>
              <td>{ref.deleteRule ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ReferencesPreview;
