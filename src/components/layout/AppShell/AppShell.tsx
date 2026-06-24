import "./AppShell.css";
import ActivityBar from "../ActivityBar";
import Sidebar from "../Sidebar";
import TabBar from "../TabBar";
import EditorArea from "../EditorArea";
import Panel from "../Panel";
import StatusBar from "../StatusBar";
import TitleBar from "../TitleBar";

function AppShell() {
  return (
    <div className="app-shell">
      <TitleBar />

      <div className="app-shell__body">
        <ActivityBar />

        <div className="app-shell__main">
          <div className="app-shell__workspace">
            <Sidebar />

            <div className="app-shell__editor-column">
              <TabBar />
              <EditorArea />
              <Panel />
            </div>

            {/* <SecondarySidebar /> */}
          </div>

          <StatusBar />
        </div>
      </div>
    </div>
  );
}

export default AppShell;
