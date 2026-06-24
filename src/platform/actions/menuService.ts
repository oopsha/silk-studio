import { MenuId } from "./menuId";
import { MenuRegistry } from "./menuRegistry";
import {
  isMenuItem,
  isSubmenuItem,
  resolveMenuLabel,
  type IMenuItem,
  type ISubmenuItem,
} from "./types";
import { KeybindingsRegistry } from "../keybinding/keybindingRegistry";

export type ResolvedMenuAction = {
  type: "command";
  id: string;
  label: string;
  mnemonic?: string;
  keybinding?: string;
  group: string;
};

export type ResolvedMenuSubmenu = {
  type: "submenu";
  menuId: MenuId;
  label: string;
  mnemonic?: string;
  group: string;
};

export type ResolvedMenuEntry = ResolvedMenuAction | ResolvedMenuSubmenu;

export type ResolvedMenuGroup = {
  group: string;
  items: ResolvedMenuEntry[];
};

class MenuServiceImpl {
  getMenuActions(menuId: MenuId): ResolvedMenuGroup[] {
    const entries = MenuRegistry.getMenuItems(menuId);
    const groups = new Map<string, ResolvedMenuEntry[]>();

    for (const entry of entries) {
      const resolved = this.resolveEntry(entry);
      if (!resolved) continue;

      const groupName = resolved.group;
      const group = groups.get(groupName) ?? [];
      group.push(resolved);
      groups.set(groupName, group);
    }

    return [...groups.entries()].map(([group, items]) => ({ group, items }));
  }

  getTopLevelMenus(): ResolvedMenuSubmenu[] {
    const groups = this.getMenuActions(MenuId.MenubarMainMenu);
    return groups.flatMap((g) =>
      g.items.filter(
        (item): item is ResolvedMenuSubmenu => item.type === "submenu",
      ),
    );
  }

  onDidChangeMenu(listener: (menuId: MenuId) => void): () => void {
    return MenuRegistry.onDidChangeMenu(listener);
  }

  private resolveEntry(
    entry: IMenuItem | ISubmenuItem,
  ): ResolvedMenuEntry | undefined {
    if (isMenuItem(entry)) {
      return this.resolveCommandItem(entry);
    }
    if (isSubmenuItem(entry)) {
      return this.resolveSubmenuItem(entry);
    }
    return undefined;
  }

  private resolveCommandItem(item: IMenuItem): ResolvedMenuAction {
    const { label, mnemonic } = resolveMenuLabel(item.command.title);
    return {
      type: "command",
      id: item.command.id,
      label,
      mnemonic,
      keybinding: KeybindingsRegistry.lookupKeybinding(item.command.id),
      group: item.group ?? "",
    };
  }

  private resolveSubmenuItem(item: ISubmenuItem): ResolvedMenuSubmenu {
    const { label, mnemonic } = resolveMenuLabel(item.title);
    return {
      type: "submenu",
      menuId: item.submenu,
      label,
      mnemonic,
      group: item.group ?? "",
    };
  }
}

export const MenuService = new MenuServiceImpl();

export { MenuId };
