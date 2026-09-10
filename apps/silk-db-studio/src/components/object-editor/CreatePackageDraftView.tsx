import { useState } from "react";
import { Editor } from "@monaco-editor/react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import { ConnectionService } from "../../services/connection/connectionService";
import { ConnectionTreeService } from "../../services/connection/connectionTreeService";
import { QueryExecutionService } from "../../services/query/queryExecutionService";
import { formatTableReference } from "../../services/query/sqlLiteral";
import { renameCreateDdl } from "../../services/connection/duplicateDdlSql";
import { buildDdlTabLabel, ddlEditorUri } from "../../services/connection/ddlEditorConstants";
import {
  discardCreatePackageDraft,
  getCreatePackageDraft,
  parseCreatePackageDraftUri,
  updateCreatePackageDraft,
} from "../../services/connection/createPackageDraftService";
import "../ddl/DdlEditorView.css";
import "./PropertiesView.css";
import "./ViewDdlEditor.css";
export default function CreatePackageDraftView() {
  const tab = useActiveEditor();
  const id = parseCreatePackageDraftUri(tab?.uri);
  const draft = id ? getCreatePackageDraft(id) : undefined;
  const [section, setSection] = useState<"spec" | "body">("spec");
  const [saving, setSaving] = useState(false);
  const [, refresh] = useState(0);

  const profile = draft ? ConnectionService.getProfile(draft.profileId) : undefined;

  if (!id || !draft || !tab || !profile) {
    return <div className="object-editor-view__error">패키지 초안을 찾을 수 없습니다.</div>;
  }

  const value = section === "spec" ? draft.spec : draft.body;

  const updateDraft = (nextDraft: typeof draft) => {
    updateCreatePackageDraft(id, nextDraft);
    EditorService.setTabDirtyOverride(tab.id, true);
    refresh((current) => current + 1);
  };

  const change = (nextValue: string | undefined) => {
    updateDraft(section === "spec"
      ? { ...draft, spec: nextValue ?? "" }
      : { ...draft, body: nextValue ?? "" });
  };

  const save = async () => {
    const name = draft.name.trim();
    if (!name) {
      AppNotificationService.show("패키지 이름을 입력하세요.", "error");
      return;
    }
    if (!draft.spec.trim()) {
      AppNotificationService.show("패키지 스펙을 입력하세요.", "error");
      return;
    }

    const qualifiedName = formatTableReference(draft.schemaName, name, profile.driverId, draft.catalogName);
    const specSql = draft.fullDefinition
      ? renameCreateDdl(draft.spec.trim(), "package", draft.schemaName, name, profile.driverId, draft.catalogName)
      : `CREATE OR REPLACE PACKAGE ${qualifiedName} AS\n${draft.spec.trim()}\nEND ${name};`;
    const bodySql = draft.body.trim()
      ? draft.fullDefinition
        ? renameCreateDdl(draft.body.trim(), "package", draft.schemaName, name, profile.driverId, draft.catalogName)
        : `CREATE OR REPLACE PACKAGE BODY ${qualifiedName} AS\n${draft.body.trim()}\nEND ${name};`
      : undefined;

    setSaving(true);
    try {
      await QueryExecutionService.executeWriteStatement(specSql, { connectionId: draft.profileId });
      if (bodySql) {
        await QueryExecutionService.executeWriteStatement(bodySql, { connectionId: draft.profileId });
      }
      await ConnectionTreeService.invalidateAndRefreshSchema(draft.profileId, draft.schemaName, draft.catalogName ?? undefined);
      discardCreatePackageDraft(id);
      EditorService.markTabSaved(
        tab.id,
        ddlEditorUri({ profileId: draft.profileId, schemaName: draft.schemaName, catalogName: draft.catalogName, kind: "package", objectName: name }),
        buildDdlTabLabel(draft.schemaName, name),
      );
      AppNotificationService.show(`패키지 ${name}을(를) 생성했습니다.`, "success");
    } catch (error) {
      AppNotificationService.show(error instanceof Error ? error.message : "패키지 생성에 실패했습니다.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ddl-editor-view">
      <div className="object-editor-header">
        <div className="object-editor-header__row">
          <label className="object-editor-header__field object-editor-header__field--name">
            <span>이름</span>
            <input
              value={draft.name}
              onChange={(event) => updateDraft({ ...draft, name: event.target.value })}
              aria-label="패키지 이름"
            />
          </label>
          <div className="object-editor-header__field">
            <span>타입</span>
            <div className="object-editor-header__value">패키지</div>
          </div>
          <div className="object-editor-header__field">
            <span>스키마</span>
            <div className="object-editor-header__value">{draft.schemaName}</div>
          </div>
        </div>
        <div className="object-editor-header__actions">
          <button type="button" className="object-editor-header__button" onClick={() => EditorService.closeTab(tab.id)}><Codicon name="close" />취소</button>
          <button type="button" className="object-editor-header__button object-editor-header__button--primary" onClick={save} disabled={saving}><Codicon name="save" />{saving ? "저장 중…" : "저장"}</button>
        </div>
      </div>
      <div className="object-editor-properties">
        <aside className="object-editor-properties__sidebar">
          <nav className="object-editor-properties__nav">
            <button
              type="button"
              className={`object-editor-properties__nav-item${section === "spec" ? " object-editor-properties__nav-item--active" : ""}`}
              onClick={() => setSection("spec")}
            >
              스펙
            </button>
            <button
              type="button"
              className={`object-editor-properties__nav-item${section === "body" ? " object-editor-properties__nav-item--active" : ""}`}
              onClick={() => setSection("body")}
            >
              바디
            </button>
          </nav>
        </aside>
        <div className="object-editor-properties__content">
          <div className="view-ddl-editor__body">
            <Editor
              height="100%"
              language="plsql"
              value={value}
              onChange={change}
              options={{ automaticLayout: true, minimap: { enabled: true } }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
