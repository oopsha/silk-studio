import type { MenuId } from "./menuId";
import type { IMenuItem, ISubmenuItem } from "./types";

type MenuEntry = IMenuItem | ISubmenuItem;

type MenuChangeListener = (menuId: MenuId) => void;

class MenuRegistryImpl {
  private readonly menus = new Map<string, MenuEntry[]>();
  private readonly listeners = new Set<MenuChangeListener>();

  appendMenuItem(menuId: MenuId, item: MenuEntry): () => void {
    const key = menuId.id;
    const entries = this.menus.get(key) ?? [];
    entries.push(item);
    this.menus.set(key, entries);
    this.fireDidChangeMenu(menuId);

    return () => {
      const current = this.menus.get(key);
      if (!current) return;
      const index = current.indexOf(item);
      if (index >= 0) {
        current.splice(index, 1);
        this.fireDidChangeMenu(menuId);
      }
    };
  }

  getMenuItems(menuId: MenuId): readonly MenuEntry[] {
    const entries = this.menus.get(menuId.id) ?? [];
    return [...entries].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  /** First menu title wins per command id (for Command Palette labels). */
  collectCommandTitles(): ReadonlyMap<string, string> {
    const titles = new Map<string, string>();
    for (const entries of this.menus.values()) {
      for (const entry of entries) {
        if (!("command" in entry)) continue;
        const id = entry.command.id;
        if (titles.has(id)) continue;
        const raw =
          typeof entry.command.title === "string"
            ? entry.command.title
            : entry.command.title.value;
        titles.set(id, raw.replace(/\u2026$/, "").replace(/\.\.\.$/, "").trim());
      }
    }
    return titles;
  }

  onDidChangeMenu(listener: MenuChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChangeMenu(menuId: MenuId): void {
    for (const listener of this.listeners) {
      listener(menuId);
    }
  }
}

export const MenuRegistry = new MenuRegistryImpl();
