import { useState } from "react";
import {
  MenuService,
  type ResolvedMenuSubmenu,
} from "../../platform/actions/menuService";
import MenuDropdown from "./MenuDropdown";
import "./MenubarOverflowMenu.css";

type MenubarOverflowMenuProps = {
  menus: ResolvedMenuSubmenu[];
  onSelect: (commandId: string) => void;
};

function MenubarOverflowMenu({ menus, onSelect }: MenubarOverflowMenuProps) {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  return (
    <div className="menubar-overflow" role="menu">
      {menus.map((menu) => {
        const groups = MenuService.getMenuActions(menu.menuId);
        const isActive = activeMenuId === menu.menuId.id;

        return (
          <div
            key={menu.menuId.id}
            className="menubar-overflow__item-host"
            onMouseEnter={() => setActiveMenuId(menu.menuId.id)}
          >
            <button
              type="button"
              className={`menubar-overflow__item${isActive ? " menubar-overflow__item--active" : ""}`}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isActive}
            >
              <span className="menubar-overflow__label">{menu.label}</span>
              <span className="menubar-overflow__submenu-indicator" aria-hidden>
                ›
              </span>
            </button>
            {isActive ? (
              <div className="menubar-overflow__submenu">
                <MenuDropdown groups={groups} onSelect={onSelect} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default MenubarOverflowMenu;
