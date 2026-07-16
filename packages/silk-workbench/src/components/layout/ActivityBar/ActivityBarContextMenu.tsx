import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useCloseOnAppBlur } from "@silk-studio/ui/hooks/useCloseOnAppBlur.ts";
import { CommandService } from "../../../platform/commands/commandService";
import {
  MenuService,
  type ResolvedMenuAction,
  type ResolvedMenuEntry,
  type ResolvedMenuGroup,
  type ResolvedMenuSubmenu,
} from "../../../platform/actions/menuService";
import type { MenuId } from "../../../platform/actions/menuId";
import "./ActivityBarContextMenu.css";

type MenuPosition = {
  top: number;
  left: number;
};

function getMenuMaxBottom(): number {
  const statusBarHeight = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue(
      "--status-bar-height",
    ) || "22",
    10,
  );
  return window.innerHeight - statusBarHeight - 4;
}

function clampMenuTop(anchorRect: DOMRect, menuHeight: number): number {
  const padding = 4;
  const maxBottom = getMenuMaxBottom();
  let top = anchorRect.bottom - menuHeight;

  top = Math.max(padding, top);
  top = Math.min(top, maxBottom - menuHeight);

  return Math.round(top);
}

function shouldFlipSubmenu(hostRect: DOMRect, submenuHeight: number): boolean {
  return hostRect.top + submenuHeight > getMenuMaxBottom();
}

type ActivityBarContextMenuProps = {
  menuId: MenuId;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
};

function sortGroupItems(items: ResolvedMenuEntry[]): ResolvedMenuEntry[] {
  return [...items].sort((a, b) => a.order - b.order);
}

function ActivityBarContextMenu({
  menuId,
  anchorRef,
  onClose,
}: ActivityBarContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [submenuFlipUp, setSubmenuFlipUp] = useState(false);
  const submenuHostRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);

  const groups = MenuService.getMenuActions(menuId);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const menu = rootRef.current;
    if (!anchor || !menu) return;

    const rect = anchor.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;
    if (menuHeight <= 0) return;

    const nextPosition = {
      top: clampMenuTop(rect, menuHeight),
      left: Math.round(rect.right),
    };

    setPosition((current) => {
      if (
        current?.top === nextPosition.top &&
        current?.left === nextPosition.left
      ) {
        return current;
      }
      return nextPosition;
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    setPosition(null);
    setActiveSubmenuId(null);
    setFocusedItemId(null);
    setSubmenuFlipUp(false);
  }, [menuId.id]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, menuId.id, groups.length]);

  useLayoutEffect(() => {
    if (!activeSubmenuId || !submenuHostRef.current || !submenuRef.current) {
      setSubmenuFlipUp((current) => (current ? false : current));
      return;
    }

    const hostRect = submenuHostRef.current.getBoundingClientRect();
    const submenuHeight = submenuRef.current.offsetHeight;
    const nextFlipUp = shouldFlipSubmenu(hostRect, submenuHeight);
    setSubmenuFlipUp((current) => (current === nextFlipUp ? current : nextFlipUp));
  }, [activeSubmenuId]);

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

  const handleSelect = useCallback(
    async (commandId: string) => {
      onClose();
      await CommandService.executeCommand(commandId);
    },
    [onClose],
  );

  function renderCommandItem(action: ResolvedMenuAction) {
    const isFocused = focusedItemId === action.id;

    return (
      <button
        key={action.id}
        type="button"
        className={`activity-bar-context-menu__item${isFocused ? " activity-bar-context-menu__item--focused" : ""}${action.enabled ? "" : " activity-bar-context-menu__item--disabled"}`}
        role="menuitem"
        disabled={!action.enabled}
        onMouseEnter={() => {
          setActiveSubmenuId(null);
          setFocusedItemId(action.id);
        }}
        onClick={() => {
          if (action.enabled) {
            void handleSelect(action.id);
          }
        }}
      >
        <span className="activity-bar-context-menu__label">{action.label}</span>
        {action.keybinding ? (
          <span className="activity-bar-context-menu__keybinding">
            {action.keybinding}
          </span>
        ) : null}
      </button>
    );
  }

  function renderSubmenuItem(item: ResolvedMenuSubmenu) {
    const isActive = activeSubmenuId === item.menuId.id;
    const submenuGroups = MenuService.getMenuActions(item.menuId);

    return (
      <div
        key={item.menuId.id}
        ref={isActive ? submenuHostRef : undefined}
        className="activity-bar-context-menu__submenu-host"
        onMouseEnter={() => {
          setActiveSubmenuId(item.menuId.id);
          setFocusedItemId(null);
        }}
      >
        <button
          type="button"
          className={`activity-bar-context-menu__item activity-bar-context-menu__item--submenu${isActive ? " activity-bar-context-menu__item--focused" : ""}`}
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={isActive}
        >
          <span className="activity-bar-context-menu__label">{item.label}</span>
          <span className="activity-bar-context-menu__submenu-indicator" aria-hidden>
            <Codicon name="chevron-right" />
          </span>
        </button>
        {isActive ? (
          <div
            ref={submenuRef}
            className={`activity-bar-context-menu__submenu${submenuFlipUp ? " activity-bar-context-menu__submenu--flip-up" : ""}`}
          >
            {renderGroups(submenuGroups)}
          </div>
        ) : null}
      </div>
    );
  }

  function renderGroups(menuGroups: ResolvedMenuGroup[]) {
    return menuGroups.map((group, groupIndex) => {
      const items = sortGroupItems(group.items);

      return (
        <div key={group.group || groupIndex}>
          {groupIndex > 0 ? (
            <div className="activity-bar-context-menu__separator" role="separator" />
          ) : null}
          {items.map((item) =>
            item.type === "submenu"
              ? renderSubmenuItem(item)
              : renderCommandItem(item),
          )}
        </div>
      );
    });
  }

  const isPositioned = position !== null;

  return createPortal(
    <div
      ref={rootRef}
      className={`activity-bar-context-menu${isPositioned ? "" : " activity-bar-context-menu--measure"}`}
      style={
        isPositioned
          ? {
              top: `${position.top}px`,
              left: `${position.left}px`,
            }
          : undefined
      }
      role="menu"
      aria-hidden={!isPositioned}
      onMouseLeave={() => {
        setActiveSubmenuId(null);
        setFocusedItemId(null);
      }}
    >
      {renderGroups(groups)}
    </div>,
    document.body,
  );
}

export default ActivityBarContextMenu;
