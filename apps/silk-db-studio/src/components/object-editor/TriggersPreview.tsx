import { useEffect, useState } from "react";
import type { MetadataTrigger } from "@silk-studio/db-protocol";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { bridgeListTriggers } from "../../services/connection/connectionBridge";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import {
  getCachedObjectPreview,
  setCachedObjectPreview,
} from "../../services/connection/objectPreviewCache";
import "./TablePropertySection.css";

type CachedTriggersPreview = { triggers: MetadataTrigger[] };

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ({ status: "ready" } & CachedTriggersPreview);

type TriggersPreviewProps = {
  objectRef: ObjectEditorRef;
};

function TriggersPreview({ objectRef }: TriggersPreviewProps) {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const cached = getCachedObjectPreview<CachedTriggersPreview>(
      "triggers",
      objectRef,
    );
    if (cached) {
      setLoadState({ status: "ready", ...cached });
      return;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });

    bridgeListTriggers(
      objectRef.profileId,
      objectRef.schemaName,
      objectRef.objectName,
      objectRef.catalogName ?? undefined,
    )
      .then((result) => {
        if (cancelled) return;
        const ready: CachedTriggersPreview = { triggers: result.triggers };
        setLoadState({ status: "ready", ...ready });
        setCachedObjectPreview("triggers", objectRef, ready);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadState({
          status: "error",
          message: formatErrorMessage(error, t("app.triggers.loadFailed")),
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
      <div className="table-property-section__status">{t("app.triggers.loading")}</div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="table-property-section__status table-property-section__status--error">
        {loadState.message}
      </div>
    );
  }

  if (loadState.triggers.length === 0) {
    return (
      <div className="table-property-section__status">{t("app.triggers.empty")}</div>
    );
  }

  return (
    <div className="table-property-section">
      <table className="table-property-section__table">
        <thead>
          <tr>
            <th className="table-property-section__index-cell">#</th>
            <th>{t("app.triggers.name")}</th>
            <th>{t("app.triggers.timing")}</th>
            <th>{t("app.triggers.event")}</th>
            <th>{t("app.triggers.enabled")}</th>
          </tr>
        </thead>
        <tbody>
          {loadState.triggers.map((trigger, position) => (
            <tr key={trigger.name}>
              <td className="table-property-section__index-cell">{position + 1}</td>
              <td>{trigger.name}</td>
              <td>{trigger.timing ?? ""}</td>
              <td>{trigger.event ?? ""}</td>
              <td>
                {trigger.enabled === undefined
                  ? ""
                  : trigger.enabled
                    ? t("app.triggers.yes")
                    : t("app.triggers.no")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default TriggersPreview;
