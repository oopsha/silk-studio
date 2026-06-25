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
import "./ViewsVisibilityMenu.css";

export type ViewsVisibilityItem = {
  id: string;
  label: string;
  visible: boolean;
  canToggle: boolean;
};

type MenuPosition = {
  top: number;
  left: number;
};

type ViewsVisibilityMenuProps = {
  items: ViewsVisibilityItem[];
  anchorRef: RefObject<HTMLElement | null>;
  onToggle: (id: string) => void;
  onClose: () => void;
};

function ViewsVisibilityMenu({
  items,
  anchorRef,
  onToggle,
  onClose,
}: ViewsVisibilityMenuProps) {
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
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`views-visibility-menu__item${item.canToggle ? "" : " views-visibility-menu__item--disabled"}${item.visible ? " views-visibility-menu__item--checked" : ""}`}
          role="menuitemcheckbox"
          aria-checked={item.visible}
          aria-disabled={!item.canToggle}
          disabled={!item.canToggle}
          onClick={() => {
            if (item.canToggle) {
              onToggle(item.id);
              onClose();
            }
          }}
        >
          <span className="views-visibility-menu__check" aria-hidden>
            {item.visible ? <Codicon name="check" /> : null}
          </span>
          <span className="views-visibility-menu__label">{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

export default ViewsVisibilityMenu;
