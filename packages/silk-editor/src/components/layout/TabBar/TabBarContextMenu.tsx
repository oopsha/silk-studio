import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useCloseOnAppBlur } from "@silk-studio/ui/hooks/useCloseOnAppBlur.ts";
import { EditorService } from "../../../services/editor/editorServiceFacade";
import type { TabBarCommandAdapter } from "./TabBar";
import "./TabBarMenu.css";

type MenuPosition = {
  top: number;
  left: number;
};

type TabBarContextMenuProps = {
  tabId: string;
  anchor: MenuPosition;
  commands: TabBarCommandAdapter;
  onClose: () => void;
};

type MenuItem = {
  id: string;
  label: string;
  command: string;
  when?: () => boolean;
};

function TabBarContextMenu({
  tabId,
  anchor,
  commands,
  onClose,
}: TabBarContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const tab = EditorService.getTabs().find((entry) => entry.id === tabId);

  const items: MenuItem[] = [
    {
      id: "close",
      label: "Close",
      command: "workbench.action.closeActiveEditor",
    },
    {
      id: "close-others",
      label: "Close Others",
      command: "workbench.action.closeOtherEditors",
    },
    {
      id: "close-right",
      label: "Close to the Right",
      command: "workbench.action.closeEditorsToTheRight",
    },
    {
      id: "close-all",
      label: "Close All",
      command: "workbench.action.closeAllEditors",
    },
    {
      id: "pin",
      label: "Keep Open",
      command: "workbench.action.pinEditor",
      when: () => Boolean(tab?.isPreview),
    },
  ];

  const visibleItems = items.filter((item) => item.when?.() ?? true);

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
      top = anchor.top - menuRect.height;
    }

    setPosition({
      top: Math.max(padding, Math.round(top)),
      left: Math.max(padding, Math.round(left)),
    });
  }, [anchor]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition]);

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

  useCloseOnAppBlur(onClose);

  async function runCommand(command: string) {
    onClose();
    await commands.executeCommand(command);
  }

  function renderCheckGutter() {
    return <span className="tab-bar-menu__check" aria-hidden />;
  }

  return createPortal(
    <div
      ref={rootRef}
      className="tab-bar-menu"
      role="menu"
      style={
        position
          ? { top: position.top, left: position.left, position: "fixed" }
          : { top: anchor.top, left: anchor.left, position: "fixed", visibility: "hidden" }
      }
    >
      {visibleItems.map((item, index) => {
        const keybinding = commands.lookupKeybinding(item.command);
        const showSeparator =
          item.id === "close-all" && index > 0 && visibleItems[index - 1]?.id !== "close-all";

        return (
          <div key={item.id}>
            {showSeparator ? <div className="tab-bar-menu__separator" /> : null}
            <button
              type="button"
              className="tab-bar-menu__item"
              role="menuitem"
              onClick={() => void runCommand(item.command)}
            >
              {renderCheckGutter()}
              <span className="tab-bar-menu__label">{item.label}</span>
              {keybinding ? (
                <span className="tab-bar-menu__keybinding">{keybinding}</span>
              ) : null}
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

export default TabBarContextMenu;
