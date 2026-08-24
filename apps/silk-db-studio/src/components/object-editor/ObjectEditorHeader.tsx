import { useEffect, useState } from "react";
import type { MetadataObjectKind } from "@silk-studio/db-protocol";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import type { MessageKey } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import { bridgeGetTableComment } from "../../services/connection/connectionBridge";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import type { TableStructureEditorState } from "./useTableStructureEditorState";
import "./ObjectEditorHeader.css";

type CommentState = { status: "loading" } | { status: "ready"; comment: string | undefined };

type ObjectEditorHeaderProps = {
  objectRef: ObjectEditorRef;
  /** Present only for tables on a driver that supports structure editing — see
   *  `useTableStructureEditorState`'s doc comment for why table name/comment editing and its
   *  Save/Discard/Refresh actions live here rather than in the Columns tab's grid: they act on
   *  the table as a whole and should stay reachable no matter which Properties section is open. */
  tableEditor?: TableStructureEditorState;
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
function ObjectEditorHeader({ objectRef, tableEditor }: ObjectEditorHeaderProps) {
  const { t } = useI18n();
  const [commentState, setCommentState] = useState<CommentState>({ status: "loading" });

  useEffect(() => {
    // Table structure editing owns its own comment fetch (part of the same load that seeds the
    // Columns grid) — this component's own fetch would just race it and show stale data.
    if (tableEditor) return;

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
    tableEditor,
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
          {tableEditor ? (
            <input
              className="object-editor-header__input"
              value={tableEditor.editedTableName}
              disabled={!!tableEditor.blockedReason}
              onChange={(e) => tableEditor.setEditedTableName(e.target.value)}
            />
          ) : (
            <span className="object-editor-header__box">{objectRef.objectName}</span>
          )}
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
        {tableEditor ? (
          <input
            className="object-editor-header__input"
            value={tableEditor.editedTableComment ?? ""}
            disabled={!!tableEditor.blockedReason}
            onChange={(e) =>
              tableEditor.setEditedTableComment(e.target.value === "" ? null : e.target.value)
            }
          />
        ) : (
          <span className="object-editor-header__box object-editor-header__box--comment">
            {commentState.status === "loading"
              ? ""
              : (commentState.comment ?? t("app.general.noComment"))}
          </span>
        )}
      </div>
      {tableEditor ? (
        <div className="object-editor-header__actions">
          <button
            type="button"
            className="object-editor-header__button"
            onClick={tableEditor.refresh}
          >
            <Codicon name="refresh" />
            {t("app.tableStructure.refresh")}
          </button>
          <button
            type="button"
            className="object-editor-header__button"
            disabled={!tableEditor.isDirty}
            onClick={tableEditor.discard}
          >
            <Codicon name="discard" />
            {t("app.tableStructure.discard")}
          </button>
          <button
            type="button"
            className="object-editor-header__button object-editor-header__button--primary"
            disabled={!tableEditor.isDirty || !!tableEditor.blockedReason}
            onClick={() => void tableEditor.save()}
          >
            <Codicon name="save" />
            {t("app.tableStructure.save")}
          </button>
          {tableEditor.blockedReason ? (
            <span className="object-editor-header__blocked-reason">
              {tableEditor.blockedReason}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default ObjectEditorHeader;
