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
import { CommandService } from "@silk-studio/workbench/platform/commands/commandService.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";

const tabBarCommands = {
  executeCommand: (commandId: string) =>
    CommandService.executeCommand(commandId),
  lookupKeybinding: (commandId: string) =>
    KeybindingsRegistry.lookupKeybinding(commandId),
};

function AppShell() {
  const layout = useLayoutState();
  const { startDrag } = useWorkbenchSashDrag();

  const panelOnBottom = layout.panelPosition === "bottom";
  const showEditor = !layout.panelMaximized;

  const editorArea = (
    <div
      className={`app-shell__editor${showEditor ? "" : " app-shell__editor--hidden"}`}
    >
      <EditorArea
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
                    <Sidebar />
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
    </div>
  );
}

export default AppShell;
