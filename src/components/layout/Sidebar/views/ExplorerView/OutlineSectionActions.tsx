import { useEffect, useRef, useState } from "react";
import Codicon from "../../../../icons/Codicon";
import OutlineMoreMenu, {
  type OutlineSortOrder,
} from "../../OutlineMoreMenu/OutlineMoreMenu";

type OutlineSectionActionsProps = {
  onMenuOpenChange?: (open: boolean) => void;
};

function OutlineSectionActions({
  onMenuOpenChange,
}: OutlineSectionActionsProps) {
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [allCollapsed, setAllCollapsed] = useState(true);
  const [followCursor, setFollowCursor] = useState(false);
  const [filterOnType, setFilterOnType] = useState(true);
  const [sortBy, setSortBy] = useState<OutlineSortOrder>("position");

  useEffect(() => {
    onMenuOpenChange?.(menuOpen);
  }, [menuOpen, onMenuOpenChange]);

  const collapseExpandIcon = allCollapsed ? "expand-all" : "collapse-all";
  const collapseExpandLabel = allCollapsed ? "Expand All" : "Collapse All";

  return (
    <>
      <button
        type="button"
        className="accordion-panel__action"
        title={collapseExpandLabel}
        aria-label={collapseExpandLabel}
        onClick={() => setAllCollapsed((value) => !value)}
      >
        <Codicon name={collapseExpandIcon} />
      </button>
      <button
        ref={menuButtonRef}
        type="button"
        className={`accordion-panel__action${menuOpen ? " accordion-panel__action--open" : ""}`}
        title="More Actions..."
        aria-label="More Actions..."
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Codicon name="ellipsis" />
      </button>
      {menuOpen ? (
        <OutlineMoreMenu
          anchorRef={menuButtonRef}
          followCursor={followCursor}
          filterOnType={filterOnType}
          sortBy={sortBy}
          onToggleFollowCursor={() => setFollowCursor((value) => !value)}
          onToggleFilterOnType={() => setFilterOnType((value) => !value)}
          onSelectSortBy={setSortBy}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}
    </>
  );
}

export default OutlineSectionActions;
