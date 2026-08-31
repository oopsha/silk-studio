import type { ReactNode } from "react";
import { useI18n } from "../../../platform/i18n/useI18n";
import { useActiveView } from "../../../services/view/useActiveView";
import ExplorerView from "./views/ExplorerView/ExplorerView";
import "./Sidebar.css";

type SidebarProps = {
  renderConnections?: () => ReactNode;
  connectionsTitle?: string;
  connectionsActions?: ReactNode;
  renderHistory?: () => ReactNode;
  renderSearch?: () => ReactNode;
  renderOutline?: () => ReactNode;
  renderTimeline?: () => ReactNode;
};

function Sidebar({
  renderConnections,
  connectionsTitle,
  connectionsActions,
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
        {activeViewId === "explorer" ? (
          <ExplorerView
            renderConnections={renderConnections}
            connectionsTitle={connectionsTitle}
            connectionsActions={connectionsActions}
            renderOutline={renderOutline}
            renderTimeline={renderTimeline}
          />
        ) : null}
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
