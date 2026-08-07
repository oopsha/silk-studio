import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";
import { ConnectionService } from "./connectionService";
import {
  formatConnectionTabSuffix,
  formatConnectionTargetLabel,
} from "./connectionTargetLabel";
import { EditorConnectionBindingService } from "./editorConnectionBindingService";
import { isSqlLanguageId } from "../sql/sqlDialect";

/**
 * Keep editor tab muted suffixes / tooltips in sync with connection bindings (MC-F).
 */
export function syncEditorTabConnectionDecorations(): void {
  const noConnection = tKey("app.connectionTarget.noConnection");
  const disconnected = tKey("app.connectionTarget.disconnected");

  for (const tab of EditorService.getTabs()) {
    if (!isSqlLanguageId(tab.languageId)) {
      EditorService.setTabDecoration(tab.id, {
        description: null,
        tooltip: null,
      });
      continue;
    }

    const binding = EditorConnectionBindingService.getBinding(tab.id);
    const description = formatConnectionTabSuffix(binding);
    const target = formatConnectionTargetLabel(binding, {
      noConnection,
      disconnected,
    });
    const tooltipParts = [tab.label, target];
    if (tab.uri) tooltipParts.push(tab.uri);

    EditorService.setTabDecoration(tab.id, {
      description,
      tooltip: tooltipParts.join("\n"),
    });
  }
}

export function startEditorTabConnectionDecorations(): void {
  syncEditorTabConnectionDecorations();
  EditorConnectionBindingService.onDidChange(() => {
    syncEditorTabConnectionDecorations();
  });
  ConnectionService.onDidChange(() => {
    syncEditorTabConnectionDecorations();
  });
}
