import { useState } from "react";
import {
  MenuService,
  type ResolvedMenuAction,
  type ResolvedMenuGroup,
} from "../../platform/actions/menuService";
import "./MenuDropdown.css";

type MenuDropdownProps = {
  groups: ResolvedMenuGroup[];
  onSelect: (commandId: string) => void;
};

function MenuDropdown({ groups, onSelect }: MenuDropdownProps) {
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);

  return (
    <div
      className="menu-dropdown"
      role="menu"
      onMouseLeave={() => {
        setFocusedItemId(null);
        setOpenSubmenuId(null);
      }}
    >
      {groups.map((group, groupIndex) => (
        <div key={group.group || groupIndex} className="menu-dropdown__group">
          {groupIndex > 0 ? <div className="menu-dropdown__separator" /> : null}
          {group.items.map((item) => {
            if (item.type === "submenu") {
              const isOpen = openSubmenuId === item.menuId.id;
              return (
                <div
                  key={item.menuId.id}
                  className="menu-dropdown__submenu-host"
                  onMouseEnter={() => {
                    setFocusedItemId(null);
                    setOpenSubmenuId(item.menuId.id);
                  }}
                >
                  <button
                    type="button"
                    className="menu-dropdown__item menu-dropdown__submenu-trigger"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                    onClick={() => setOpenSubmenuId(isOpen ? null : item.menuId.id)}
                  >
                    <span className="menu-dropdown__label">{item.label}</span>
                    <span className="menu-dropdown__submenu-arrow" aria-hidden="true">›</span>
                  </button>
                  {isOpen ? (
                    <MenuDropdown
                      groups={MenuService.getMenuActions(item.menuId)}
                      onSelect={onSelect}
                    />
                  ) : null}
                </div>
              );
            }

            const action = item as ResolvedMenuAction;
            const isFocused = focusedItemId === action.id;

            return (
              <div
                key={action.id}
                className="menu-dropdown__item-row"
                onMouseEnter={() => {
                  setOpenSubmenuId(null);
                  setFocusedItemId(action.enabled ? action.id : null);
                }}
              >
                <button
                  type="button"
                  className={`menu-dropdown__item${isFocused ? " menu-dropdown__item--focused" : ""}${action.enabled ? "" : " menu-dropdown__item--disabled"}`}
                  role="menuitem"
                  aria-disabled={!action.enabled}
                  disabled={!action.enabled}
                  onClick={() => {
                    if (action.enabled) onSelect(action.id);
                  }}
                >
                  <span className="menu-dropdown__label">{action.label}</span>
                  {action.keybinding ? (
                    <span className="menu-dropdown__keybinding">
                      {action.keybinding}
                    </span>
                  ) : null}
                </button>
                {action.secondaryAction ? (
                  <button
                    type="button"
                    className="menu-dropdown__secondary-action"
                    role="menuitem"
                    aria-label={action.secondaryAction.label}
                    title={action.secondaryAction.label}
                    onClick={() => onSelect(action.secondaryAction!.id)}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default MenuDropdown;
