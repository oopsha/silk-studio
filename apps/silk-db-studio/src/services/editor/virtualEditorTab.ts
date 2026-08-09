import { SettingsService } from "@silk-studio/workbench/services/settings/settingsService.ts";
import { KeybindingsEditorService } from "@silk-studio/workbench/services/keybindings/keybindingsEditorService.ts";
import { DocumentationService } from "@silk-studio/workbench/services/help/documentationService.ts";
import { ConnectionEditorService } from "../connection/connectionEditorService";
import { isDdlEditorTab } from "../connection/ddlEditorConstants";
import { isPlsqlEditorTab } from "../connection/plsqlEditorConstants";
import { isObjectEditorTab } from "../connection/objectEditorConstants";

/**
 * True for any tab AppShell's `renderAlternative` renders as a non-Monaco custom
 * view (settings, DDL preview, object editor, …) rather than a real SQL editor.
 * The query-result panel has nothing relevant to show for these — callers use
 * this to keep it hidden while such a tab is active in a group.
 */
export function isVirtualEditorTab(uri: string | undefined): boolean {
  return (
    SettingsService.isSettingsTab(uri) ||
    KeybindingsEditorService.isKeybindingsTab(uri) ||
    DocumentationService.isDocumentationTab(uri) ||
    ConnectionEditorService.isConnectionEditorTab(uri) ||
    isDdlEditorTab(uri) ||
    isPlsqlEditorTab(uri) ||
    isObjectEditorTab(uri)
  );
}
