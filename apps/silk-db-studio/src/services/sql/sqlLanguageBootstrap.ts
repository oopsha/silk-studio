import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { ConnectionService } from "../../services/connection/connectionService";
import {
  isSqlLanguageId,
  resolveActiveMonacoLanguageId,
} from "../../services/sql/sqlDialect";

function applyDialectToSqlTabs(): void {
  const languageId = resolveActiveMonacoLanguageId();
  EditorService.setDefaultUntitledLanguageId(languageId);

  for (const tab of EditorService.getTabs()) {
    if (isSqlLanguageId(tab.languageId)) {
      EditorService.setTabLanguageId(tab.id, languageId);
    }
  }
}

/**
 * Wire driver → Monaco language for untitled / .sql tabs and prefer SQL for New File.
 * Safe to call once at startup (after workbench contributions).
 */
export function bootstrapSqlLanguageBinding(): void {
  EditorService.setDefaultUntitledLanguageId(resolveActiveMonacoLanguageId());
  EditorService.configureLanguageIdResolver((_path, fromExtension) => {
    if (fromExtension === "sql" || isSqlLanguageId(fromExtension)) {
      return resolveActiveMonacoLanguageId();
    }
    return fromExtension;
  });

  CommandsRegistry.registerCommand("silk.file.newTextFile", () => {
    EditorService.openUntitled(resolveActiveMonacoLanguageId());
  });

  ConnectionService.onDidChange(() => {
    applyDialectToSqlTabs();
  });
}
