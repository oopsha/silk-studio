import type { ReactNode } from "react";
import { useActiveView } from "../../../services/view/useActiveView";
import ExplorerView from "./views/ExplorerView/ExplorerView";
import "./Sidebar.css";

type SidebarProps = {
  renderConnections?: () => ReactNode;
  connectionsTitle?: string;
  connectionsActions?: ReactNode;
  renderHistory?: () => ReactNode;
};

function Sidebar({
  renderConnections,
  connectionsTitle,
  connectionsActions,
  renderHistory,
}: SidebarProps) {
  const activeViewId = useActiveView();

  return (
    <aside className="sidebar" aria-label="Primary Side Bar">
      <div className="sidebar__content">
        {activeViewId === "explorer" ? (
          <ExplorerView
            renderConnections={renderConnections}
            connectionsTitle={connectionsTitle}
            connectionsActions={connectionsActions}
          />
        ) : null}
        {activeViewId === "search" ? (
          <div className="sidebar-view-placeholder">Search</div>
        ) : null}
        {activeViewId === "scm" ? (
          <div className="sidebar-view-placeholder">Source Control</div>
        ) : null}
        {activeViewId === "history" ? (
          renderHistory ? (
            renderHistory()
          ) : (
            <div className="sidebar-view-placeholder">Query History</div>
          )
        ) : null}
      </div>
    </aside>
  );
}

export default Sidebar;
