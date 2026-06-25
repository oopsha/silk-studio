import { useRef, useState } from "react";
import Codicon from "../../icons/Codicon";
import { MenuId } from "../../../platform/actions/menuId";
import { ViewService, type ActivityViewId } from "../../../services/view/viewService";
import { useActiveView } from "../../../services/view/useActiveView";
import ActivityBarContextMenu from "./ActivityBarContextMenu";
import "./ActivityBar.css";

type ActivityView = {
  id: ActivityViewId;
  icon: string;
  label: string;
};

type GlobalMenuId = "accounts" | "manage";

const ACTIVITY_VIEWS: ActivityView[] = [
  { id: "explorer", icon: "files", label: "Explorer" },
  { id: "search", icon: "search", label: "Search" },
  { id: "scm", icon: "source-control", label: "Source Control" },
];

function ActivityBar() {
  const activeViewId = useActiveView();
  const accountsButtonRef = useRef<HTMLButtonElement>(null);
  const manageButtonRef = useRef<HTMLButtonElement>(null);
  const [openGlobalMenu, setOpenGlobalMenu] = useState<GlobalMenuId | null>(
    null,
  );

  function toggleGlobalMenu(menuId: GlobalMenuId) {
    setOpenGlobalMenu((current) => (current === menuId ? null : menuId));
  }

  return (
    <aside className="activity-bar">
      <div className="activity-bar__content">
        <div className="activity-bar__composite-bar" role="tablist">
          {ACTIVITY_VIEWS.map((view) => {
            const isChecked = activeViewId === view.id;

            return (
              <div
                key={view.id}
                className={`activity-bar__item${isChecked ? " activity-bar__item--checked" : ""}`}
                role="presentation"
              >
                <button
                  type="button"
                  className="activity-bar__action"
                  role="tab"
                  aria-selected={isChecked}
                  aria-label={view.label}
                  title={view.label}
                  onClick={() => ViewService.openView(view.id)}
                >
                  <Codicon name={view.icon} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="activity-bar__global-actions">
          <div className="activity-bar__item" role="presentation">
            <button
              ref={accountsButtonRef}
              type="button"
              className={`activity-bar__action${openGlobalMenu === "accounts" ? " activity-bar__action--open" : ""}`}
              aria-label="Accounts"
              title="Accounts"
              aria-expanded={openGlobalMenu === "accounts"}
              aria-haspopup="menu"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => toggleGlobalMenu("accounts")}
            >
              <Codicon name="account" />
            </button>
          </div>
          <div className="activity-bar__item" role="presentation">
            <button
              ref={manageButtonRef}
              type="button"
              className={`activity-bar__action${openGlobalMenu === "manage" ? " activity-bar__action--open" : ""}`}
              aria-label="Manage"
              title="Manage"
              aria-expanded={openGlobalMenu === "manage"}
              aria-haspopup="menu"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => toggleGlobalMenu("manage")}
            >
              <Codicon name="settings-gear" />
            </button>
          </div>
        </div>
      </div>

      {openGlobalMenu === "accounts" ? (
        <ActivityBarContextMenu
          key="accounts"
          menuId={MenuId.AccountsContext}
          anchorRef={accountsButtonRef}
          onClose={() => setOpenGlobalMenu(null)}
        />
      ) : null}
      {openGlobalMenu === "manage" ? (
        <ActivityBarContextMenu
          key="manage"
          menuId={MenuId.GlobalActivity}
          anchorRef={manageButtonRef}
          onClose={() => setOpenGlobalMenu(null)}
        />
      ) : null}
    </aside>
  );
}

export default ActivityBar;
