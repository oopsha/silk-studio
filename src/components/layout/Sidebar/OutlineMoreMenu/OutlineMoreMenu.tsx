import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import Codicon from "../../../icons/Codicon";
import { useCloseOnAppBlur } from "../../../../hooks/useCloseOnAppBlur";
import "../ViewsVisibilityMenu/ViewsVisibilityMenu.css";

export type OutlineSortOrder = "position" | "name" | "category";

type MenuPosition = {
  top: number;
  left: number;
};

type OutlineMoreMenuProps = {
  anchorRef: RefObject<HTMLElement | null>;
  followCursor: boolean;
  filterOnType: boolean;
  sortBy: OutlineSortOrder;
  onToggleFollowCursor: () => void;
  onToggleFilterOnType: () => void;
  onSelectSortBy: (sort: OutlineSortOrder) => void;
  onClose: () => void;
};

function OutlineMoreMenu({
  anchorRef,
  followCursor,
  filterOnType,
  sortBy,
  onToggleFollowCursor,
  onToggleFilterOnType,
  onSelectSortBy,
  onClose,
}: OutlineMoreMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    setPosition({
      top: Math.round(rect.bottom),
      left: Math.round(rect.left),
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition]);

  useEffect(() => {
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [updatePosition]);

  useEffect(() => {
    function handleScroll() {
      onClose();
    }

    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [onClose]);

  useEffect(() => {
    let listening = false;

    function handlePointerDown(event: PointerEvent) {
      if (!listening) return;
      const target = event.target as Node;
      if (
        rootRef.current?.contains(target) ||
        anchorRef.current?.contains(target)
      ) {
        return;
      }
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const frameId = requestAnimationFrame(() => {
      listening = true;
    });

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onClose]);

  useCloseOnAppBlur(onClose);

  if (position === null) {
    return null;
  }

  const sortItems: { id: OutlineSortOrder; label: string }[] = [
    { id: "position", label: "Sort By: Position" },
    { id: "name", label: "Sort By: Name" },
    { id: "category", label: "Sort By: Category" },
  ];

  return createPortal(
    <div
      ref={rootRef}
      className="views-visibility-menu"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      role="menu"
    >
      <button
        type="button"
        className={`views-visibility-menu__item${followCursor ? " views-visibility-menu__item--checked" : ""}`}
        role="menuitemcheckbox"
        aria-checked={followCursor}
        onClick={onToggleFollowCursor}
      >
        <span className="views-visibility-menu__check" aria-hidden>
          {followCursor ? <Codicon name="check" /> : null}
        </span>
        <span className="views-visibility-menu__label">Follow Cursor</span>
      </button>
      <button
        type="button"
        className={`views-visibility-menu__item${filterOnType ? " views-visibility-menu__item--checked" : ""}`}
        role="menuitemcheckbox"
        aria-checked={filterOnType}
        onClick={onToggleFilterOnType}
      >
        <span className="views-visibility-menu__check" aria-hidden>
          {filterOnType ? <Codicon name="check" /> : null}
        </span>
        <span className="views-visibility-menu__label">Filter on Type</span>
      </button>
      <div className="views-visibility-menu__separator" role="separator" />
      {sortItems.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`views-visibility-menu__item${sortBy === item.id ? " views-visibility-menu__item--checked" : ""}`}
          role="menuitemradio"
          aria-checked={sortBy === item.id}
          onClick={() => {
            onSelectSortBy(item.id);
            onClose();
          }}
        >
          <span className="views-visibility-menu__check" aria-hidden>
            {sortBy === item.id ? <Codicon name="check" /> : null}
          </span>
          <span className="views-visibility-menu__label">{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

export default OutlineMoreMenu;
