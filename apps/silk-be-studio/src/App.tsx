import { useEffect, useState } from "react";
import ActivityBar from "@silk-studio/workbench/components/layout/ActivityBar/index.ts";
import EditorGroupsView from "@silk-studio/workbench/components/layout/EditorGroupsView/index.ts";
import SecondarySidebar from "@silk-studio/workbench/components/layout/SecondarySidebar/index.ts";
import Sidebar from "@silk-studio/workbench/components/layout/Sidebar/index.ts";
import StatusBar from "@silk-studio/workbench/components/layout/StatusBar/index.ts";
import TitleBar from "@silk-studio/workbench/components/layout/TitleBar/index.ts";
import WorkbenchSash from "@silk-studio/workbench/components/layout/WorkbenchSash/index.ts";
import ConfirmDialog from "@silk-studio/workbench/components/dialogs/ConfirmDialog.tsx";
import KeybindingsEditor from "@silk-studio/workbench/components/keybindings/index.ts";
import DocumentationViewer from "@silk-studio/workbench/components/help/index.ts";
import CommandPalette from "@silk-studio/workbench/components/commands/index.ts";
import AboutDialog from "@silk-studio/workbench/components/diagnostics/AboutDialog.tsx";
import AiAuditLogDialog from "@silk-studio/workbench/components/ai/AiAuditLogDialog.tsx";
import AppToast from "@silk-studio/workbench/components/diagnostics/AppToast.tsx";
import ViewPaneTitle from "@silk-studio/workbench/components/layout/Sidebar/ViewPaneTitle/ViewPaneTitle.tsx";
import OpenEditorsSection from "@silk-studio/workbench/components/layout/Sidebar/OpenEditors/OpenEditorsSection.tsx";
import SettingsEditor from "@silk-studio/workbench/components/settings/index.ts";
import SpringProjectSettings from "./components/settings/SpringProjectSettings.tsx";
import { startEditorSessionSync } from "@silk-studio/editor/services/editor/editorSessionSync.ts";
import { CommandService } from "@silk-studio/workbench/platform/commands/commandService.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";
import { I18nService } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { LayoutService } from "@silk-studio/workbench/services/layout/layoutService.ts";
import { useLayoutState } from "@silk-studio/workbench/services/layout/useLayoutState.ts";
import { useWorkbenchSashDrag } from "@silk-studio/workbench/services/layout/useWorkbenchSashDrag.ts";
import { useWorkbenchKeybindings } from "@silk-studio/workbench/services/keybinding/useWorkbenchKeybindings.ts";
import { WindowTitleService } from "@silk-studio/workbench/services/windowTitle/windowTitleService.ts";
import { SettingsService } from "@silk-studio/workbench/services/settings/settingsService.ts";
import { KeybindingsEditorService } from "@silk-studio/workbench/services/keybindings/keybindingsEditorService.ts";
import { DocumentationService } from "@silk-studio/workbench/services/help/documentationService.ts";
import {
  cancelEditorTabSplitDrag,
  commitEditorTabSplitDrop,
  updateEditorTabSplitHover,
} from "./services/editorTabSplitDrag";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import type { ActivityViewContribution } from "@silk-studio/workbench/services/view/viewService.ts";
import { startWindowLayoutSync } from "@silk-studio/workbench/services/layout/windowLayoutSync.ts";
import { saveStartupTheme } from "./services/startupTheme";
import ProjectExplorer from "./components/ProjectExplorer";

const tabBarCommands = {
  executeCommand: (commandId: string) => CommandService.executeCommand(commandId),
  lookupKeybinding: (commandId: string) =>
    KeybindingsRegistry.lookupKeybinding(commandId),
};

const crossGroupEditorDnd = {
  updateHover: updateEditorTabSplitHover,
  commitDrop: commitEditorTabSplitDrop,
  cancel: cancelEditorTabSplitDrag,
};

function EmptyView({ title, message }: { title: string; message: string }) {
  return (
    <div className="be-view">
      <ViewPaneTitle title={title} />
      <div className="be-project-empty">{message}</div>
    </div>
  );
}

function ExplorerView() {
  const { t } = useI18n();
  const [openEditorsExpanded, setOpenEditorsExpanded] = useState(true);

  return (
    <div className="be-view">
      <ViewPaneTitle title={t("workbench.activityBar.explorer")} />
      <OpenEditorsSection
        newFileTitleKey="studio.be.commands.newFile"
        expanded={openEditorsExpanded}
        onToggle={() => setOpenEditorsExpanded((expanded) => !expanded)}
      />
      <ProjectExplorer />
    </div>
  );
}

function EditorWorkspace() {
  const configuration = useConfiguration();

  return (
    <div className="workbench-shell__editor">
      <EditorGroupsView
        commands={tabBarCommands}
        crossGroupDnd={crossGroupEditorDnd}
        getPaneProps={(groupId) => ({
          "data-silk-editor-drop": "",
          "data-silk-editor-drop-group": groupId,
        })}
        editorProps={{
          configuration: {
            colorTheme: configuration["workbench.colorTheme"],
            fontFamily: configuration["editor.fontFamily"],
            fontLigatures: configuration["editor.fontLigatures"],
            fontSize: configuration["editor.fontSize"],
            tabSize: configuration["editor.tabSize"],
            insertSpaces: configuration["editor.insertSpaces"],
            lineNumbers: configuration["editor.lineNumbers"],
            minimapEnabled: configuration["editor.minimap.enabled"],
            stickyScrollEnabled: configuration["editor.stickyScroll.enabled"],
            wordWrap: configuration["editor.wordWrap"],
          },
          renderAlternative: (tab) => {
            if (SettingsService.isSettingsTab(tab.uri)) {
              return (
                <SettingsEditor
                  categories={["appearance", "editor", "springProject", "ai"]}
                  extensions={[{ id: "springProject", label: "Spring 프로젝트", content: <SpringProjectSettings /> }]}
                  showDatabaseAiOptions={false}
                />
              );
            }
            if (KeybindingsEditorService.isKeybindingsTab(tab.uri)) {
              return <KeybindingsEditor />;
            }
            if (DocumentationService.isDocumentationTab(tab.uri)) {
              return <DocumentationViewer studioName="Silk BE Studio" backendStudio />;
            }
            return null;
          },
        }}
      />
    </div>
  );
}

function App() {
  useWorkbenchKeybindings();
  const layout = useLayoutState();
  const { startDrag } = useWorkbenchSashDrag();
  const configuration = useConfiguration();
  const { t } = useI18n();

  const activityViews: ActivityViewContribution[] = [
    {
      id: "explorer",
      icon: "files",
      label: t("workbench.activityBar.explorer"),
      render: () => <ExplorerView />,
    },
    {
      id: "search",
      icon: "search",
      label: t("workbench.activityBar.search"),
      render: () => (
        <EmptyView
          title={t("workbench.activityBar.search")}
          message="프로젝트를 열면 파일 검색을 사용할 수 있습니다."
        />
      ),
    },
    {
      id: "scm",
      icon: "source-control",
      label: t("workbench.activityBar.scm"),
      render: () => (
        <EmptyView
          title={t("workbench.activityBar.scm")}
          message="소스 제어 기능을 준비하고 있습니다."
        />
      ),
    },
    {
      id: "run-debug",
      icon: "run",
      label: t("workbench.activityBar.runDebug"),
      render: () => (
        <EmptyView
          title={t("workbench.activityBar.runDebug")}
          message="실행 및 디버그 기능을 준비하고 있습니다."
        />
      ),
    },
  ];

  useEffect(() => {
    I18nService.start();
    WindowTitleService.setWorkspaceName("silk-be-studio");
    LayoutService.showAuxiliaryBar();
  }, []);

  useEffect(() => startWindowLayoutSync(), []);

  useEffect(
    () => startEditorSessionSync({ storageScope: "be-studio" }),
    [],
  );

  useEffect(() => {
    void saveStartupTheme();
  }, [configuration["workbench.colorTheme"]]);

  return (
    <div className="workbench-shell" data-testid="app-shell">
      <TitleBar />
      <div className="workbench-shell__body">
        <div className="workbench-shell__workbench">
          <ActivityBar views={activityViews} />
          <div className="workbench-shell__main">
            <div className="workbench-shell__workspace">
              {layout.sidebar ? (
                <>
                  <div
                    className="workbench-shell__sidebar"
                    style={{ width: layout.sidebarWidth }}
                  >
                    <Sidebar views={activityViews} />
                  </div>
                  <WorkbenchSash
                    orientation="vertical"
                    onPointerDown={(event) => {
                      const startX = event.clientX;
                      const startWidth = layout.sidebarWidth;
                      startDrag({
                        orientation: "vertical",
                        onResize: (clientX) =>
                          LayoutService.setSidebarWidth(
                            startWidth + clientX - startX,
                          ),
                      });
                    }}
                  />
                </>
              ) : null}
              <div className="workbench-shell__editor-column">
                <EditorWorkspace />
              </div>
              {layout.auxiliaryBar ? (
                <>
                  <WorkbenchSash
                    orientation="vertical"
                    onPointerDown={(event) => {
                      const startX = event.clientX;
                      const startWidth = layout.auxiliaryBarWidth;
                      startDrag({
                        orientation: "vertical",
                        onResize: (clientX) =>
                          LayoutService.setAuxiliaryBarWidth(
                            startWidth - clientX + startX,
                          ),
                      });
                    }}
                  />
                  <div
                    className="workbench-shell__auxiliary-bar"
                    style={{ width: layout.auxiliaryBarWidth }}
                  >
                    <SecondarySidebar />
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
        <StatusBar leftExtra={<span className="be-status-project">Silk BE Studio</span>} />
      </div>
      <ConfirmDialog />
      <CommandPalette />
      <AboutDialog
        appName="Silk BE Studio"
        appVersion="0.1.0"
        fetchRuntimeInfo={false}
        showDatabaseRuntimeInfo={false}
        showLogFolderAction={false}
      />
      <AiAuditLogDialog />
      <AppToast />
    </div>
  );
}

export default App;
