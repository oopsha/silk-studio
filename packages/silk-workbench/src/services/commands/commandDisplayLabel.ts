import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { localizeUiLabel } from "../../platform/i18n/localizeUiLabel";

/**
 * Canonical English titles for commands that are not (yet) on a menu.
 * Must match keys in ENGLISH_LABEL_KEYS so localizeUiLabel can translate them.
 */
export const COMMAND_ENGLISH_TITLES: Readonly<Record<string, string>> = {
  "workbench.action.closeActiveEditor": "Close Active Editor",
  "workbench.action.closeAllEditors": "Close All Editors",
  "workbench.action.closeAllSavedEditors": "Close All Saved Editors",
  "workbench.action.showAllEditors": "Show All Editors",
  "workbench.action.togglePreviewEditors": "Toggle Preview Editors",
  "workbench.action.lockEditorGroup": "Lock Editor Group",
  "workbench.action.splitEditorRight": "Split Editor Right",
  "workbench.action.closeEditorGroup": "Close Editor Group",
  "workbench.action.closeOtherEditors": "Close Other Editors",
  "workbench.action.closeEditorsToTheRight": "Close Editors To the Right",
  "workbench.action.nextEditor": "Next Editor",
  "workbench.action.previousEditor": "Previous Editor",
  "workbench.action.pinEditor": "Pin Editor",
  "workbench.action.configureEditors": "Configure Editors",
  "workbench.action.quickOpen": "Search",
  "workbench.action.selectTheme": "Color Theme",
  "workbench.action.selectIconTheme": "File Icon Theme",
  "workbench.action.selectProductIconTheme": "Product Icon Theme",
  "workbench.action.openSnippets": "Snippets",
  "workbench.action.tasks.manage": "Tasks",
  "workbench.userData.actions.manageSettings": "Backup and Sync Settings...",
  "workbench.profiles.actions.createTemporaryProfile":
    "Create Temporary Profile...",
  "workbench.profiles.actions.switchProfile": "Switch Profile...",
  "workbench.userDataSync.actions.turnOn": "Turn on Cloud Changes...",
  "workbench.remoteTunnel.actions.turnOn": "Turn on Remote Tunnel Access...",
  "workbench.extensions.actions.manageAccountPreferences":
    "Manage Extension Account Preferences...",
  "workbench.accounts.actions.manageLanguageModelAccess":
    "Manage Language Model Access...",
  "workbench.accounts.actions.signIn": "Sign in to Sync Settings",
  "workbench.view.extensions": "Extensions",
  "update.check": "Check for Updates...",
  "silk.file.closeAll": "Close All",
  "silk.query.executeAll": "Execute All",
  "silk.query.reexecuteLastHistory": "Reexecute Last History",
  "silk.query.insertLastHistory": "Insert Last History",
  "silk.query.openLastHistoryInEditor": "Open Last History In Editor",
  "silk.query.openHistory": "Query History",
  "silk.explorer.openData": "Open Data",
  "silk.explorer.viewDdl": "View DDL",
  "silk.explorer.openSource": "Edit Spec",
  "silk.explorer.openPackageBody": "Edit Body",
  "silk.explorer.copyName": "Copy Name",
  "silk.explorer.dropObject": "Drop Object",
  "silk.explorer.renameObject": "Rename Object",
  "silk.explorer.useDatabase": "Use This Database",
  "silk.explorer.setDefaultDatabase": "Set as Default Database",
  "silk.explorer.refreshSchema": "Refresh Schema",
  "silk.explorer.refreshCatalog": "Refresh Catalog",
  "silk.explorer.refresh": "Refresh Connections Explorer",
  "silk.explorer.collapseAll": "Collapse Connections Explorer",
  "silk.explorer.searchObjects": "Search Database Objects...",
};

export function fallbackLabelFromCommandId(commandId: string): string {
  const leaf = commandId.split(".").pop() ?? commandId;
  return leaf
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function resolveCommandDisplayLabel(
  commandId: string,
  menuTitles?: ReadonlyMap<string, string>,
): string {
  const fromMenu = (menuTitles ?? MenuRegistry.collectCommandTitles()).get(
    commandId,
  );
  if (fromMenu) return fromMenu;

  const english =
    COMMAND_ENGLISH_TITLES[commandId] ?? fallbackLabelFromCommandId(commandId);
  return localizeUiLabel(english);
}
