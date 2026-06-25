import { MenuId } from "./menuId";
import { MenuRegistry } from "./menuRegistry";
import { ContextKeyService } from "../context/contextKeyService";
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
  icon?: string;
  keybinding?: string;
  group: string;
  order: number;
  enabled: boolean;
};

export type ResolvedMenuSubmenu = {
  type: "submenu";
  menuId: MenuId;
  label: string;
  mnemonic?: string;
  group: string;
  order: number;
};

export type ResolvedMenuEntry = ResolvedMenuAction | ResolvedMenuSubmenu;

export type ResolvedMenuGroup = {
  group: string;
  items: ResolvedMenuEntry[];
};

export type ResolvedToolbarEntry = ResolvedMenuAction | ResolvedMenuSubmenu;

class MenuServiceImpl {
  getMenuActions(menuId: MenuId): ResolvedMenuGroup[] {
    const entries = MenuRegistry.getMenuItems(menuId);
    const groups = new Map<string, ResolvedMenuEntry[]>();

    for (const entry of entries) {
      if (!this.matchesWhen(entry)) continue;

      const resolved = this.resolveEntry(entry);
      if (!resolved) continue;

      const groupName = resolved.group;
      const group = groups.get(groupName) ?? [];
      group.push(resolved);
      groups.set(groupName, group);
    }

    return [...groups.entries()].map(([group, items]) => ({ group, items }));
  }

  getToolbarActions(menuId: MenuId): ResolvedToolbarEntry[] {
    const entries = MenuRegistry.getMenuItems(menuId);
    const resolved: ResolvedToolbarEntry[] = [];

    for (const entry of entries) {
      if (!this.matchesWhen(entry)) continue;

      const item = this.resolveEntry(entry);
      if (item) {
        resolved.push(item);
      }
    }

    return resolved.sort((a, b) => a.order - b.order);
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

  private matchesWhen(entry: IMenuItem | ISubmenuItem): boolean {
    return ContextKeyService.evaluate(entry.when);
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
    const precondition = this.getCommandPrecondition(item.command.id);
    return {
      type: "command",
      id: item.command.id,
      label,
      mnemonic,
      icon: this.resolveCommandIcon(item.command),
      keybinding: KeybindingsRegistry.lookupKeybinding(item.command.id),
      group: item.group ?? "",
      order: item.order ?? 0,
      enabled: precondition ? ContextKeyService.get(precondition) : true,
    };
  }

  private resolveCommandIcon(command: IMenuItem["command"]): string | undefined {
    const toggled = command.toggled;
    if (toggled?.icon && toggled.condition && ContextKeyService.get(toggled.condition)) {
      return toggled.icon;
    }
    return command.icon;
  }

  private resolveSubmenuItem(item: ISubmenuItem): ResolvedMenuSubmenu {
    const { label, mnemonic } = resolveMenuLabel(item.title);
    return {
      type: "submenu",
      menuId: item.submenu,
      label,
      mnemonic,
      group: item.group ?? "",
      order: item.order ?? 0,
    };
  }

  private getCommandPrecondition(commandId: string): string | undefined {
    switch (commandId) {
      case "workbench.action.navigateBack":
        return "canNavigateBack";
      case "workbench.action.navigateForward":
        return "canNavigateForward";
      default:
        return undefined;
    }
  }
}

export const MenuService = new MenuServiceImpl();

export { MenuId };
