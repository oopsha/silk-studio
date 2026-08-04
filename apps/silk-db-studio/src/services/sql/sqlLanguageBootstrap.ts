import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import type { EditorTab } from "@silk-studio/editor/services/editor/editorTypes.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { ConnectionService } from "../../services/connection/connectionService";
import { EditorConnectionBindingService } from "../../services/connection/editorConnectionBindingService";
import { startEditorTabConnectionDecorations } from "../../services/connection/editorTabConnectionDecorations";
import { QueryExecutionService } from "../../services/query/queryExecutionService";
import {
  isSqlLanguageId,
  monacoLanguageIdForProfile,
  resolveActiveMonacoLanguageId,
} from "../../services/sql/sqlDialect";

/** Untitled text tabs should become SQL when the studio dialect is known. */
function shouldUseSqlDialect(tab: EditorTab): boolean {
  if (isSqlLanguageId(tab.languageId)) return true;
  return !tab.uri && tab.languageId === "plaintext";
}

function monacoLanguageIdForTab(tab: EditorTab): string {
  return monacoLanguageIdForProfile(
    EditorConnectionBindingService.getBinding(tab.id).profileId,
  );
}

function applyDialectToSqlTabs(): void {
  EditorService.setDefaultUntitledLanguageId(resolveActiveMonacoLanguageId());

  for (const tab of EditorService.getTabs()) {
    if (!shouldUseSqlDialect(tab)) continue;
    EditorService.setTabLanguageId(tab.id, monacoLanguageIdForTab(tab));
  }
}

/**
 * Wire driver → Monaco language for untitled / .sql tabs and prefer SQL for New File.
 * Safe to call once at startup (after workbench contributions).
 */
export function bootstrapSqlLanguageBinding(): void {
  EditorConnectionBindingService.start();
  QueryExecutionService.start();
  startEditorTabConnectionDecorations();
  EditorService.configureLanguageIdResolver((_path, fromExtension) => {
    if (fromExtension === "sql" || isSqlLanguageId(fromExtension)) {
      return resolveActiveMonacoLanguageId();
    }
    return fromExtension;
  });

  // Promote the initial Untitled tab (created as plaintext) to the studio SQL dialect.
  applyDialectToSqlTabs();

  CommandsRegistry.registerCommand("silk.file.newTextFile", () => {
    const tabId = EditorService.openUntitled(resolveActiveMonacoLanguageId());
    EditorConnectionBindingService.ensureBinding(tabId);
  });

  ConnectionService.onDidChange(() => {
    applyDialectToSqlTabs();
  });

  // Status-bar / quick-pick connection switches change bindings, not ConnectionService.
  EditorConnectionBindingService.onDidChange(() => {
    applyDialectToSqlTabs();
  });
}
