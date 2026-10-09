import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { QueryResultDirtyService } from "../../services/query/queryResultDirtyService";
import { TableDataImportService } from "../../services/query/tableDataImportService";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import type { ExplorerObjectRef } from "../../services/connection/explorerObjectActions";
import { openTableData } from "../../services/connection/openTableDataService";
import { buildOpenDataOwnerId } from "../../services/query/queryExecutionService";
import { useQueryExecutionStateByOwnerId } from "../../services/query/useQueryExecutionStateByOwnerId";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import { toStatusLabel } from "../layout/Panel/Panel";
import QueryResultGrid from "../layout/Panel/QueryResultGrid";
import "./DataView.css";

type DataViewProps = {
  objectRef: ObjectEditorRef;
};

function DataView({ objectRef }: DataViewProps) {
  const { t } = useI18n();
  const ownerId = useMemo(
    () =>
      buildOpenDataOwnerId(
        objectRef.profileId,
        objectRef.schemaName,
        objectRef.objectName,
        objectRef.catalogName,
      ),
    [
      objectRef.profileId,
      objectRef.schemaName,
      objectRef.objectName,
      objectRef.catalogName,
    ],
  );
  const session = useQueryExecutionStateByOwnerId(ownerId);
  const [readyOwnerId, setReadyOwnerId] = useState<string | null>(null);
  const importFile = useSyncExternalStore(
    TableDataImportService.subscribe,
    () => TableDataImportService.getFile(ownerId),
    () => null,
  );
  const handleImportFileConsumed = useCallback((file: File) => {
    TableDataImportService.consume(ownerId, file);
  }, [ownerId]);
  const isRunning = session.status === "running";

  const explorerRef = useMemo<ExplorerObjectRef>(
    () => ({
      profileId: objectRef.profileId,
      schemaName: objectRef.schemaName,
      object: { name: objectRef.objectName, kind: objectRef.kind },
      catalogName: objectRef.catalogName,
    }),
    [
      objectRef.profileId,
      objectRef.schemaName,
      objectRef.objectName,
      objectRef.kind,
      objectRef.catalogName,
    ],
  );

  const runFetch = useCallback(() => {
    return openTableData(explorerRef).catch((error) => {
      AppNotificationService.show(
        formatErrorMessage(error, t("app.objectEditor.dataLoadFailed")),
        "error",
      );
    });
  }, [explorerRef, t]);

  // A table may have been recreated while Properties was open. Re-read its SELECT
  // metadata on entering Data, while retaining any unsaved grid edits.
  useEffect(() => {
    let mounted = true;
    const hasPendingChanges = session.tabs.some((tab) => QueryResultDirtyService.hasPendingChanges(tab.id));
    if (hasPendingChanges || importFile) {
      // Explorer import already fetched fresh metadata before queuing its file.
      setReadyOwnerId(ownerId);
    } else {
      void runFetch().finally(() => {
        if (mounted) setReadyOwnerId(ownerId);
      });
    }
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  const activeResultTab =
    session.tabs.find((tab) => tab.id === session.activeTabId) ?? null;
  const showErrorOrCancel =
    session.status === "error" || session.status === "cancelled";
  const gridResult =
    readyOwnerId === ownerId &&
    !showErrorOrCancel &&
    activeResultTab?.result?.kind === "resultSet" &&
    activeResultTab.result.columns.length > 0
      ? activeResultTab.result
      : null;
  const logText = showErrorOrCancel
    ? session.output
    : (activeResultTab?.output ?? session.output);

  return (
    <div className="object-editor-data">
      <div className="object-editor-data__toolbar">
        <span
          className={`object-editor-data__status object-editor-data__status--${session.status}`}
        >
          {toStatusLabel(session.status, session.output, t)}
        </span>
        <button
          type="button"
          className="object-editor-data__refresh"
          onClick={() => void runFetch()}
          disabled={isRunning}
          title={t("common.refresh")}
          aria-label={t("common.refresh")}
        >
          <Codicon name="refresh" />
        </button>
      </div>
      <div className="object-editor-data__body">
        {gridResult && activeResultTab ? (
          <QueryResultGrid
            key={activeResultTab.id}
            tabId={activeResultTab.id}
            sql={activeResultTab.sql}
            executedSql={activeResultTab.executedSql}
            binds={activeResultTab.binds}
            result={gridResult}
            relationKind={activeResultTab.relationKind}
            connectionId={activeResultTab.connectionId}
            importFile={importFile}
            onImportFileConsumed={handleImportFileConsumed}
          />
        ) : (
          <pre className="object-editor-data__log">{logText}</pre>
        )}
      </div>
    </div>
  );
}

export default DataView;
