import { useI18n } from "../../../platform/i18n/useI18n";
import { useActiveView } from "../../../services/view/useActiveView";
import type { ActivityViewContribution } from "../../../services/view/viewService";
import "./Sidebar.css";

type SidebarProps = {
  views: readonly ActivityViewContribution[];
};

function Sidebar({ views }: SidebarProps) {
  const activeViewId = useActiveView();
  const { t } = useI18n();
  const activeView = views.find((view) => view.id === activeViewId);

  return (
    <aside className="sidebar" aria-label={t("workbench.sidebar.primaryAria")}>
      <div className="sidebar__content">
        {views.map((view) => (
          <div
            className="sidebar__view-host"
            key={view.id}
            style={{ display: view.id === activeViewId ? "flex" : "none" }}
          >
            {view.render()}
          </div>
        ))}
      </div>
    </aside>
  );
}

export default Sidebar;
