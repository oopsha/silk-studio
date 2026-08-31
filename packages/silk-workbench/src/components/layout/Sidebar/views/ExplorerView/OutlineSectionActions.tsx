import { useEffect, useRef, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { OutlineViewState } from "../../../../../services/outline/outlineViewState";
import { useOutlineViewState } from "../../../../../services/outline/useOutlineViewState";
import OutlineMoreMenu from "../../OutlineMoreMenu/OutlineMoreMenu";

type OutlineSectionActionsProps = {
  onMenuOpenChange?: (open: boolean) => void;
};

function OutlineSectionActions({
  onMenuOpenChange,
}: OutlineSectionActionsProps) {
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { followCursor, filterOnType, sortBy } = useOutlineViewState();

  useEffect(() => {
    onMenuOpenChange?.(menuOpen);
  }, [menuOpen, onMenuOpenChange]);

  const allCollapsed = OutlineViewState.areAllCollapsed();
  const collapseExpandIcon = allCollapsed ? "expand-all" : "collapse-all";
  const collapseExpandLabel = allCollapsed ? "Expand All" : "Collapse All";

  return (
    <>
      <button
        type="button"
        className="accordion-panel__action"
        title={collapseExpandLabel}
        aria-label={collapseExpandLabel}
        onClick={() => OutlineViewState.toggleCollapseAll()}
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
          onToggleFollowCursor={() => OutlineViewState.toggleFollowCursor()}
          onToggleFilterOnType={() => OutlineViewState.toggleFilterOnType()}
          onSelectSortBy={(sort) => OutlineViewState.setSortBy(sort)}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}
    </>
  );
}

export default OutlineSectionActions;
