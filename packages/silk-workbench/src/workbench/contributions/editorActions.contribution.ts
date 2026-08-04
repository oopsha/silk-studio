import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import {
  pickAndReadTextFile,
  pickSavePath,
  writeTextFile,
} from "@silk-studio/editor/services/editor/editorFileIO.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { TabBarActionService } from "@silk-studio/editor/services/editor/tabBarActionService.ts";
import { basenameFromPath } from "@silk-studio/editor/services/editor/languageFromPath.ts";
import { tKey } from "../../platform/i18n/activeLocale";
import { AppNotificationService } from "../../services/notifications/appNotificationService";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message.trim() || fallback;
  }
  if (typeof error === "string") {
    return error.trim() || fallback;
  }
  return fallback;
}

async function saveActiveEditor(saveAs = false): Promise<void> {
  const active = EditorService.getActiveTab();
  if (!active) return;

  let path = active.uri;
  if (!path || saveAs) {
    path = (await pickSavePath(active.uri)) ?? undefined;
    if (!path) return;
  }

  try {
    await writeTextFile(path, active.content);
    EditorService.markTabSaved(active.id, path, basenameFromPath(path));
    AppNotificationService.show(tKey("workbench.file.saved"), "success");
  } catch (error) {
    const message = errorMessage(
      error,
      tKey("workbench.file.saveFailedFallback"),
    );
    console.warn("[silk.file.save] failed", error);
    AppNotificationService.show(
      tKey("workbench.file.saveFailed").replace("{message}", message),
      "error",
    );
  }
}

async function saveAllEditors(): Promise<void> {
  let saved = 0;
  let failed = 0;

  for (const tab of EditorService.getTabs()) {
    if (!tab.isDirty) continue;

    try {
      if (tab.uri) {
        await writeTextFile(tab.uri, tab.content);
        EditorService.markTabSaved(tab.id, tab.uri, tab.label);
        saved += 1;
        continue;
      }

      const path = await pickSavePath();
      if (!path) continue;
      await writeTextFile(path, tab.content);
      EditorService.markTabSaved(tab.id, path, basenameFromPath(path));
      saved += 1;
    } catch (error) {
      failed += 1;
      console.warn("[silk.file.saveAll] failed", tab.label, error);
    }
  }

  if (failed > 0) {
    AppNotificationService.show(
      tKey("workbench.file.saveAllFailed")
        .replace("{saved}", String(saved))
        .replace("{failed}", String(failed)),
      "error",
    );
  } else if (saved > 0) {
    AppNotificationService.show(tKey("workbench.file.saved"), "success");
  }
}

CommandsRegistry.registerCommand("workbench.action.closeActiveEditor", () => {
  EditorService.closeActiveTab();
});

CommandsRegistry.registerCommand("workbench.action.closeAllEditors", () => {
  EditorService.closeAllTabs();
});

CommandsRegistry.registerCommand("workbench.action.closeAllSavedEditors", () => {
  EditorService.closeSavedTabs();
});

CommandsRegistry.registerCommand("workbench.action.showAllEditors", () => {
  TabBarActionService.requestShowOpenEditors();
});

CommandsRegistry.registerCommand("workbench.action.togglePreviewEditors", () => {
  EditorService.toggleEnablePreviewEditors();
});

CommandsRegistry.registerCommand("workbench.action.lockEditorGroup", () => {
  console.log("[command] workbench.action.lockEditorGroup");
});

CommandsRegistry.registerCommand("workbench.action.splitEditorRight", () => {
  console.log("[command] workbench.action.splitEditorRight");
});

CommandsRegistry.registerCommand(
  "workbench.action.closeOtherEditors",
  () => {
    const active = EditorService.getActiveTab();
    if (active) {
      EditorService.closeOtherTabs(active.id);
    }
  },
);

CommandsRegistry.registerCommand(
  "workbench.action.closeEditorsToTheRight",
  () => {
    const active = EditorService.getActiveTab();
    if (active) {
      EditorService.closeTabsToRight(active.id);
    }
  },
);

CommandsRegistry.registerCommand("workbench.action.nextEditor", () => {
  EditorService.focusNextTab();
});

CommandsRegistry.registerCommand("workbench.action.previousEditor", () => {
  EditorService.focusPreviousTab();
});

CommandsRegistry.registerCommand("workbench.action.pinEditor", () => {
  const active = EditorService.getActiveTab();
  if (active) {
    EditorService.pinTab(active.id);
  }
});

CommandsRegistry.registerCommand("silk.file.newTextFile", () => {
  EditorService.openUntitled();
});

CommandsRegistry.registerCommand("silk.file.openFile", async () => {
  const picked = await pickAndReadTextFile();
  if (!picked) return;
  EditorService.openFile(picked.path, picked.content);
});

CommandsRegistry.registerCommand("silk.file.save", async () => {
  await saveActiveEditor(false);
});

CommandsRegistry.registerCommand("silk.file.saveAs", async () => {
  await saveActiveEditor(true);
});

CommandsRegistry.registerCommand("silk.file.saveAll", async () => {
  await saveAllEditors();
});

CommandsRegistry.registerCommand("silk.file.closeAll", () => {
  EditorService.closeAllTabs();
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
  command: {
    id: "silk.file.saveAll",
    title: "Save All",
  },
  group: "2_save",
  order: 30,
});

KeybindingsRegistry.registerKeybinding(
  "workbench.action.closeActiveEditor",
  "Ctrl+W",
);
KeybindingsRegistry.registerKeybinding(
  "workbench.action.nextEditor",
  "Ctrl+PageDown",
);
KeybindingsRegistry.registerKeybinding(
  "workbench.action.previousEditor",
  "Ctrl+PageUp",
);
KeybindingsRegistry.registerKeybinding(
  "workbench.action.nextEditor",
  "Ctrl+Tab",
);
KeybindingsRegistry.registerKeybinding(
  "workbench.action.previousEditor",
  "Ctrl+Shift+Tab",
);
KeybindingsRegistry.registerKeybinding("silk.file.newTextFile", "Ctrl+N");
KeybindingsRegistry.registerKeybinding("silk.file.openFile", "Ctrl+O");
KeybindingsRegistry.registerKeybinding("silk.file.save", "Ctrl+S");
KeybindingsRegistry.registerKeybinding("silk.file.saveAs", "Ctrl+Shift+S");
KeybindingsRegistry.registerKeybinding(
  "workbench.action.closeAllEditors",
  "Ctrl+K W",
);
KeybindingsRegistry.registerKeybinding(
  "workbench.action.closeAllSavedEditors",
  "Ctrl+K U",
);
