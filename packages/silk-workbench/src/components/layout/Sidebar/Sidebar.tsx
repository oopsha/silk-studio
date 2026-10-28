import type { MouseEvent, ReactNode } from "react";
import { useI18n } from "../../../platform/i18n/useI18n";
import { useActiveView } from "../../../services/view/useActiveView";
import ExplorerView from "./views/ExplorerView/ExplorerView";
import "./Sidebar.css";

type SidebarProps = {
  renderConnections?: () => ReactNode;
  connectionsTitle?: string;
  connectionsActions?: ReactNode;
  connectionsHeaderContextMenu?: (event: MouseEvent) => void;
  renderHistory?: () => ReactNode;
  renderSearch?: () => ReactNode;
  renderOutline?: () => ReactNode;
  renderTimeline?: () => ReactNode;
};

function Sidebar({
  renderConnections,
  connectionsTitle,
  connectionsActions,
  connectionsHeaderContextMenu,
  renderHistory,
  renderSearch,
  renderOutline,
  renderTimeline,
}: SidebarProps) {
  const activeViewId = useActiveView();
  const { t } = useI18n();

  return (
    <aside className="sidebar" aria-label={t("workbench.sidebar.primaryAria")}>
      <div className="sidebar__content">
        {/* Keep Explorer mounted while another activity view is active. Its connection
            filter and per-profile tree expansion live in component state and should survive
            switching to Search/History and back. */}
        <div
          className="sidebar__view-host"
          style={{ display: activeViewId === "explorer" ? "flex" : "none" }}
        >
          <ExplorerView
            renderConnections={renderConnections}
            connectionsTitle={connectionsTitle}
            connectionsActions={connectionsActions}
            connectionsHeaderContextMenu={connectionsHeaderContextMenu}
            renderOutline={renderOutline}
            renderTimeline={renderTimeline}
          />
        </div>
        {activeViewId === "search" ? (
          renderSearch ? (
            renderSearch()
          ) : (
            <div className="sidebar-view-placeholder">
              {t("workbench.activityBar.search")}
            </div>
          )
        ) : null}
        {activeViewId === "scm" ? (
          <div className="sidebar-view-placeholder">
            {t("workbench.activityBar.scm")}
          </div>
        ) : null}
        {activeViewId === "history" ? (
          renderHistory ? (
            renderHistory()
          ) : (
            <div className="sidebar-view-placeholder">
              {t("workbench.activityBar.history")}
            </div>
          )
        ) : null}
      </div>
    </aside>
  );
}

export default Sidebar;
