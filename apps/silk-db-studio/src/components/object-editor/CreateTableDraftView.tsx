import { useEffect, useMemo, useRef, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { ConnectionService } from "../../services/connection/connectionService";
import { ConnectionTreeService } from "../../services/connection/connectionTreeService";
import { QueryExecutionService } from "../../services/query/queryExecutionService";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import { driverAutoCommitsDdl } from "../../services/sql/sqlDialect";
import { objectEditorUri, buildObjectEditorTabLabel } from "../../services/connection/objectEditorConstants";
import {
  discardCreateTableDraft,
  getCreateTableDraft,
  onDidChangeCreateTableDraft,
  parseCreateTableDraftUri,
  updateCreateTableDraft,
} from "../../services/connection/createTableDraftService";
import { DatabaseTargetQuickPickService } from "../../services/connection/databaseTargetQuickPickService";
import { buildCreateTableDraftSql, buildCreateTableDraftStatements, type CreateTableColumnDraft } from "../../services/connection/createTableSql";
import ColumnTypeCombobox from "./ColumnTypeCombobox";
import "./TableStructureEditor.css";
import "./CreateTableDraftView.css";

function newColumn(): CreateTableColumnDraft {
  return { id: crypto.randomUUID(), name: "", typeName: "", nullable: true };
}

function CreateTableDraftView() {
  const configuration = useConfiguration();
  const activeTab = useActiveEditor();
  const draftId = parseCreateTableDraftUri(activeTab?.uri);
  const initial = draftId ? getCreateTableDraft(draftId) : undefined;
  const [revision, setRevision] = useState(0);
  const [showReview, setShowReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [focusColumnId, setFocusColumnId] = useState<string | null>(null);
  const tableNameInputRef = useRef<HTMLInputElement>(null);
  const draft = draftId ? getCreateTableDraft(draftId) : undefined;
  // Revision deliberately makes this component rerender after updating the module-backed draft.
  void revision;

  const profile = draft ? ConnectionService.getProfile(draft.profileId) : undefined;
  const executionHint = !profile
    ? ""
    : driverAutoCommitsDdl(profile.driverId)
      ? "생성에 성공하면 즉시 커밋되며 롤백할 수 없습니다."
      : configuration["database.autoCommit"]
        ? "자동 커밋이 켜져 있어 생성에 성공하면 즉시 반영됩니다."
        : "자동 커밋이 꺼져 있어 생성 후 커밋하기 전에는 롤백할 수 있습니다.";
  const sql = useMemo(
    () => (draft && profile ? buildCreateTableDraftSql(profile.driverId, draft) : ""),
    [draft, profile, revision],
  );

  useEffect(() => {
    tableNameInputRef.current?.focus();
  }, [draftId]);

  useEffect(
    () => onDidChangeCreateTableDraft(() => setRevision((value) => value + 1)),
    [],
  );

  useEffect(() => {
    if (!focusColumnId) return;
    document.querySelector<HTMLInputElement>(
      ".table-structure-editor__table tbody tr:last-child td:nth-child(2) input",
    )?.focus();
    setFocusColumnId(null);
  }, [focusColumnId, revision]);

  if (!activeTab || !draftId || !initial || !draft || !profile) {
    return <div className="object-editor-view__error">새 테이블 초안을 찾을 수 없습니다.</div>;
  }

  const update = (patch: Partial<typeof draft>) => {
    updateCreateTableDraft(draftId, { ...draft, ...patch });
    EditorService.setTabDirtyOverride(activeTab.id, true);
    if (patch.columns && patch.columns.length > draft.columns.length) {
      setFocusColumnId(patch.columns[patch.columns.length - 1]?.id ?? null);
    }
    setRevision((value) => value + 1);
  };
  const updateColumn = (id: string, patch: Partial<CreateTableColumnDraft>) => {
    const assignedToPrimaryKey =
      Object.prototype.hasOwnProperty.call(patch, "primaryKeyOrder") &&
      patch.primaryKeyOrder !== undefined;
    update({
      columns: draft.columns.map((column) =>
        column.id === id
          ? { ...column, ...patch, ...(assignedToPrimaryKey ? { nullable: false } : {}) }
          : column,
      ),
    });
  };
  const removeColumn = (id: string) => update({ columns: draft.columns.filter((column) => column.id !== id) });
  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(sql);
      AppNotificationService.show("SQL을 복사했습니다.", "success");
    } catch {
      AppNotificationService.show("SQL을 클립보드에 복사하지 못했습니다.", "error");
    }
  };

  const copyError = async () => {
    if (!saveError) return;
    try {
      await navigator.clipboard.writeText(saveError);
      AppNotificationService.show("오류 메시지를 복사했습니다.", "success");
    } catch {
      AppNotificationService.show("오류 메시지를 클립보드에 복사하지 못했습니다.", "error");
    }
  };

  const validate = (): string | null => {
    if (!draft.tableName.trim()) return "테이블명을 입력해야 합니다.";
    if (draft.columns.length === 0) return "컬럼을 하나 이상 추가해야 합니다.";
    if (draft.columns.some((column) => !column.name.trim() || !column.typeName.trim())) {
      return "모든 컬럼의 이름과 타입을 입력해야 합니다.";
    }
    const orders = draft.columns.flatMap((column) => column.primaryKeyOrder === undefined ? [] : [column.primaryKeyOrder]);
    const sortedOrders = [...orders].sort((left, right) => left - right);
    if (
      new Set(orders).size !== orders.length ||
      sortedOrders.some((order, index) => order !== index + 1)
    ) {
      return "PK 순서는 중복이나 빈 순서 없이 1부터 입력해야 합니다.";
    }
    return null;
  };

  const save = async () => {
    const error = validate();
    if (error) { AppNotificationService.show(error, "error"); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const statements = buildCreateTableDraftStatements(profile.driverId, draft);
      for (let index = 0; index < statements.length; index += 1) {
        // Creation and dialect-specific comments must run in this order.
        // eslint-disable-next-line no-await-in-loop
        try {
          await QueryExecutionService.executeWriteStatement(statements[index], {
            connectionId: draft.profileId,
          });
        } catch (error) {
          throw new Error(
            `생성 SQL ${index + 1}번째 문 실행에 실패했습니다: ${formatErrorMessage(error)}`,
          );
        }
      }
      await ConnectionTreeService.invalidateAndRefreshSchema(draft.profileId, draft.schemaName, draft.catalogName ?? undefined);
      const ref = { profileId: draft.profileId, schemaName: draft.schemaName, catalogName: draft.catalogName, kind: "table" as const, objectName: draft.tableName.trim() };
      discardCreateTableDraft(draftId);
      EditorService.markTabSaved(activeTab.id, objectEditorUri(ref), buildObjectEditorTabLabel(ref.schemaName, ref.objectName));
      AppNotificationService.show("테이블을 만들었습니다.", "success");
    } catch (error) {
      setSaveError(formatErrorMessage(error, "테이블 생성에 실패했습니다."));
      setSaving(false);
      return;
    }
    setShowReview(false);
    setSaving(false);
  };

  return <div className="object-editor-properties-page">
    <div className="object-editor-header">
      <div className="object-editor-header__row">
        <label className="object-editor-header__field object-editor-header__field--name"><span className="object-editor-header__label">이름</span><input ref={tableNameInputRef} className="object-editor-header__input" value={draft.tableName} onChange={(event) => update({ tableName: event.target.value })} /></label>
        <div className="object-editor-header__field object-editor-header__field--type"><span className="object-editor-header__label">타입</span><span className="object-editor-header__box">테이블</span></div>
        <div className="object-editor-header__field object-editor-header__field--schema"><span className="object-editor-header__label">스키마</span><button type="button" className="object-editor-header__box object-editor-header__target-button" title="스키마 또는 데이터베이스 변경" onClick={() => DatabaseTargetQuickPickService.show()}>{draft.schemaName}</button></div>
        <label className="object-editor-header__field object-editor-header__field--comment"><span className="object-editor-header__label">코멘트</span><input className="object-editor-header__input" value={draft.tableComment ?? ""} onChange={(event) => update({ tableComment: event.target.value || undefined })} /></label>
      </div>
      <div className="object-editor-header__actions"><button type="button" className="object-editor-header__button" onClick={() => EditorService.closeTab(activeTab.id)}><Codicon name="close" />취소</button><button type="button" className="object-editor-header__button object-editor-header__button--primary" onClick={() => { const error = validate(); if (error) AppNotificationService.show(error, "error"); else { setSaveError(null); setShowReview(true); } }}><Codicon name="save" />저장</button></div>
    </div>
    <div className="table-structure-editor"><div className="table-structure-editor__toolbar"><div className="table-structure-editor__toolbar-spacer" /><button type="button" className="table-structure-editor__toolbar-button" onClick={() => update({ columns: [...draft.columns, newColumn()] })}><Codicon name="add" />컬럼 추가</button></div><div className="table-structure-editor__grid"><table className="table-structure-editor__table"><thead><tr><th>#</th><th>이름</th><th className="table-structure-editor__pk-cell">PK 순서</th><th>타입</th><th>길이</th><th>스케일</th><th>NULL</th><th>기본값</th><th>코멘트</th><th /></tr></thead><tbody>{draft.columns.map((column, index) => <tr key={column.id}><td>{index + 1}</td><td><input className="table-structure-editor__cell-input" value={column.name} onChange={(event) => updateColumn(column.id, { name: event.target.value })} /></td><td><input className="table-structure-editor__cell-input table-structure-editor__cell-input--narrow" type="number" min="1" value={column.primaryKeyOrder ?? ""} onChange={(event) => updateColumn(column.id, { primaryKeyOrder: event.target.value === "" ? undefined : Number(event.target.value) })} /></td><td><ColumnTypeCombobox driverId={profile.driverId} value={column.typeName} placeholder="타입 선택" onChange={(typeName) => updateColumn(column.id, { typeName })} /></td><td><input className="table-structure-editor__cell-input table-structure-editor__cell-input--narrow" type="number" value={column.length ?? ""} onChange={(event) => updateColumn(column.id, { length: event.target.value === "" ? undefined : Number(event.target.value) })} /></td><td><input className="table-structure-editor__cell-input table-structure-editor__cell-input--narrow" type="number" value={column.scale ?? ""} onChange={(event) => updateColumn(column.id, { scale: event.target.value === "" ? undefined : Number(event.target.value) })} /></td><td><input className="table-structure-editor__checkbox" type="checkbox" checked={column.nullable} onChange={(event) => updateColumn(column.id, { nullable: event.target.checked })} /></td><td><input className="table-structure-editor__cell-input" value={column.defaultValue ?? ""} onChange={(event) => updateColumn(column.id, { defaultValue: event.target.value || undefined })} /></td><td><input className="table-structure-editor__cell-input" value={column.comment ?? ""} onChange={(event) => updateColumn(column.id, { comment: event.target.value || undefined })} /></td><td><button type="button" className="table-structure-editor__row-action" onClick={() => removeColumn(column.id)}><Codicon name="trash" />삭제</button></td></tr>)}</tbody></table></div></div>
    {showReview ? (
      <div className="explorer-mutation-dialog__backdrop">
        <div className="explorer-mutation-dialog" role="dialog" aria-modal="true">
          <header className="explorer-mutation-dialog__header">
            <h2>테이블 생성</h2>
            <button type="button" className="explorer-mutation-dialog__close" onClick={() => setShowReview(false)}><Codicon name="close" /></button>
          </header>
          <div className="explorer-mutation-dialog__body">
            <p className="explorer-mutation-dialog__hint">생성 버튼을 선택하면 아래 SQL이 실행됩니다. {executionHint}</p>
            <div className="create-table-draft__sql-preview">
              <button
                type="button"
                className="create-table-draft__copy-button"
                aria-label="SQL 복사"
                title="SQL 복사"
                onClick={() => void copySql()}
              >
                <Codicon name="copy" />
              </button>
              <pre className="explorer-mutation-dialog__sql">{sql}</pre>
            </div>
            {saveError ? (
              <div className="create-table-draft__error" role="alert">
                <span>{saveError}</span>
                <button
                  type="button"
                  className="create-table-draft__copy-button"
                  aria-label="오류 메시지 복사"
                  title="오류 메시지 복사"
                  onClick={() => void copyError()}
                >
                  <Codicon name="copy" />
                </button>
              </div>
            ) : null}
          </div>
          <footer className="explorer-mutation-dialog__footer">
            <button type="button" className="explorer-mutation-dialog__button" disabled={saving} onClick={() => setShowReview(false)}>취소</button>
            <button type="button" className="explorer-mutation-dialog__button explorer-mutation-dialog__button--primary" disabled={saving} onClick={() => void save()}>{saving ? "생성 중…" : "생성"}</button>
          </footer>
        </div>
      </div>
    ) : null}
  </div>;
}

export default CreateTableDraftView;
