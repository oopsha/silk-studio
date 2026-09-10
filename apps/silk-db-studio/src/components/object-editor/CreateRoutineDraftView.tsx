import { useState } from "react";
import { Editor } from "@monaco-editor/react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import { ConnectionService } from "../../services/connection/connectionService";
import { ConnectionTransactionService } from "../../services/connection/connectionTransactionService";
import { ConnectionTreeService } from "../../services/connection/connectionTreeService";
import { registerPendingDdlSave } from "../../services/connection/pendingDdlSaveService";
import { QueryExecutionService } from "../../services/query/queryExecutionService";
import { buildCreateRoutineDraftSql } from "../../services/connection/createRoutineSql";
import { renameCreateDdl } from "../../services/connection/duplicateDdlSql";
import { buildDdlTabLabel, ddlEditorUri } from "../../services/connection/ddlEditorConstants";
import {
  discardCreateRoutineDraft,
  getCreateRoutineDraft,
  parseCreateRoutineDraftUri,
  updateCreateRoutineDraft,
} from "../../services/connection/createRoutineDraftService";

function CreateRoutineDraftView() {
  const tab = useActiveEditor();
  const id = parseCreateRoutineDraftUri(tab?.uri);
  const draft = id ? getCreateRoutineDraft(id) : undefined;
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  void revision;

  const profile = draft ? ConnectionService.getProfile(draft.profileId) : undefined;
  if (!tab || !id || !draft || !profile) {
    return <div className="object-editor-view__error">루틴 초안을 찾을 수 없습니다.</div>;
  }

  const update = (patch: Partial<typeof draft>) => {
    updateCreateRoutineDraft(id, { ...draft, ...patch });
    setRevision((value) => value + 1);
  };

  const save = async () => {
    if (!draft.routineName.trim() || !draft.body.trim()) {
      AppNotificationService.show("이름과 본문을 입력해야 합니다.", "error");
      return;
    }

    setSaving(true);
    try {
      const name = draft.routineName.trim();
      const sql = draft.fullDefinition
        ? renameCreateDdl(
            draft.body,
            draft.kind,
            draft.schemaName,
            name,
            profile.driverId,
            draft.catalogName,
          )
        : buildCreateRoutineDraftSql(
            profile.driverId,
            draft,
            draft.kind,
            name,
            draft.body,
          );

      await QueryExecutionService.executeWriteStatement(sql, {
        connectionId: draft.profileId,
      });
      await ConnectionTreeService.invalidateAndRefreshSchema(
        draft.profileId,
        draft.schemaName,
        draft.catalogName ?? undefined,
      );

      const finalize = () => {
        discardCreateRoutineDraft(id);
        const stillOpen = EditorService.getTabs().find((item) => item.id === tab.id);
        if (stillOpen) {
          EditorService.markTabSaved(
            tab.id,
            ddlEditorUri({
              profileId: draft.profileId,
              schemaName: draft.schemaName,
              catalogName: draft.catalogName,
              kind: draft.kind,
              objectName: name,
            }),
            buildDdlTabLabel(draft.schemaName, name),
          );
        }
      };

      if (ConnectionTransactionService.isDirty(draft.profileId)) {
        registerPendingDdlSave(draft.profileId, {
          onCommit: finalize,
          onRollback: () => {
            // The immediate refresh still sees the uncommitted CREATE. Re-read after rollback
            // and keep this tab as its original draft so it doesn't represent a missing object.
            void ConnectionTreeService.invalidateAndRefreshSchema(
              draft.profileId,
              draft.schemaName,
              draft.catalogName ?? undefined,
            );
            AppNotificationService.show("루틴 생성이 롤백되었습니다. 초안을 유지합니다.", "info");
          },
        });
        AppNotificationService.show("루틴 생성이 커밋 대기 중입니다.", "info");
      } else {
        finalize();
        AppNotificationService.show(
          `${draft.kind === "procedure" ? "프로시저" : "함수"}를 만들었습니다.`,
          "success",
        );
      }
    } catch (error) {
      AppNotificationService.show(
        error instanceof Error ? error.message : "생성에 실패했습니다.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="object-editor-properties-page">
      <div className="object-editor-header">
        <div className="object-editor-header__row">
          <label className="object-editor-header__field object-editor-header__field--name">
            <span className="object-editor-header__label">이름</span>
            <input
              className="object-editor-header__input"
              value={draft.routineName}
              onChange={(event) => update({ routineName: event.target.value })}
            />
          </label>
          <div className="object-editor-header__field">
            <span className="object-editor-header__label">타입</span>
            <span className="object-editor-header__box">
              {draft.kind === "procedure" ? "프로시저" : "함수"}
            </span>
          </div>
          <div className="object-editor-header__field">
            <span className="object-editor-header__label">스키마</span>
            <span className="object-editor-header__box">{draft.schemaName}</span>
          </div>
        </div>
        <div className="object-editor-header__actions">
          <button
            type="button"
            className="object-editor-header__button"
            onClick={() => EditorService.closeTab(tab.id)}
          >
            <Codicon name="close" />취소
          </button>
          <button
            type="button"
            className="object-editor-header__button object-editor-header__button--primary"
            disabled={saving}
            onClick={() => void save()}
          >
            <Codicon name="save" />{saving ? "생성 중…" : "저장"}
          </button>
        </div>
      </div>
      <div className="view-ddl-editor">
        <div className="view-ddl-editor__banner">
          {draft.fullDefinition ? "정의" : "본문"}
        </div>
        <div className="view-ddl-editor__body">
          <Editor
            height="100%"
            language="plsql"
            value={draft.body}
            onChange={(value) => update({ body: value ?? "" })}
          />
        </div>
      </div>
    </div>
  );
}

export default CreateRoutineDraftView;
