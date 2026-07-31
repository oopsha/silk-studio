import { useRef, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { MenuId } from "../../../platform/actions/menuId";
import { useI18n } from "../../../platform/i18n/useI18n";
import type { MessageKey } from "../../../platform/i18n/translate";
import { ViewService, type ActivityViewId } from "../../../services/view/viewService";
import { useActiveView } from "../../../services/view/useActiveView";
import ActivityBarContextMenu from "./ActivityBarContextMenu";
import "./ActivityBar.css";

type ActivityView = {
  id: ActivityViewId;
  icon: string;
  labelKey: MessageKey;
};

type GlobalMenuId = "accounts" | "manage";

const ACTIVITY_VIEWS: ActivityView[] = [
  { id: "explorer", icon: "files", labelKey: "workbench.activityBar.explorer" },
  { id: "search", icon: "search", labelKey: "workbench.activityBar.search" },
  { id: "scm", icon: "source-control", labelKey: "workbench.activityBar.scm" },
  { id: "history", icon: "history", labelKey: "workbench.activityBar.history" },
];

function ActivityBar() {
  const { t } = useI18n();
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
    <aside
      className="activity-bar"
      data-testid="activity-bar"
      aria-label={t("workbench.activityBar.ariaLabel")}
    >
      <div className="activity-bar__content">
        <div className="activity-bar__composite-bar" role="tablist">
          {ACTIVITY_VIEWS.map((view) => {
            const isChecked = activeViewId === view.id;
            const label = t(view.labelKey);

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
                  aria-label={label}
                  title={label}
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
              aria-label={t("workbench.activityBar.accounts")}
              title={t("workbench.activityBar.accounts")}
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
              aria-label={t("workbench.activityBar.manage")}
              title={t("workbench.activityBar.manage")}
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
