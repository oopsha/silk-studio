import "./AppShell.css";
import ActivityBar from "../ActivityBar";
import Sidebar from "../Sidebar";
import TabBar from "../TabBar";
import EditorArea from "../EditorArea";
import Panel from "../Panel";
import SecondarySidebar from "../SecondarySidebar";
import StatusBar from "../StatusBar";
import TitleBar from "../TitleBar";
import { useLayoutVisibility } from "../../../services/layout/useLayoutVisibility";

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
                <TabBar />
                <EditorArea />
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
