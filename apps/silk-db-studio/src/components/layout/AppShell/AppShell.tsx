import "./AppShell.css";
import { useEffect, useState } from "react";
import ActivityBar from "@silk-studio/workbench/components/layout/ActivityBar/index.ts";
import Sidebar from "@silk-studio/workbench/components/layout/Sidebar/index.ts";
import EditorGroupsView from "./EditorGroupsView.tsx";
import SecondarySidebar from "@silk-studio/workbench/components/layout/SecondarySidebar/index.ts";
import WorkbenchSash from "@silk-studio/workbench/components/layout/WorkbenchSash/index.ts";
import StatusBar from "@silk-studio/workbench/components/layout/StatusBar/index.ts";
import ConnectionTargetStatusItem from "../StatusBar/ConnectionTargetStatusItem.tsx";
import DatabaseTargetStatusItem from "../StatusBar/DatabaseTargetStatusItem.tsx";
import TransactionStatusItem from "../StatusBar/TransactionStatusItem.tsx";
import TitleBar from "@silk-studio/workbench/components/layout/TitleBar/index.ts";
import { LayoutService } from "@silk-studio/workbench/services/layout/layoutService.ts";
import { useLayoutState } from "@silk-studio/workbench/services/layout/useLayoutState.ts";
import { useWorkbenchSashDrag } from "@silk-studio/workbench/services/layout/useWorkbenchSashDrag.ts";
import SettingsEditor from "@silk-studio/workbench/components/settings/index.ts";
import KeybindingsEditor from "@silk-studio/workbench/components/keybindings/index.ts";
import DocumentationViewer from "@silk-studio/workbench/components/help/index.ts";
import CommandPalette from "@silk-studio/workbench/components/commands/index.ts";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import ConnectionsExplorer from "../../connections/ConnectionsExplorer.tsx";
import ContextMenu, { type ContextMenuItem } from "../../common/ContextMenu.tsx";
import ConnectionEditor from "../../connections/ConnectionEditor.tsx";
import ExplorerSearchQuickPick from "../../connections/ExplorerSearchQuickPick.tsx";
import ExplorerObjectMutationDialog from "../../connections/ExplorerObjectMutationDialog.tsx";
import AiSqlDiffDialog from "../../ai/AiSqlDiffDialog.tsx";
import AiSqlExecuteDialog from "../../ai/AiSqlExecuteDialog.tsx";
import SqlParameterDialog from "../../query/SqlParameterDialog.tsx";
import ConnectionExportDialog from "../../connections/ConnectionExportDialog.tsx";
import ConnectionImportDialog from "../../connections/ConnectionImportDialog.tsx";
import ConnectionPasswordPromptDialog from "../../connections/ConnectionPasswordPromptDialog.tsx";
import SshSecretPromptDialog from "../../connections/SshSecretPromptDialog.tsx";
import AboutDialog from "@silk-studio/workbench/components/diagnostics/AboutDialog.tsx";
import AiAuditLogDialog from "@silk-studio/workbench/components/ai/AiAuditLogDialog.tsx";
import AppToast from "@silk-studio/workbench/components/diagnostics/AppToast.tsx";
import PlsqlSaveDialog from "../../plsql/PlsqlSaveDialog.tsx";
import TableStructureSaveDialog from "../../object-editor/TableStructureSaveDialog.tsx";
import ConfirmDialog from "../../dialogs/ConfirmDialog.tsx";
import PlsqlSnapshotDialog from "../../plsql/PlsqlSnapshotDialog.tsx";
import PackagePlsqlSaveDialog from "../../plsql/PackagePlsqlSaveDialog.tsx";
import PackagePlsqlHistoryDialog from "../../plsql/PackagePlsqlHistoryDialog.tsx";
import DdlEditorView from "../../ddl/DdlEditorView.tsx";
import PlsqlEditorView from "../../plsql/PlsqlEditorView.tsx";
import ObjectEditorView from "../../object-editor/ObjectEditorView.tsx";
import QueryHistoryView from "../../query-history/QueryHistoryView.tsx";
import SearchExplorer from "../../search/SearchExplorer.tsx";
// Outline/Timeline sidebar sections are disabled for now — see the matching comment where
// these were wired into <Sidebar> below.
// import OutlineView from "../../outline/OutlineView.tsx";
// import TimelineView from "../../timeline/TimelineView.tsx";
import { ConnectionEditorService } from "../../../services/connection/connectionEditorService.ts";
import { isDdlEditorTab } from "../../../services/connection/ddlEditorConstants.ts";
import { isPlsqlEditorTab } from "../../../services/connection/plsqlEditorConstants.ts";
import { isObjectEditorTab } from "../../../services/connection/objectEditorConstants.ts";
import {
  EXPLORER_COMMANDS,
  formatQualifiedName,
} from "../../../services/connection/explorerObjectActions.ts";
import { ConnectionService } from "../../../services/connection/connectionService.ts";
import {
  setExplorerObjectDropHandler,
} from "../../../services/dnd/explorerObjectDrag.ts";
import { insertSqlIntoActiveEditor } from "../../../services/query/querySqlActions.ts";
import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { I18nService } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { SettingsService } from "@silk-studio/workbench/services/settings/settingsService.ts";
import { KeybindingsEditorService } from "@silk-studio/workbench/services/keybindings/keybindingsEditorService.ts";
import { DocumentationService } from "@silk-studio/workbench/services/help/documentationService.ts";
import { CommandService } from "@silk-studio/workbench/platform/commands/commandService.ts";
import { useWorkbenchKeybindings } from "@silk-studio/workbench/services/keybinding/useWorkbenchKeybindings.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";
import { useConnectionState } from "../../../services/connection/useConnectionState.ts";
import { registerSqlLanguages } from "../../../services/sql/registerSqlLanguages.ts";
import { registerSqlCompletion } from "../../../services/sql/registerSqlCompletion.ts";
import {
  exportConnectionProfiles,
  importConnectionProfiles,
} from "../../../services/connection/connectionExportService.ts";
import { ConnectionExportDialogService } from "../../../services/connection/connectionExportDialogService.ts";
import {
  exportSettings,
  importSettings,
} from "../../../services/settings/settingsExportService.ts";
import { formatErrorMessage } from "../../../services/formatErrorMessage.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import type { Monaco } from "@monaco-editor/react";

const tabBarCommands = {
  executeCommand: (commandId: string) =>
    CommandService.executeCommand(commandId),
  lookupKeybinding: (commandId: string) =>
    KeybindingsRegistry.lookupKeybinding(commandId),
};

function AppShell() {
  useWorkbenchKeybindings();
  useEffect(() => {
    I18nService.start();
  }, []);
  const { t } = useI18n();
  const layout = useLayoutState();
  const configuration = useConfiguration();
  const connection = useConnectionState();
  const { startDrag } = useWorkbenchSashDrag();

  const handleEditorBeforeMount = (monaco: Monaco) => {
    registerSqlLanguages(monaco);
    registerSqlCompletion(monaco);
  };

  useEffect(() => {
    setExplorerObjectDropHandler((payload, groupId) => {
      // Dropping onto an unfocused pane must insert (and focus) there, not
      // wherever focus happened to already be.
      if (groupId) {
        EditorGroupsService.setFocusedGroup(groupId);
      }
      const driverId = payload.profileId
        ? ConnectionService.getProfile(payload.profileId)?.driverId
        : undefined;
      insertSqlIntoActiveEditor(
        formatQualifiedName(payload.schemaName, payload.objectName, {
          databaseName: payload.databaseName,
          driverId,
        }),
      );
    });
    return () => setExplorerObjectDropHandler(null);
  }, []);

  async function handleExportConnections(): Promise<void> {
    const result = await ConnectionExportDialogService.open(
      connection.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        driverId: profile.driverId,
      })),
    );
    if (!result.confirmed) return;

    try {
      const ok = await exportConnectionProfiles(result.profileIds);
      if (ok) AppNotificationService.show(t("app.connection.exportSuccess"), "success");
    } catch (error) {
      AppNotificationService.show(
        formatErrorMessage(error, t("app.connection.exportFailed")),
        "error",
      );
    }
  }

  async function handleImportConnections(): Promise<void> {
    try {
      const result = await importConnectionProfiles();
      if (!result) return;
      AppNotificationService.show(
        result.skipped > 0
          ? t("app.connection.importSummaryWithSkipped")
              .replace("{imported}", String(result.imported))
              .replace("{skipped}", String(result.skipped))
          : t("app.connection.importSummary").replace(
              "{imported}",
              String(result.imported),
            ),
        result.imported > 0 ? "success" : "info",
      );
    } catch (error) {
      AppNotificationService.show(
        formatErrorMessage(error, t("app.connection.importFailed")),
        "error",
      );
    }
  }

  const [connectionsHeaderMenu, setConnectionsHeaderMenu] = useState<
    { x: number; y: number } | null
  >(null);

  // Mirrors connectionsActions' toolbar buttons below exactly — same items, same order, same
  // enabled/disabled conditions — so the header context menu is never missing something the
  // hover toolbar already offers.
  const connectionsHeaderMenuItems: ContextMenuItem[] = [
    {
      id: "newConnection",
      label: t("workbench.explorer.newConnection"),
      enabled: true,
    },
    {
      id: "searchObjects",
      label: t("workbench.explorer.searchObjects"),
      enabled: connection.connectedProfileIds.length > 0,
    },
    {
      id: "collapseAll",
      label: t("common.collapseAll"),
      enabled: connection.connectedProfileIds.length > 0,
      separator: true,
    },
    {
      id: "refreshAll",
      label: t("common.refresh"),
      enabled: connection.connectedProfileIds.length > 0,
    },
    {
      id: "exportConnections",
      label: t("app.connection.exportTitle"),
      enabled: connection.profiles.length > 0,
      separator: true,
    },
    {
      id: "importConnections",
      label: t("app.connection.importTitle"),
      enabled: true,
    },
  ];

  function handleConnectionsHeaderMenuSelect(item: ContextMenuItem) {
    switch (item.id) {
      case "newConnection":
        ConnectionEditorService.openNewConnection();
        return;
      case "searchObjects":
        void CommandService.executeCommand(EXPLORER_COMMANDS.searchObjects);
        return;
      case "collapseAll":
        void CommandService.executeCommand(EXPLORER_COMMANDS.collapseAll);
        return;
      case "refreshAll":
        void CommandService.executeCommand(EXPLORER_COMMANDS.refresh);
        return;
      case "exportConnections":
        void handleExportConnections();
        return;
      case "importConnections":
        void handleImportConnections();
        return;
      default:
        return;
    }
  }

  const connectionsActions = (
    <>
      <button
        type="button"
        className="accordion-panel__action"
        title={t("workbench.explorer.newConnection")}
        aria-label={t("workbench.explorer.newConnection")}
        onClick={() => ConnectionEditorService.openNewConnection()}
      >
        <Codicon name="add" />
      </button>
      <button
        type="button"
        className="accordion-panel__action"
        title={t("workbench.explorer.searchObjectsTitle")}
        aria-label={t("workbench.explorer.searchObjects")}
        disabled={connection.connectedProfileIds.length === 0}
        onClick={() =>
          void CommandService.executeCommand(EXPLORER_COMMANDS.searchObjects)
        }
      >
        <Codicon name="search" />
      </button>
      <button
        type="button"
        className="accordion-panel__action"
        title={t("common.collapseAll")}
        aria-label={t("common.collapseAll")}
        disabled={connection.connectedProfileIds.length === 0}
        onClick={() =>
          void CommandService.executeCommand(EXPLORER_COMMANDS.collapseAll)
        }
      >
        <Codicon name="collapse-all" />
      </button>
      <button
        type="button"
        className="accordion-panel__action"
        title={t("common.refresh")}
        aria-label={t("common.refresh")}
        disabled={connection.connectedProfileIds.length === 0}
        onClick={() =>
          void CommandService.executeCommand(EXPLORER_COMMANDS.refresh)
        }
      >
        <Codicon name="refresh" />
      </button>
      <button
        type="button"
        className="accordion-panel__action"
        title={t("app.connection.exportTitle")}
        aria-label={t("app.connection.exportTitle")}
        disabled={connection.profiles.length === 0}
        onClick={() => void handleExportConnections()}
      >
        <Codicon name="export" />
      </button>
      <button
        type="button"
        className="accordion-panel__action"
        title={t("app.connection.importTitle")}
        aria-label={t("app.connection.importTitle")}
        onClick={() => void handleImportConnections()}
      >
        <Codicon name="cloud-upload" />
      </button>
    </>
  );

  const editorArea = (
    <div className="app-shell__editor">
      <EditorGroupsView
        commands={tabBarCommands}
        editorProps={{
          configuration: {
            colorTheme: configuration["workbench.colorTheme"],
            fontSize: configuration["editor.fontSize"],
            tabSize: configuration["editor.tabSize"],
            insertSpaces: configuration["editor.insertSpaces"],
            lineNumbers: configuration["editor.lineNumbers"],
            minimapEnabled: configuration["editor.minimap.enabled"],
            stickyScrollEnabled: configuration["editor.stickyScroll.enabled"],
            wordWrap: configuration["editor.wordWrap"],
          },
          beforeMount: handleEditorBeforeMount,
          renderAlternative: (tab) => {
            if (SettingsService.isSettingsTab(tab.uri)) {
              return (
                <SettingsEditor
                  onExportSettings={exportSettings}
                  onImportSettings={importSettings}
                />
              );
            }
            if (KeybindingsEditorService.isKeybindingsTab(tab.uri)) {
              return <KeybindingsEditor />;
            }
            if (DocumentationService.isDocumentationTab(tab.uri)) {
              return <DocumentationViewer />;
            }
            if (ConnectionEditorService.isConnectionEditorTab(tab.uri)) {
              return <ConnectionEditor />;
            }
            if (isDdlEditorTab(tab.uri)) {
              return <DdlEditorView />;
            }
            if (isPlsqlEditorTab(tab.uri)) {
              return <PlsqlEditorView />;
            }
            if (isObjectEditorTab(tab.uri)) {
              return <ObjectEditorView />;
            }
            return null;
          },
          onRunQuery: () =>
            void CommandService.executeCommand("silk.query.execute"),
          onRunScript: () =>
            void CommandService.executeCommand("silk.query.executeScript"),
        }}
      />
    </div>
  );

  const editorColumn = (
    <div className="app-shell__editor-column">{editorArea}</div>
  );

  return (
    <div className="app-shell" data-testid="app-shell">
      <TitleBar />

      <div className="app-shell__body">
        <div className="app-shell__workbench">
          <ActivityBar />

          <div className="app-shell__main">
            <div className="app-shell__workspace">
              {layout.sidebar ? (
                <>
                  <div
                    className="app-shell__sidebar"
                    style={{ width: layout.sidebarWidth }}
                  >
                    <Sidebar
                      connectionsTitle={t("workbench.sidebar.connections")}
                      connectionsActions={connectionsActions}
                      connectionsHeaderContextMenu={(event) => {
                        event.preventDefault();
                        setConnectionsHeaderMenu({
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                      renderConnections={() => <ConnectionsExplorer />}
                      renderHistory={() => <QueryHistoryView />}
                      renderSearch={() => <SearchExplorer />}
                      // Outline/Timeline sidebar sections are disabled for now — see the
                      // matching comment in ExplorerView.tsx's SECTION_ORDER/VIEW_MENU_DEFS.
                      // renderOutline={() => <OutlineView />}
                      // renderTimeline={() => <TimelineView />}
                    />
                  </div>
                  {connectionsHeaderMenu ? (
                    <ContextMenu
                      anchor={{
                        top: connectionsHeaderMenu.y,
                        left: connectionsHeaderMenu.x,
                      }}
                      items={connectionsHeaderMenuItems}
                      onClose={() => setConnectionsHeaderMenu(null)}
                      onSelect={handleConnectionsHeaderMenuSelect}
                    />
                  ) : null}
                  <WorkbenchSash
                    orientation="vertical"
                    onPointerDown={(event) => {
                      const startX = event.clientX;
                      const startWidth = layout.sidebarWidth;
                      startDrag({
                        orientation: "vertical",
                        onResize: (clientX) => {
                          LayoutService.setSidebarWidth(
                            startWidth + (clientX - startX),
                          );
                        },
                      });
                    }}
                  />
                </>
              ) : null}

              {editorColumn}

              {layout.auxiliaryBar ? (
                <>
                  <WorkbenchSash
                    orientation="vertical"
                    onPointerDown={(event) => {
                      const startX = event.clientX;
                      const startWidth = layout.auxiliaryBarWidth;
                      startDrag({
                        orientation: "vertical",
                        onResize: (clientX) => {
                          LayoutService.setAuxiliaryBarWidth(
                            startWidth - (clientX - startX),
                          );
                        },
                      });
                    }}
                  />
                  <div
                    className="app-shell__auxiliary-bar"
                    style={{ width: layout.auxiliaryBarWidth }}
                  >
                    <SecondarySidebar />
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <StatusBar
          leftExtra={
            <>
              <ConnectionTargetStatusItem />
              <DatabaseTargetStatusItem />
              <TransactionStatusItem />
            </>
          }
        />
      </div>
      <ExplorerSearchQuickPick />
      <CommandPalette />
      <ExplorerObjectMutationDialog />
      <AiSqlDiffDialog />
      <AiSqlExecuteDialog />
      <SqlParameterDialog />
      <ConnectionExportDialog />
      <ConnectionImportDialog />
      <ConnectionPasswordPromptDialog />
      <SshSecretPromptDialog />
      <PlsqlSaveDialog />
      <TableStructureSaveDialog />
      <ConfirmDialog />
      <PlsqlSnapshotDialog />
      <PackagePlsqlSaveDialog />
      <PackagePlsqlHistoryDialog />
      <AboutDialog />
      <AiAuditLogDialog />
      <AppToast />
    </div>
  );
}

export default AppShell;
