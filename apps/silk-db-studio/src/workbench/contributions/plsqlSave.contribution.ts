import {
  pickSavePath,
  writeTextFile,
} from "@silk-studio/editor/services/editor/editorFileIO.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { basenameFromPath } from "@silk-studio/editor/services/editor/languageFromPath.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
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

  await writeTextFile(path, active.content);
  EditorService.markTabSaved(active.id, path, basenameFromPath(path));
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
  for (const tab of EditorService.getTabs()) {
    if (!tab.isDirty) continue;

    if (shouldUsePlsqlSave(tab.uri)) {
      EditorService.setActiveTab(tab.id);
      try {
        await openPlsqlSaveDialog(tab.id);
      } catch (error) {
        window.alert(
          formatErrorMessage(error, "Failed to prepare PL/SQL save."),
        );
      }
      continue;
    }

    if (tab.uri) {
      await writeTextFile(tab.uri, tab.content);
      EditorService.markTabSaved(tab.id, tab.uri, tab.label);
      continue;
    }

    const path = await pickSavePath();
    if (!path) continue;
    await writeTextFile(path, tab.content);
    EditorService.markTabSaved(tab.id, path, basenameFromPath(path));
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
