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
import { EditorService } from "../../../services/editor/editorServiceFacade";
import { useEnablePreviewEditors } from "../../../services/editor/useEnablePreviewEditors";
import type { TabBarCommandAdapter } from "./TabBar";
import "./TabBarMenu.css";

type MenuPosition = {
  top: number;
  left: number;
};

type TabBarMoreMenuProps = {
  anchorRef: RefObject<HTMLElement | null>;
  commands: TabBarCommandAdapter;
  onClose: () => void;
  onShowOpenEditors: () => void;
};

function TabBarMoreMenu({
  anchorRef,
  commands,
  onClose,
  onShowOpenEditors,
}: TabBarMoreMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const enablePreviewEditors = useEnablePreviewEditors();

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const menu = rootRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    let top = rect.bottom;
    let left = rect.right;

    if (menu) {
      const menuRect = menu.getBoundingClientRect();
      left = rect.right - menuRect.width;
      if (top + menuRect.height > window.innerHeight - 4) {
        top = rect.top - menuRect.height;
      }
    }

    setPosition({
      top: Math.round(top),
      left: Math.round(left),
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, enablePreviewEditors]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
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

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onClose]);

  useCloseOnAppBlur(onClose);

  async function runCommand(command: string) {
    onClose();
    await commands.executeCommand(command);
  }

  function renderCheckGutter(checked = false) {
    return (
      <span className="tab-bar-menu__check" aria-hidden>
        {checked ? <Codicon name="check" /> : null}
      </span>
    );
  }

  function renderCommandItem(
    id: string,
    label: string,
    command: string,
  ) {
    const keybinding = commands.lookupKeybinding(command);

    return (
      <button
        key={id}
        type="button"
        className="tab-bar-menu__item"
        role="menuitem"
        onClick={() => void runCommand(command)}
      >
        {renderCheckGutter()}
        <span className="tab-bar-menu__label">{label}</span>
        {keybinding ? (
          <span className="tab-bar-menu__keybinding">{keybinding}</span>
        ) : null}
      </button>
    );
  }

  return createPortal(
    <div
      ref={rootRef}
      className="tab-bar-menu"
      role="menu"
      style={
        position
          ? { top: position.top, left: position.left, position: "fixed" }
          : { visibility: "hidden", position: "fixed" }
      }
    >
      <button
        type="button"
        className="tab-bar-menu__item"
        role="menuitem"
        onClick={() => {
          onClose();
          onShowOpenEditors();
        }}
      >
        {renderCheckGutter()}
        <span className="tab-bar-menu__label">Show Opened Editors</span>
      </button>

      <div className="tab-bar-menu__separator" role="separator" />

      {renderCommandItem(
        "close-all",
        "Close All",
        "workbench.action.closeAllEditors",
      )}
      {renderCommandItem(
        "close-saved",
        "Close Saved",
        "workbench.action.closeAllSavedEditors",
      )}

      <div className="tab-bar-menu__separator" role="separator" />

      <button
        type="button"
        className={`tab-bar-menu__item${enablePreviewEditors ? " tab-bar-menu__item--checked" : ""}`}
        role="menuitemcheckbox"
        aria-checked={enablePreviewEditors}
        onClick={() => {
          EditorService.toggleEnablePreviewEditors();
        }}
      >
        {renderCheckGutter(enablePreviewEditors)}
        <span className="tab-bar-menu__label">Enable Preview Editors</span>
      </button>

      <div className="tab-bar-menu__separator" role="separator" />

      {renderCommandItem("lock-group", "Lock Group", "workbench.action.lockEditorGroup")}

      <div className="tab-bar-menu__separator" role="separator" />

      {renderCommandItem(
        "configure-editors",
        "Configure Editors",
        "workbench.action.configureEditors",
      )}
    </div>,
    document.body,
  );
}

export default TabBarMoreMenu;
