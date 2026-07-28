import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useCloseOnAppBlur } from "@silk-studio/ui/hooks/useCloseOnAppBlur.ts";
import type { ExplorerMenuItem } from "../../services/connection/explorerObjectActions";
import "./ExplorerContextMenu.css";

type MenuPosition = {
  top: number;
  left: number;
};

type ExplorerContextMenuProps = {
  anchor: MenuPosition;
  items: ExplorerMenuItem[];
  onSelect: (item: ExplorerMenuItem) => void;
  onClose: () => void;
};

function ExplorerContextMenu({
  anchor,
  items,
  onSelect,
  onClose,
}: ExplorerContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const updatePosition = useCallback(() => {
    const menu = rootRef.current;
    if (!menu) {
      setPosition(anchor);
      return;
    }

    const menuRect = menu.getBoundingClientRect();
    const padding = 4;
    let top = anchor.top;
    let left = anchor.left;

    if (left + menuRect.width > window.innerWidth - padding) {
      left = window.innerWidth - menuRect.width - padding;
    }
    if (top + menuRect.height > window.innerHeight - padding) {
      top = Math.max(padding, anchor.top - menuRect.height);
    }

    setPosition({
      top: Math.max(padding, Math.round(top)),
      left: Math.max(padding, Math.round(left)),
    });
  }, [anchor]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition]);

  useCloseOnAppBlur(onClose);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={rootRef}
      className="explorer-context-menu"
      role="menu"
      style={
        position
          ? { top: position.top, left: position.left }
          : { top: -9999, left: -9999, visibility: "hidden" }
      }
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.separator ? (
            <div
              className="explorer-context-menu__separator"
              role="separator"
              aria-hidden
            />
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={`explorer-context-menu__item${
              item.enabled ? "" : " explorer-context-menu__item--disabled"
            }${item.dangerous ? " explorer-context-menu__item--dangerous" : ""}`}
            disabled={!item.enabled}
            title={!item.enabled ? item.stubMessage : undefined}
            onClick={() => {
              if (!item.enabled) return;
              onSelect(item);
              onClose();
            }}
          >
            <span className="explorer-context-menu__label">{item.label}</span>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export default ExplorerContextMenu;
