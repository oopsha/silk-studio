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
      case "silk.query.cancel":
        return "canCancelQuery";
      case "silk.connection.commit":
      case "silk.connection.rollback":
        return "hasPendingTransaction";
      case "silk.connection.connect":
        return "canConnect";
      case "silk.connection.disconnect":
        return "canDisconnect";
      case "silk.connection.disconnectAll":
        return "hasConnectedProfiles";
      // Run menu — Silk-specific, no VS Code equivalent. Judgment calls, kept consistent
      // with the positive-existence style used for Save/Find above (default disabled
      // absent evidence of a target to act on).
      case "silk.query.execute":
      case "silk.query.executeScript":
      case "silk.query.explain":
      case "silk.query.addFavoriteFromEditor":
        return "activeEditorAvailable";
      case "silk.plsql.compile":
      case "silk.plsql.snapshot.history":
      case "silk.plsql.snapshot.take":
      case "silk.plsql.reloadFromDb":
        return "isPlsqlTab";
      case "silk.query.clearHistory":
        return "hasQueryHistory";
      case "silk.queryResult.copySelection":
      case "silk.queryResult.copyRows":
      case "silk.queryResult.copyAll":
      case "silk.queryResult.exportCsv":
      case "silk.queryResult.clearFilters":
      case "silk.queryResult.saveColumnLayout":
      case "silk.queryResult.resetColumnLayout":
        return "hasQueryResultGrid";
      // VS Code (src/vs/workbench/contrib/files/browser/fileActions.contribution.ts):
      // Save/Save As only require an active editor — they aren't gated on dirty state.
      case "silk.file.save":
      case "silk.file.saveAs":
        return "activeEditorAvailable";
      // Save All *is* gated on dirty state there (DirtyWorkingCopiesContext).
      case "silk.file.saveAll":
        return "hasDirtyFiles";
      // VS Code (editor/contrib/find/browser/findController.ts): Find/Replace require
      // editor focus or an open editor.
      case "silk.edit.find":
      case "silk.edit.replace":
        return "activeEditorAvailable";
      // VS Code (comment.ts, formatActions.ts, linesOperations.ts) gates comment toggles,
      // Format Document/Selection, and the line-mutating Selection commands (copy/move
      // line, duplicate selection) on `EditorContextKeys.writable`. That key is defined as
      // `readOnly.toNegated()` (editorContextKeys.ts:46) — a NOT, not a positive existence
      // check — so with no editor open, `readOnly` is unset/false and `writable` evaluates
      // to *true*. That's why VS Code shows every one of these enabled on its own Welcome
      // page: absence of an editor isn't evidence of being read-only. Silk has no read-only
      // editor concept yet, so the accurate equivalent is simply "never gate" — matching
      // `activeEditorAvailable` here would flip the default the wrong way (false instead of
      // true) and grey these out exactly when VS Code wouldn't.
      // VS Code (editor/contrib/multicursor, smartSelect, editorExtensions.ts): selectAll,
      // expand/shrink selection, and every multi-cursor command register
      // `precondition: undefined` — always enabled, even with no editor open. Intentionally
      // NOT gated here to match.
      default:
        return undefined;
    }
  }
}

export const MenuService = new MenuServiceImpl();

export { MenuId };
