import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useCloseOnAppBlur } from "../../../../hooks/useCloseOnAppBlur";
import "../ViewsVisibilityMenu/ViewsVisibilityMenu.css";

type MenuPosition = {
  top: number;
  left: number;
};

type TimelineMoreMenuProps = {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
};

function TimelineMoreMenu({ anchorRef, onClose }: TimelineMoreMenuProps) {
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
      <button type="button" className="views-visibility-menu__item" role="menuitem">
        <span className="views-visibility-menu__check" aria-hidden />
        <span className="views-visibility-menu__label">
          Local History: Find Entry to Restore...
        </span>
      </button>
    </div>,
    document.body,
  );
}

export default TimelineMoreMenu;
