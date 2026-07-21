import "./SecondarySidebar.css";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";

function SecondarySidebar() {
  return (
    <aside className="secondary-sidebar" aria-label="AI Chat">
      <header className="secondary-sidebar__header">
        <span className="secondary-sidebar__title">
          <Codicon name="comment-discussion" />
          AI Chat
        </span>
      </header>
      <div className="secondary-sidebar__content">
        <p className="secondary-sidebar__placeholder">
          AI assistant will appear here.
        </p>
      </div>
    </aside>
  );
}

export default SecondarySidebar;
