import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import {
  MenuService,
  type ResolvedMenuSubmenu,
} from "../../platform/actions/menuService";
import { CommandService } from "../../platform/commands/commandService";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useCloseOnAppBlur } from "@silk-studio/ui/hooks/useCloseOnAppBlur.ts";
import MenuDropdown from "./MenuDropdown";
import MenubarOverflowMenu from "./MenubarOverflowMenu";
import { MENUBAR_OVERFLOW_ID } from "./menubarIds";
import { useMenubarOverflow } from "./useMenubarOverflow";
import "./Menubar.css";

type MenubarProps = {
  onMenuOpenChange?: (open: boolean) => void;
  onDragRegionMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
};

function Menubar({ onMenuOpenChange, onDragRegionMouseDown }: MenubarProps) {
  const [menus, setMenus] = useState<ResolvedMenuSubmenu[]>(() =>
    MenuService.getTopLevelMenus(),
  );
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  const { visibleCount, hasOverflow } = useMenubarOverflow(
    menus,
    containerRef,
    measureRef,
  );

  const visibleMenus = menus.slice(0, visibleCount);
  const overflowMenus = menus.slice(visibleCount);

  useEffect(() => {
    return MenuService.onDidChangeMenu(() => {
      setMenus(MenuService.getTopLevelMenus());
    });
  }, []);

  useEffect(() => {
    onMenuOpenChange?.(openMenuId !== null);
  }, [openMenuId, onMenuOpenChange]);

  useEffect(() => {
    if (!openMenuId) return;

    let listening = false;

    function handlePointerDown(event: PointerEvent) {
      if (!listening) return;
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenuId(null);
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
  }, [openMenuId]);

  useCloseOnAppBlur(() => setOpenMenuId(null), openMenuId !== null);

  const handleSelect = useCallback(async (commandId: string) => {
    setOpenMenuId(null);
    await CommandService.executeCommand(commandId);
  }, []);

  const handleMenuMouseEnter = useCallback((menuId: string) => {
    setOpenMenuId((current) => (current !== null ? menuId : current));
  }, []);

  const handleMenuMouseDown = useCallback(
    (menuId: string, event: MouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      setOpenMenuId((current) => (current === menuId ? null : menuId));
    },
    [],
  );

  return (
    <div ref={containerRef} className="menubar-slot">
      <div ref={rootRef} className="menubar" role="menubar">
        <div className="menubar__visible">
          {visibleMenus.map((menu) => {
          const isOpen = openMenuId === menu.menuId.id;
          const groups = MenuService.getMenuActions(menu.menuId);

          return (
            <div key={menu.menuId.id} className="menubar__menu-host">
              <button
                type="button"
                className={`menubar__button${isOpen ? " menubar__button--open" : ""}`}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                onMouseEnter={() => handleMenuMouseEnter(menu.menuId.id)}
                onMouseDown={(event) =>
                  handleMenuMouseDown(menu.menuId.id, event)
                }
              >
                <span className="menubar__button-title">{menu.label}</span>
              </button>
              {isOpen ? (
                <MenuDropdown groups={groups} onSelect={handleSelect} />
              ) : null}
            </div>
          );
        })}

        {hasOverflow ? (
          <div className="menubar__menu-host">
            <button
              type="button"
              className={`menubar__button menubar__overflow-button${openMenuId === MENUBAR_OVERFLOW_ID ? " menubar__button--open" : ""}`}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={openMenuId === MENUBAR_OVERFLOW_ID}
              aria-label="More"
              onMouseEnter={() => handleMenuMouseEnter(MENUBAR_OVERFLOW_ID)}
              onMouseDown={(event) =>
                handleMenuMouseDown(MENUBAR_OVERFLOW_ID, event)
              }
            >
              <span className="menubar__button-title menubar__overflow-icon">
                <Codicon name="ellipsis" />
              </span>
            </button>
            {openMenuId === MENUBAR_OVERFLOW_ID ? (
              <MenubarOverflowMenu
                menus={overflowMenus}
                onSelect={handleSelect}
              />
            ) : null}
          </div>
        ) : null}
        </div>

        <div
          className="menubar__drag-tail"
          data-tauri-drag-region
          onMouseDown={onDragRegionMouseDown}
        />
      </div>

      <div ref={measureRef} className="menubar__measure" aria-hidden>
        {menus.map((menu) => (
          <button
            key={menu.menuId.id}
            type="button"
            className="menubar__button"
            data-menu-measure
            tabIndex={-1}
          >
            <span className="menubar__button-title">{menu.label}</span>
          </button>
        ))}
        <button
          type="button"
          className="menubar__button menubar__overflow-button"
          data-overflow-measure
          tabIndex={-1}
        >
          <span className="menubar__button-title menubar__overflow-icon">
            <Codicon name="ellipsis" />
          </span>
        </button>
      </div>
    </div>
  );
}

export default Menubar;
