import { useEffect, useState } from "react";
import type { MetadataConstraint } from "@silk-studio/db-protocol";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import type { MessageKey } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import { bridgeListConstraints } from "../../services/connection/connectionBridge";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import "./TablePropertySection.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; constraints: MetadataConstraint[] };

type ConstraintsPreviewProps = {
  objectRef: ObjectEditorRef;
};

const TYPE_LABEL_KEYS: Record<MetadataConstraint["type"], MessageKey> = {
  primaryKey: "app.constraints.typePrimaryKey",
  unique: "app.constraints.typeUnique",
  check: "app.constraints.typeCheck",
};

function ConstraintsPreview({ objectRef }: ConstraintsPreviewProps) {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });

    bridgeListConstraints(objectRef.profileId, objectRef.schemaName, objectRef.objectName)
      .then((result) => {
        if (cancelled) return;
        setLoadState({ status: "ready", constraints: result.constraints });
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadState({
          status: "error",
          message: formatErrorMessage(error, t("app.constraints.loadFailed")),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [objectRef.profileId, objectRef.schemaName, objectRef.objectName, t]);

  if (loadState.status === "loading") {
    return (
      <div className="table-property-section__status">{t("app.constraints.loading")}</div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="table-property-section__status table-property-section__status--error">
        {loadState.message}
      </div>
    );
  }

  if (loadState.constraints.length === 0) {
    return (
      <div className="table-property-section__status">{t("app.constraints.empty")}</div>
    );
  }

  return (
    <div className="table-property-section">
      <table className="table-property-section__table">
        <thead>
          <tr>
            <th className="table-property-section__index-cell">#</th>
            <th>{t("app.constraints.name")}</th>
            <th>{t("app.constraints.type")}</th>
            <th>{t("app.constraints.detail")}</th>
          </tr>
        </thead>
        <tbody>
          {loadState.constraints.map((constraint, position) => (
            <tr key={constraint.name}>
              <td className="table-property-section__index-cell">{position + 1}</td>
              <td>{constraint.name}</td>
              <td>{t(TYPE_LABEL_KEYS[constraint.type])}</td>
              <td>{constraint.columns?.join(", ") ?? constraint.expression ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ConstraintsPreview;
