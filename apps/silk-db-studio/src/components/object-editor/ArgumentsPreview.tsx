import { useEffect, useState } from "react";
import type { MetadataArgument } from "@silk-studio/db-protocol";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import type { MessageKey } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import { bridgeListArguments } from "../../services/connection/connectionArgumentsBridge";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import {
  getCachedObjectPreview,
  setCachedObjectPreview,
} from "../../services/connection/objectPreviewCache";
import "./TablePropertySection.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; arguments: MetadataArgument[] };

type ArgumentsPreviewProps = {
  objectRef: ObjectEditorRef;
};

const DIRECTION_LABEL_KEY: Record<MetadataArgument["direction"], MessageKey> = {
  in: "app.arguments.directionIn",
  out: "app.arguments.directionOut",
  inout: "app.arguments.directionInOut",
  return: "app.arguments.directionReturn",
};

/** Standalone procedures/functions only — package members aren't independently addressable. */
function ArgumentsPreview({ objectRef }: ArgumentsPreviewProps) {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (objectRef.kind !== "procedure" && objectRef.kind !== "function") {
      setLoadState({ status: "ready", arguments: [] });
      return;
    }

    const cached = getCachedObjectPreview<MetadataArgument[]>(
      "arguments",
      objectRef,
    );
    if (cached) {
      setLoadState({ status: "ready", arguments: cached });
      return;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });

    void bridgeListArguments(
      objectRef.profileId,
      objectRef.schemaName,
      objectRef.objectName,
      objectRef.kind,
      objectRef.catalogName ?? undefined,
    )
      .then((result) => {
        if (cancelled) return;
        const sorted = [...result.arguments].sort((a, b) => a.position - b.position);
        setLoadState({ status: "ready", arguments: sorted });
        setCachedObjectPreview("arguments", objectRef, sorted);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadState({
          status: "error",
          message: formatErrorMessage(error, t("app.arguments.loadFailed")),
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
      <div className="table-property-section__status">{t("app.arguments.loading")}</div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="table-property-section__status table-property-section__status--error">
        {loadState.message}
      </div>
    );
  }

  if (loadState.arguments.length === 0) {
    return (
      <div className="table-property-section__status">{t("app.arguments.empty")}</div>
    );
  }

  return (
    <div className="table-property-section">
      <table className="table-property-section__table">
        <thead>
          <tr>
            <th className="table-property-section__index-cell">#</th>
            <th>{t("app.arguments.name")}</th>
            <th>{t("app.arguments.type")}</th>
            <th>{t("app.arguments.direction")}</th>
          </tr>
        </thead>
        <tbody>
          {loadState.arguments.map((argument, index) => (
            <tr key={`${argument.position}-${argument.name ?? "return"}`}>
              <td className="table-property-section__index-cell">{index + 1}</td>
              <td>{argument.name ?? ""}</td>
              <td>{argument.typeName ?? ""}</td>
              <td>{t(DIRECTION_LABEL_KEY[argument.direction])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ArgumentsPreview;
