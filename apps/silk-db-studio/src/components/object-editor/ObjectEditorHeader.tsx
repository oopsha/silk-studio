import { useEffect, useState } from "react";
import type { MetadataObjectKind } from "@silk-studio/db-protocol";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import type { MessageKey } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import { bridgeGetTableComment } from "../../services/connection/connectionBridge";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import "./ObjectEditorHeader.css";

type CommentState = { status: "loading" } | { status: "ready"; comment: string | undefined };

type ObjectEditorHeaderProps = {
  objectRef: ObjectEditorRef;
};

const KIND_LABEL_KEYS: Record<MetadataObjectKind, MessageKey> = {
  table: "app.general.kindTable",
  view: "app.general.kindView",
  procedure: "app.general.kindProcedure",
  function: "app.general.kindFunction",
  package: "app.general.kindPackage",
  index: "app.general.kindIndex",
  sequence: "app.general.kindSequence",
  synonym: "app.general.kindSynonym",
  trigger: "app.general.kindTrigger",
  type: "app.general.kindType",
};

/**
 * Pinned above the section sidebar (Columns/Indexes/.../DDL) rather than being its own section
 * — a single comment field isn't worth a whole tab, and this stays visible no matter which
 * section is selected (mirrors DBeaver's own object-editor header).
 */
function ObjectEditorHeader({ objectRef }: ObjectEditorHeaderProps) {
  const { t } = useI18n();
  const [commentState, setCommentState] = useState<CommentState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setCommentState({ status: "loading" });

    bridgeGetTableComment(
      objectRef.profileId,
      objectRef.schemaName,
      objectRef.objectName,
      objectRef.catalogName ?? undefined,
    )
      .then((result) => {
        if (cancelled) return;
        setCommentState({ status: "ready", comment: result.comment });
      })
      .catch(() => {
        if (cancelled) return;
        // Non-fatal — the section tabs below still work even if the comment lookup fails
        // (e.g. a dialect/driver quirk), so this degrades to an empty field rather than an
        // error banner blocking the whole properties view.
        setCommentState({ status: "ready", comment: undefined });
      });

    return () => {
      cancelled = true;
    };
  }, [
    objectRef.profileId,
    objectRef.schemaName,
    objectRef.objectName,
    objectRef.catalogName,
  ]);

  return (
    <div className="object-editor-header">
      <div className="object-editor-header__row">
        <div className="object-editor-header__field object-editor-header__field--name">
          <span className="object-editor-header__label">{t("app.general.name")}</span>
          <span className="object-editor-header__box">{objectRef.objectName}</span>
        </div>
        <div className="object-editor-header__field object-editor-header__field--type">
          <span className="object-editor-header__label">{t("app.general.type")}</span>
          <span className="object-editor-header__box">{t(KIND_LABEL_KEYS[objectRef.kind])}</span>
        </div>
        <div className="object-editor-header__field object-editor-header__field--schema">
          <span className="object-editor-header__label">{t("app.general.schema")}</span>
          <span className="object-editor-header__box">{objectRef.schemaName}</span>
        </div>
      </div>
      <div className="object-editor-header__field object-editor-header__field--comment">
        <span className="object-editor-header__label">{t("app.general.comment")}</span>
        <span className="object-editor-header__box object-editor-header__box--comment">
          {commentState.status === "loading"
            ? ""
            : (commentState.comment ?? t("app.general.noComment"))}
        </span>
      </div>
    </div>
  );
}

export default ObjectEditorHeader;
