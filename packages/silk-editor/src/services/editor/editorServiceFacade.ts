import type { editor } from "monaco-editor";
import type { EditorTab, OpenEditorInput } from "./editorTypes";
import type { ActiveEditorSnapshot, EditorGroupContentSnapshot } from "./editorService";
import { EditorGroupsService } from "./editorGroupsService";
import type { EditorGroupId } from "./editorGroupTypes";

function focused() {
  return EditorGroupsService.getFocusedGroup();
}

function owner(tabId: string) {
  return EditorGroupsService.getGroupForTab(tabId) ?? focused();
}

/**
 * Keeps active-tab operations focused-group based for existing callers while
 * routing tab-id operations to the group that owns the tab. This lets
 * alternative editors render independently in split panes without changing
 * the single-editor API used by workbench commands.
 */
export const EditorService = {
  prepareSessionRestore: (): void => EditorGroupsService.prepareSessionRestore(),
  ensureInitialTab: (): void => focused().ensureInitialTab(),

  getTabs: (groupId?: EditorGroupId): readonly EditorTab[] =>
    groupId
      ? (EditorGroupsService.getGroupIfExists(groupId)?.getTabs() ?? [])
      : focused().getTabs(),
  getTab: (id: string): EditorTab | undefined =>
    EditorGroupsService.getGroupForTab(id)?.findTab(id),
  getActiveTabId: (): string | null => focused().getActiveTabId(),
  getActiveTab: (): EditorTab | undefined => focused().getActiveTab(),
  getFilesystemTabs: (): readonly EditorTab[] => focused().getFilesystemTabs(),

  setActiveTextEditor: (
    instance: editor.IStandaloneCodeEditor | null,
    groupId?: EditorGroupId,
  ): void =>
    (groupId ? EditorGroupsService.getGroupIfExists(groupId) : focused())
      ?.setActiveTextEditor(instance),
  getActiveTextEditor: (groupId?: EditorGroupId): editor.IStandaloneCodeEditor | null =>
    (groupId ? EditorGroupsService.getGroupIfExists(groupId) : focused())
      ?.getActiveTextEditor() ?? null,

  saveViewState: (tabId: string, state: editor.ICodeEditorViewState | null): void =>
    owner(tabId).saveViewState(tabId, state),
  getViewState: (tabId: string): editor.ICodeEditorViewState | null =>
    owner(tabId).getViewState(tabId),

  setDefaultUntitledLanguageId: (languageId: string): void =>
    focused().setDefaultUntitledLanguageId(languageId),
  configureLanguageIdResolver: (
    resolver: (path: string, fromExtension: string) => string,
  ): void => focused().configureLanguageIdResolver(resolver),

  setTabLanguageId: (id: string, languageId: string): void =>
    owner(id).setTabLanguageId(id, languageId),
  setTabDecoration: (
    id: string,
    decoration: { description?: string | null; tooltip?: string | null },
  ): void => owner(id).setTabDecoration(id, decoration),
  setTabDirtyOverride: (id: string, dirty: boolean): void =>
    owner(id).setTabDirtyOverride(id, dirty),

  getActiveEditorSnapshot: (): ActiveEditorSnapshot | null =>
    focused().getActiveEditorSnapshot(),

  openUntitled: (languageId?: string): string => focused().openUntitled(languageId),
  getSavedContent: (tabId: string): string => owner(tabId).getSavedContent(tabId),

  captureSessionSnapshot: (): EditorGroupContentSnapshot =>
    focused().captureSessionSnapshot(),
  applySessionSnapshot: (snapshot: EditorGroupContentSnapshot | null): void =>
    focused().applySessionSnapshot(snapshot),

  setTabContentSnapshot: (id: string, content: string): void =>
    owner(id).setTabContentSnapshot(id, content),

  openEditor: (input: OpenEditorInput): string => EditorGroupsService.openEditor(input),
  openFile: (path: string, content: string, preview?: boolean): string =>
    EditorGroupsService.openFile(path, content, preview),

  getEnablePreviewEditors: (): boolean => focused().getEnablePreviewEditors(),
  setEnablePreviewEditors: (enabled: boolean): void =>
    EditorGroupsService.setEnablePreviewEditors(enabled),
  toggleEnablePreviewEditors: (): void =>
    EditorGroupsService.toggleEnablePreviewEditors(),

  closeSavedTabs: (): void => focused().closeSavedTabs(),
  setActiveTab: (id: string): void => focused().setActiveTab(id),
  closeTab: (id: string): void =>
    EditorGroupsService.closeTab(
      EditorGroupsService.getGroupIdForTab(id) ?? EditorGroupsService.getFocusedGroupId(),
      id,
    ),
  closeActiveTab: (): void =>
    EditorGroupsService.closeActiveTab(EditorGroupsService.getFocusedGroupId()),
  closeAllTabs: (): void =>
    EditorGroupsService.closeAllTabsInGroup(EditorGroupsService.getFocusedGroupId()),
  closeOtherTabs: (keepId: string): void => focused().closeOtherTabs(keepId),
  closeTabsToRight: (fromId: string): void => focused().closeTabsToRight(fromId),
  moveTab: (tabId: string, toIndex: number): void => focused().moveTab(tabId, toIndex),
  pinTab: (id: string): void => focused().pinTab(id),

  updateTabContent: (id: string, content: string): void =>
    owner(id).updateTabContent(id, content),
  setTabContentBaseline: (id: string, content: string): void =>
    owner(id).setTabContentBaseline(id, content),
  reloadTabFromDisk: (id: string, content: string): void =>
    owner(id).reloadTabFromDisk(id, content),
  markTabSaved: (id: string, uri?: string, label?: string): void =>
    owner(id).markTabSaved(id, uri, label),

  focusNextTab: (): void => focused().focusNextTab(),
  focusPreviousTab: (): void => focused().focusPreviousTab(),

  onDidChange: (listener: () => void): (() => void) =>
    EditorGroupsService.onDidChange(listener),
};
