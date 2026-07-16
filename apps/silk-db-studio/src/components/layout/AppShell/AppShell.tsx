import "./AppShell.css";
import ActivityBar from "@silk-studio/workbench/components/layout/ActivityBar/index.ts";
import Sidebar from "@silk-studio/workbench/components/layout/Sidebar/index.ts";
import TabBar from "@silk-studio/editor/components/layout/TabBar/index.ts";
import EditorArea from "@silk-studio/editor/components/layout/EditorArea/index.ts";
import Panel from "../Panel";
import SecondarySidebar from "@silk-studio/workbench/components/layout/SecondarySidebar/index.ts";
import StatusBar from "@silk-studio/workbench/components/layout/StatusBar/index.ts";
import TitleBar from "@silk-studio/workbench/components/layout/TitleBar/index.ts";
import { useLayoutVisibility } from "@silk-studio/workbench/services/layout/useLayoutVisibility.ts";
import { CommandService } from "@silk-studio/workbench/platform/commands/commandService.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";

const tabBarCommands = {
  executeCommand: (commandId: string) =>
    CommandService.executeCommand(commandId),
  lookupKeybinding: (commandId: string) =>
    KeybindingsRegistry.lookupKeybinding(commandId),
};

function AppShell() {
  const { sidebar, panel, auxiliaryBar } = useLayoutVisibility();

  return (
    <div className="app-shell">
      <TitleBar />

      <div className="app-shell__body">
        <div className="app-shell__workbench">
          <ActivityBar />

          <div className="app-shell__main">
            <div className="app-shell__workspace">
              {sidebar ? <Sidebar /> : null}

              <div className="app-shell__editor-column">
                <TabBar commands={tabBarCommands} />
                <EditorArea
                  onRunQuery={() =>
                    void CommandService.executeCommand("silk.query.execute")
                  }
                />
                {panel ? <Panel /> : null}
              </div>

              {auxiliaryBar ? <SecondarySidebar /> : null}
            </div>
          </div>
        </div>

        <StatusBar />
      </div>
    </div>
  );
}

export default AppShell;
