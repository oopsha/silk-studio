import { useEffect, useRef, useState } from "react";
import Codicon from "../../../../icons/Codicon";
import TimelineMoreMenu from "../../TimelineMoreMenu/TimelineMoreMenu";

type TimelineSectionActionsProps = {
  onMenuOpenChange?: (open: boolean) => void;
};

function TimelineSectionActions({
  onMenuOpenChange,
}: TimelineSectionActionsProps) {
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    onMenuOpenChange?.(menuOpen);
  }, [menuOpen, onMenuOpenChange]);

  const pinLabel = pinned
    ? "Unpin the Current Timeline"
    : "Pin the Current Timeline";

  return (
    <>
      <button
        type="button"
        className="accordion-panel__action"
        title={pinLabel}
        aria-label={pinLabel}
        onClick={() => setPinned((value) => !value)}
      >
        <Codicon name={pinned ? "pinned" : "pin"} />
      </button>
      <button
        type="button"
        className="accordion-panel__action"
        title="Refresh"
        aria-label="Refresh"
      >
        <Codicon name="refresh" />
      </button>
      <button
        type="button"
        className="accordion-panel__action"
        title="Filter Timeline"
        aria-label="Filter Timeline"
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
