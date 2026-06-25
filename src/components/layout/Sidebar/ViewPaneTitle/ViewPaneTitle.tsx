import type { ReactNode } from "react";
import "./ViewPaneTitle.css";

type ViewPaneTitleProps = {
  title: string;
  actions?: ReactNode;
};

function ViewPaneTitle({ title, actions }: ViewPaneTitleProps) {
  return (
    <div className="view-pane-title">
      <div className="view-pane-title__label">
        <h2 className="view-pane-title__text">{title}</h2>
      </div>
      {actions ? (
        <div className="view-pane-title__actions">{actions}</div>
      ) : null}
    </div>
  );
}

export default ViewPaneTitle;
