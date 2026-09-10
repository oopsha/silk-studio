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
import { objectEditorUri, buildObjectEditorTabLabel } from "../../services/connection/objectEditorConstants";
import { discardCreateViewDraft, getCreateViewDraft, parseCreateViewDraftUri, updateCreateViewDraft } from "../../services/connection/createViewDraftService";
import { monacoLanguageIdForDriver } from "../../services/sql/sqlDialect";

function CreateViewDraftView() {
  const activeTab = useActiveEditor();
  const id = parseCreateViewDraftUri(activeTab?.uri);
  const draft = id ? getCreateViewDraft(id) : undefined;
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  void revision;
  const profile = draft ? ConnectionService.getProfile(draft.profileId) : undefined;
  if (!activeTab || !id || !draft || !profile) return <div className="object-editor-view__error">새 뷰 초안을 찾을 수 없습니다.</div>;
  const update = (patch: Partial<typeof draft>) => { updateCreateViewDraft(id, { ...draft, ...patch }); EditorService.setTabDirtyOverride(activeTab.id, true); setRevision((v) => v + 1); };
  const save = async () => {
    if (!draft.viewName.trim() || !draft.definition.trim()) { AppNotificationService.show("뷰 이름과 SELECT 정의를 입력해야 합니다.", "error"); return; }
    setSaving(true);
    try {
      const ref = formatTableReference(draft.schemaName, draft.viewName.trim(), profile.driverId, profile.driverId === "sqlserver" ? undefined : draft.catalogName);
      await QueryExecutionService.executeWriteStatement(`CREATE VIEW ${ref} AS\n${draft.definition.trim()}`, { connectionId: draft.profileId });
      await ConnectionTreeService.invalidateAndRefreshSchema(draft.profileId, draft.schemaName, draft.catalogName ?? undefined);
      discardCreateViewDraft(id);
      EditorService.markTabSaved(activeTab.id, objectEditorUri({ profileId: draft.profileId, schemaName: draft.schemaName, catalogName: draft.catalogName, kind: "view", objectName: draft.viewName.trim() }), buildObjectEditorTabLabel(draft.schemaName, draft.viewName.trim()));
      AppNotificationService.show("뷰를 만들었습니다.", "success");
    } catch (error) { AppNotificationService.show(error instanceof Error ? error.message : "뷰 생성에 실패했습니다.", "error"); }
    finally { setSaving(false); }
  };
  return <div className="object-editor-properties-page"><div className="object-editor-header"><div className="object-editor-header__row"><label className="object-editor-header__field object-editor-header__field--name"><span className="object-editor-header__label">이름</span><input className="object-editor-header__input" value={draft.viewName} onChange={(e) => update({ viewName: e.target.value })} /></label><div className="object-editor-header__field object-editor-header__field--type"><span className="object-editor-header__label">타입</span><span className="object-editor-header__box">뷰</span></div><div className="object-editor-header__field object-editor-header__field--schema"><span className="object-editor-header__label">스키마</span><span className="object-editor-header__box">{draft.schemaName}</span></div></div><div className="object-editor-header__actions"><button type="button" className="object-editor-header__button" onClick={() => EditorService.closeTab(activeTab.id)}><Codicon name="close" />취소</button><button type="button" className="object-editor-header__button object-editor-header__button--primary" disabled={saving} onClick={() => void save()}><Codicon name="save" />{saving ? "생성 중…" : "저장"}</button></div></div><div className="view-ddl-editor"><div className="view-ddl-editor__banner">SELECT 정의</div><div className="view-ddl-editor__body"><Editor height="100%" language={monacoLanguageIdForDriver(profile.driverId)} value={draft.definition} onChange={(value) => update({ definition: value ?? "" })} options={{ automaticLayout: true, minimap: { enabled: false } }} /></div></div></div>;
}
export default CreateViewDraftView;
