import "./AppShell.css";
import ActivityBar from "@silk-studio/workbench/components/layout/ActivityBar/index.ts";
import Sidebar from "@silk-studio/workbench/components/layout/Sidebar/index.ts";
import TabBar from "@silk-studio/editor/components/layout/TabBar/index.ts";
import EditorArea from "@silk-studio/editor/components/layout/EditorArea/index.ts";
import Panel from "../Panel";
import SecondarySidebar from "@silk-studio/workbench/components/layout/SecondarySidebar/index.ts";
import WorkbenchSash from "@silk-studio/workbench/components/layout/WorkbenchSash/index.ts";
import StatusBar from "@silk-studio/workbench/components/layout/StatusBar/index.ts";
import TitleBar from "@silk-studio/workbench/components/layout/TitleBar/index.ts";
import { LayoutService } from "@silk-studio/workbench/services/layout/layoutService.ts";
import { useLayoutState } from "@silk-studio/workbench/services/layout/useLayoutState.ts";
import { useWorkbenchSashDrag } from "@silk-studio/workbench/services/layout/useWorkbenchSashDrag.ts";
import SettingsEditor from "@silk-studio/workbench/components/settings/index.ts";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import ConnectionsExplorer from "../../connections/ConnectionsExplorer.tsx";
import ConnectionEditor from "../../connections/ConnectionEditor.tsx";
import ExplorerSearchQuickPick from "../../connections/ExplorerSearchQuickPick.tsx";
import ExplorerObjectMutationDialog from "../../connections/ExplorerObjectMutationDialog.tsx";
import AiSqlDiffDialog from "../../ai/AiSqlDiffDialog.tsx";
import AiSqlExecuteDialog from "../../ai/AiSqlExecuteDialog.tsx";
import AboutDialog from "@silk-studio/workbench/components/diagnostics/AboutDialog.tsx";
import AppToast from "@silk-studio/workbench/components/diagnostics/AppToast.tsx";
import PlsqlSaveDialog from "../../plsql/PlsqlSaveDialog.tsx";
import PlsqlSnapshotDialog from "../../plsql/PlsqlSnapshotDialog.tsx";
import DdlEditorView from "../../ddl/DdlEditorView.tsx";
import PlsqlEditorView from "../../plsql/PlsqlEditorView.tsx";
import QueryHistoryView from "../../query-history/QueryHistoryView.tsx";
import { ConnectionEditorService } from "../../../services/connection/connectionEditorService.ts";
import { isDdlEditorTab } from "../../../services/connection/ddlEditorConstants.ts";
import { isPlsqlEditorTab } from "../../../services/connection/plsqlEditorConstants.ts";
import { EXPLORER_COMMANDS } from "../../../services/connection/explorerObjectActions.ts";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { SettingsService } from "@silk-studio/workbench/services/settings/settingsService.ts";
import { CommandService } from "@silk-studio/workbench/platform/commands/commandService.ts";
import { useWorkbenchKeybindings } from "@silk-studio/workbench/services/keybinding/useWorkbenchKeybindings.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";
import { useConnectionState } from "../../../services/connection/useConnectionState.ts";
import { registerSqlLanguages } from "../../../services/sql/registerSqlLanguages.ts";
import { registerSqlCompletion } from "../../../services/sql/registerSqlCompletion.ts";
import type { Monaco } from "@monaco-editor/react";

const tabBarCommands = {
  executeCommand: (commandId: string) =>
    CommandService.executeCommand(commandId),
  lookupKeybinding: (commandId: string) =>
    KeybindingsRegistry.lookupKeybinding(commandId),
};

function AppShell() {
  useWorkbenchKeybindings();
  const layout = useLayoutState();
  const configuration = useConfiguration();
  const connection = useConnectionState();
  const { startDrag } = useWorkbenchSashDrag();

  const handleEditorBeforeMount = (monaco: Monaco) => {
    registerSqlLanguages(monaco);
    registerSqlCompletion(monaco);
  };

  const panelOnBottom = layout.panelPosition === "bottom";
  const showEditor = !layout.panelMaximized;

  const connectionsActions = (
    <>
      <button
        type="button"
        className="accordion-panel__action"
        title="New Connection"
        aria-label="New Connection"
        onClick={() => ConnectionEditorService.openNewConnection()}
      >
        <Codicon name="add" />
      </button>
      <button
        type="button"
        className="accordion-panel__action"
        title="Search Database Objects (Ctrl+Shift+O)"
        aria-label="Search Database Objects"
        disabled={!connection.connectedProfileId}
        onClick={() =>
          void CommandService.executeCommand(EXPLORER_COMMANDS.searchObjects)
        }
      >
        <Codicon name="search" />
      </button>
      <button
        type="button"
        className="accordion-panel__action"
        title="Collapse All"
        aria-label="Collapse All"
        disabled={!connection.connectedProfileId}
        onClick={() =>
          void CommandService.executeCommand(EXPLORER_COMMANDS.collapseAll)
        }
      >
        <Codicon name="collapse-all" />
      </button>
      <button
        type="button"
        className="accordion-panel__action"
        title="Refresh"
        aria-label="Refresh"
        disabled={!connection.connectedProfileId}
        onClick={() =>
          void CommandService.executeCommand(EXPLORER_COMMANDS.refresh)
        }
      >
        <Codicon name="refresh" />
      </button>
    </>
  );

  const editorArea = (
    <div
      className={`app-shell__editor${showEditor ? "" : " app-shell__editor--hidden"}`}
    >
      <EditorArea
        configuration={{
          colorTheme: configuration["workbench.colorTheme"],
          fontSize: configuration["editor.fontSize"],
          tabSize: configuration["editor.tabSize"],
          insertSpaces: configuration["editor.insertSpaces"],
          lineNumbers: configuration["editor.lineNumbers"],
          minimapEnabled: configuration["editor.minimap.enabled"],
          wordWrap: configuration["editor.wordWrap"],
        }}
        beforeMount={handleEditorBeforeMount}
        renderAlternative={(tab) => {
          if (SettingsService.isSettingsTab(tab.uri)) {
            return <SettingsEditor />;
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
          return null;
        }}
        onRunQuery={() =>
          void CommandService.executeCommand("silk.query.execute")
        }
      />
    </div>
  );

  const panelElement = layout.panel ? (
  <div
    className={`app-shell__panel${layout.panelMaximized ? " app-shell__panel--maximized" : ""}`}
    style={
      panelOnBottom
        ? { height: layout.panelMaximized ? undefined : layout.panelSize }
        : { width: layout.panelMaximized ? undefined : layout.panelSize }
    }
  >
    <Panel />
  </div>
  ) : null;

  const editorColumn = (
    <div
      className={`app-shell__editor-column${
        layout.panelMaximized && !panelOnBottom
          ? " app-shell__editor-column--panel-maximized"
          : ""
      }`}
    >
      <TabBar commands={tabBarCommands} />
      {panelOnBottom ? (
        <>
          {editorArea}
          {layout.panel ? (
            <>
              {showEditor ? (
                <WorkbenchSash
                  orientation="horizontal"
                  onPointerDown={(event) => {
                    const startY = event.clientY;
                    const startSize = layout.panelSize;
                    startDrag({
                      orientation: "horizontal",
                      onResize: (clientY) => {
                        LayoutService.setPanelSize(
                          startSize - (clientY - startY),
                        );
                      },
                    });
                  }}
                />
              ) : null}
              {panelElement}
            </>
          ) : null}
        </>
      ) : (
        editorArea
      )}
    </div>
  );

  return (
    <div className="app-shell">
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
                      connectionsTitle="CONNECTIONS"
                      connectionsActions={connectionsActions}
                      renderConnections={() => <ConnectionsExplorer />}
                      renderHistory={() => <QueryHistoryView />}
                    />
                  </div>
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

              {!panelOnBottom && layout.panel ? (
                <>
                  {showEditor ? (
                    <WorkbenchSash
                      orientation="vertical"
                      onPointerDown={(event) => {
                        const startX = event.clientX;
                        const startSize = layout.panelSize;
                        startDrag({
                          orientation: "vertical",
                          onResize: (clientX) => {
                            LayoutService.setPanelSize(
                              startSize - (clientX - startX),
                            );
                          },
                        });
                      }}
                    />
                  ) : null}
                  {panelElement}
                </>
              ) : null}

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

        <StatusBar />
      </div>
      <ExplorerSearchQuickPick />
      <ExplorerObjectMutationDialog />
      <AiSqlDiffDialog />
      <AiSqlExecuteDialog />
      <PlsqlSaveDialog />
      <PlsqlSnapshotDialog />
      <AboutDialog />
      <AppToast />
    </div>
  );
}

export default AppShell;
