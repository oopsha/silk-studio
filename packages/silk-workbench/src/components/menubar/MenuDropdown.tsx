import { useState } from "react";
import type {
  ResolvedMenuAction,
  ResolvedMenuGroup,
} from "../../platform/actions/menuService";
import "./MenuDropdown.css";

type MenuDropdownProps = {
  groups: ResolvedMenuGroup[];
  onSelect: (commandId: string) => void;
};

function MenuDropdown({ groups, onSelect }: MenuDropdownProps) {
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  return (
    <div
      className="menu-dropdown"
      role="menu"
      onMouseLeave={() => setFocusedItemId(null)}
    >
      {groups.map((group, groupIndex) => (
        <div key={group.group || groupIndex} className="menu-dropdown__group">
          {groupIndex > 0 ? <div className="menu-dropdown__separator" /> : null}
          {group.items.map((item) => {
            if (item.type !== "command") return null;
            const action = item as ResolvedMenuAction;
            const isFocused = focusedItemId === action.id;

            return (
              <button
                key={action.id}
                type="button"
                className={`menu-dropdown__item${isFocused ? " menu-dropdown__item--focused" : ""}${action.enabled ? "" : " menu-dropdown__item--disabled"}`}
                role="menuitem"
                aria-disabled={!action.enabled}
                disabled={!action.enabled}
                onMouseEnter={() =>
                  action.enabled ? setFocusedItemId(action.id) : undefined
                }
                onClick={() => {
                  if (!action.enabled) return;
                  onSelect(action.id);
                }}
              >
                <span className="menu-dropdown__label">{action.label}</span>
                {action.keybinding ? (
                  <span className="menu-dropdown__keybinding">
                    {action.keybinding}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default MenuDropdown;
