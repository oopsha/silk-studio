import { isTauri } from "@tauri-apps/api/core";
import {
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
  type MenuItemOptions,
  type PredefinedMenuItemOptions,
  type SubmenuOptions,
} from "@tauri-apps/api/menu";
import { detectWorkbenchPlatform } from "@silk-studio/ui/platform/fonts.ts";
import {
  MenuService,
  type ResolvedMenuEntry,
  type ResolvedMenuGroup,
} from "../../platform/actions/menuService";
import { CommandService } from "../../platform/commands/commandService";
import { ContextKeyService } from "../../platform/context/contextKeyService";

const APP_NAME = "Silk DB Studio";
const APP_VERSION = "0.1.0";
const REBUILD_DEBOUNCE_MS = 80;

type NativeMenuChild =
  | MenuItem
  | Submenu
  | PredefinedMenuItem
  | MenuItemOptions
  | SubmenuOptions
  | PredefinedMenuItemOptions;

let started = false;
let rebuildTimer: number | null = null;
let rebuildGeneration = 0;

function runCommand(commandId: string): void {
  void CommandService.executeCommand(commandId);
}

/** Convert workbench keybinding labels (Ctrl+S) to Tauri accelerators (CmdOrCtrl+S). */
function toAccelerator(keybinding: string | undefined): string | undefined {
  if (!keybinding) return undefined;
  // Chord sequences (e.g. "Ctrl+K Ctrl+S") are not supported as menu accelerators.
  if (/\s/.test(keybinding.trim())) return undefined;

  return keybinding
    .split("+")
    .map((token) => {
      const lower = token.trim().toLowerCase();
      if (lower === "ctrl" || lower === "control" || lower === "cmd") {
        return "CmdOrCtrl";
      }
      if (lower === "shift") return "Shift";
      if (lower === "alt" || lower === "option") return "Alt";
      return token.trim();
    })
    .join("+");
}

async function buildGroupItems(
  groups: ResolvedMenuGroup[],
): Promise<NativeMenuChild[]> {
  const items: NativeMenuChild[] = [];

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    if (groupIndex > 0 && group.items.length > 0) {
      items.push(await PredefinedMenuItem.new({ item: "Separator" }));
    }

    for (const entry of group.items) {
      const child = await buildEntry(entry);
      if (child) items.push(child);
    }
  }

  return items;
}

async function buildEntry(
  entry: ResolvedMenuEntry,
): Promise<NativeMenuChild | null> {
  if (entry.type === "command") {
    return MenuItem.new({
      id: entry.id,
      text: entry.label,
      enabled: entry.enabled,
      accelerator: toAccelerator(entry.keybinding),
      action: () => runCommand(entry.id),
    });
  }

  if (entry.type === "submenu") {
    const nestedGroups = MenuService.getMenuActions(entry.menuId);
    const nestedItems = await buildGroupItems(nestedGroups);
    return Submenu.new({
      id: entry.menuId.id,
      text: entry.label,
      items: nestedItems,
    });
  }

  return null;
}

async function buildAppSubmenu(): Promise<Submenu> {
  return Submenu.new({
    text: APP_NAME,
    items: [
      await PredefinedMenuItem.new({
        item: {
          About: {
            name: APP_NAME,
            version: APP_VERSION,
          },
        },
      }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({
        id: "workbench.action.openSettings",
        text: "Settings...",
        accelerator: "CmdOrCtrl+,",
        action: () => runCommand("workbench.action.openSettings"),
      }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Services" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Hide" }),
      await PredefinedMenuItem.new({ item: "HideOthers" }),
      await PredefinedMenuItem.new({ item: "ShowAll" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Quit" }),
    ],
  });
}

async function buildNativeMenu(): Promise<Menu> {
  const topLevel = MenuService.getTopLevelMenus();
  const submenus: Submenu[] = [await buildAppSubmenu()];

  for (const top of topLevel) {
    const groups = MenuService.getMenuActions(top.menuId);
    const items = await buildGroupItems(groups);
    const submenu = await Submenu.new({
      id: top.menuId.id,
      text: top.label,
      items,
    });

    if (top.label === "Help") {
      await submenu.setAsHelpMenuForNSApp();
    }

    submenus.push(submenu);
  }

  return Menu.new({ items: submenus });
}

async function rebuildNativeMenubar(): Promise<void> {
  const generation = ++rebuildGeneration;
  try {
    const menu = await buildNativeMenu();
    if (generation !== rebuildGeneration) return;
    await menu.setAsAppMenu();
  } catch (error) {
    console.warn("[native-menubar] failed to install app menu", error);
  }
}

function scheduleRebuild(): void {
  if (rebuildTimer !== null) {
    window.clearTimeout(rebuildTimer);
  }
  rebuildTimer = window.setTimeout(() => {
    rebuildTimer = null;
    void rebuildNativeMenubar();
  }, REBUILD_DEBOUNCE_MS);
}

/**
 * Installs the macOS system menubar from MenuService (MVP).
 * No-op on non-macOS or non-Tauri hosts.
 */
export function startNativeMenubar(): () => void {
  if (started) return () => {};
  if (!isTauri() || detectWorkbenchPlatform() !== "mac") {
    return () => {};
  }

  started = true;
  void rebuildNativeMenubar();

  const disposeMenu = MenuService.onDidChangeMenu(() => scheduleRebuild());
  const disposeContext = ContextKeyService.onDidChangeContext(() =>
    scheduleRebuild(),
  );

  return () => {
    started = false;
    if (rebuildTimer !== null) {
      window.clearTimeout(rebuildTimer);
      rebuildTimer = null;
    }
    disposeMenu();
    disposeContext();
  };
}
