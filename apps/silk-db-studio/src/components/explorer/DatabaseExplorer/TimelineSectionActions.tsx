import { useEffect, useRef, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { TimelineViewState } from "@silk-studio/workbench/services/timeline/timelineViewState.ts";
import { useTimelineViewState } from "@silk-studio/workbench/services/timeline/useTimelineViewState.ts";
import TimelineMoreMenu from "@silk-studio/workbench/components/layout/Sidebar/TimelineMoreMenu/TimelineMoreMenu.tsx";

type TimelineSectionActionsProps = {
  onMenuOpenChange?: (open: boolean) => void;
};

function TimelineSectionActions({
  onMenuOpenChange,
}: TimelineSectionActionsProps) {
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pinned, manualOnly } = useTimelineViewState();

  useEffect(() => {
    onMenuOpenChange?.(menuOpen);
  }, [menuOpen, onMenuOpenChange]);

  const pinLabel = pinned
    ? "Unpin the Current Timeline"
    : "Pin the Current Timeline";
  const filterLabel = manualOnly
    ? "Showing Manual Snapshots Only"
    : "Filter Timeline";

  return (
    <>
      <button
        type="button"
        className={`accordion-panel__action${pinned ? " accordion-panel__action--open" : ""}`}
        title={pinLabel}
        aria-label={pinLabel}
        onClick={() => TimelineViewState.togglePinned()}
      >
        <Codicon name={pinned ? "pinned" : "pin"} />
      </button>
      <button
        type="button"
        className="accordion-panel__action"
        title="Refresh"
        aria-label="Refresh"
        onClick={() => TimelineViewState.refresh()}
      >
        <Codicon name="refresh" />
      </button>
      <button
        type="button"
        className={`accordion-panel__action${manualOnly ? " accordion-panel__action--open" : ""}`}
        title={filterLabel}
        aria-label={filterLabel}
        onClick={() => TimelineViewState.toggleManualOnly()}
      >
        <Codicon name="filter" />
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
        <TimelineMoreMenu
          anchorRef={menuButtonRef}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}
    </>
  );
}

export default TimelineSectionActions;
