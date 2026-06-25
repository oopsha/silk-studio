import { useActiveView } from "../../../services/view/useActiveView";
import ExplorerView from "./views/ExplorerView/ExplorerView";
import "./Sidebar.css";

function Sidebar() {
  const activeViewId = useActiveView();

  return (
    <aside className="sidebar">
      <div className="sidebar__content">
        {activeViewId === "explorer" ? <ExplorerView /> : null}
        {activeViewId === "search" ? (
          <div className="sidebar-view-placeholder">Search</div>
        ) : null}
        {activeViewId === "scm" ? (
          <div className="sidebar-view-placeholder">Source Control</div>
        ) : null}
      </div>
    </aside>
  );
}

export default Sidebar;
