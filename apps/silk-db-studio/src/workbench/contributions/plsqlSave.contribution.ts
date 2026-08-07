import {
  pickSavePath,
  writeTextFile,
} from "@silk-studio/editor/services/editor/editorFileIO.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { basenameFromPath } from "@silk-studio/editor/services/editor/languageFromPath.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import {
  openPlsqlSaveDialog,
  shouldUsePlsqlSave,
} from "../../services/connection/plsqlSaveService";
import { formatErrorMessage } from "../../services/formatErrorMessage";

async function saveFilesystemEditor(saveAs = false): Promise<void> {
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
    const message = formatErrorMessage(
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

async function saveActiveEditor(): Promise<void> {
  const active = EditorService.getActiveTab();
  if (!active) return;

  if (shouldUsePlsqlSave(active.uri)) {
    try {
      await openPlsqlSaveDialog(active.id);
    } catch (error) {
      window.alert(
        formatErrorMessage(error, "Failed to prepare PL/SQL save."),
      );
    }
    return;
  }

  await saveFilesystemEditor(false);
}

async function saveAllEditors(): Promise<void> {
  let saved = 0;
  let failed = 0;

  for (const tab of EditorService.getTabs()) {
    if (!tab.isDirty) continue;

    if (shouldUsePlsqlSave(tab.uri)) {
      EditorService.setActiveTab(tab.id);
      try {
        await openPlsqlSaveDialog(tab.id);
      } catch (error) {
        failed += 1;
        window.alert(
          formatErrorMessage(error, "Failed to prepare PL/SQL save."),
        );
      }
      continue;
    }

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

CommandsRegistry.registerCommand("silk.file.save", async () => {
  await saveActiveEditor();
});

CommandsRegistry.registerCommand("silk.file.saveAs", async () => {
  const active = EditorService.getActiveTab();
  if (active && shouldUsePlsqlSave(active.uri)) {
    window.alert(
      "Save As is not supported for PL/SQL database objects. Use Save (Ctrl+S) to apply CREATE OR REPLACE.",
    );
    return;
  }
  await saveFilesystemEditor(true);
});

CommandsRegistry.registerCommand("silk.file.saveAll", async () => {
  await saveAllEditors();
});
