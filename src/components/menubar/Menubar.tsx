import { useCallback, useEffect, useRef, useState } from "react";
import {
  MenuService,
  type ResolvedMenuSubmenu,
} from "../../platform/actions/menuService";
import { CommandService } from "../../platform/commands/commandService";
import MenuDropdown from "./MenuDropdown";
import "./Menubar.css";

type MenubarProps = {
  onMenuOpenChange?: (open: boolean) => void;
};

function Menubar({ onMenuOpenChange }: MenubarProps) {
  const [menus, setMenus] = useState<ResolvedMenuSubmenu[]>(() =>
    MenuService.getTopLevelMenus(),
  );
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

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

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenuId(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenuId]);

  const handleSelect = useCallback(async (commandId: string) => {
    setOpenMenuId(null);
    await CommandService.executeCommand(commandId);
  }, []);

  const handleMenuMouseEnter = useCallback(
    (menuId: string) => {
      setOpenMenuId((current) => {
        if (current !== null && current !== menuId) {
          return menuId;
        }
        return current;
      });
    },
    [],
  );

  return (
    <div ref={rootRef} className="menubar" role="menubar">
      {menus.map((menu) => {
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
              onClick={() =>
                setOpenMenuId((current) =>
                  current === menu.menuId.id ? null : menu.menuId.id,
                )
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
    </div>
  );
}

export default Menubar;
