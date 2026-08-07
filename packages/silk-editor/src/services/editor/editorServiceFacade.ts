import type { editor } from "monaco-editor";
import type { EditorTab, OpenEditorInput } from "./editorTypes";
import type { ActiveEditorSnapshot, EditorGroupContentSnapshot } from "./editorService";
import { EditorGroupsService } from "./editorGroupsService";

function focused() {
  return EditorGroupsService.getFocusedGroup();
}

/**
 * Delegates every call to whichever editor group currently has focus — the
 * single-editor API surface every existing call site was written against.
 * `openFile`/`openEditor` and `onDidChange` route through
 * `EditorGroupsService` instead of the focused group directly: opening
 * reveals an already-open uri in its own group rather than duplicating it,
 * and `onDidChange` must keep firing correctly as focus moves between groups.
 */
export const EditorService = {
  prepareSessionRestore: (): void => EditorGroupsService.prepareSessionRestore(),
  ensureInitialTab: (): void => focused().ensureInitialTab(),

  getTabs: (): readonly EditorTab[] => focused().getTabs(),
  getActiveTabId: (): string | null => focused().getActiveTabId(),
  getActiveTab: (): EditorTab | undefined => focused().getActiveTab(),
  getFilesystemTabs: (): readonly EditorTab[] => focused().getFilesystemTabs(),

  setActiveTextEditor: (instance: editor.IStandaloneCodeEditor | null): void =>
    focused().setActiveTextEditor(instance),
  getActiveTextEditor: (): editor.IStandaloneCodeEditor | null =>
    focused().getActiveTextEditor(),

  saveViewState: (tabId: string, state: editor.ICodeEditorViewState | null): void =>
    focused().saveViewState(tabId, state),
  getViewState: (tabId: string): editor.ICodeEditorViewState | null =>
    focused().getViewState(tabId),

  setDefaultUntitledLanguageId: (languageId: string): void =>
    focused().setDefaultUntitledLanguageId(languageId),
  configureLanguageIdResolver: (
    resolver: (path: string, fromExtension: string) => string,
  ): void => focused().configureLanguageIdResolver(resolver),

  setTabLanguageId: (id: string, languageId: string): void =>
    focused().setTabLanguageId(id, languageId),
  setTabDecoration: (
    id: string,
    decoration: { description?: string | null; tooltip?: string | null },
  ): void => focused().setTabDecoration(id, decoration),

  getActiveEditorSnapshot: (): ActiveEditorSnapshot | null =>
    focused().getActiveEditorSnapshot(),

  openUntitled: (languageId?: string): string => focused().openUntitled(languageId),
  getSavedContent: (tabId: string): string => focused().getSavedContent(tabId),

  captureSessionSnapshot: (): EditorGroupContentSnapshot =>
    focused().captureSessionSnapshot(),
  applySessionSnapshot: (snapshot: EditorGroupContentSnapshot | null): void =>
    focused().applySessionSnapshot(snapshot),

  setTabContentSnapshot: (id: string, content: string): void =>
    focused().setTabContentSnapshot(id, content),

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
    EditorGroupsService.closeTab(EditorGroupsService.getFocusedGroupId(), id),
  closeActiveTab: (): void =>
    EditorGroupsService.closeActiveTab(EditorGroupsService.getFocusedGroupId()),
  closeAllTabs: (): void =>
    EditorGroupsService.closeAllTabsInGroup(EditorGroupsService.getFocusedGroupId()),
  closeOtherTabs: (keepId: string): void => focused().closeOtherTabs(keepId),
  closeTabsToRight: (fromId: string): void => focused().closeTabsToRight(fromId),
  moveTab: (tabId: string, toIndex: number): void => focused().moveTab(tabId, toIndex),
  pinTab: (id: string): void => focused().pinTab(id),

  updateTabContent: (id: string, content: string): void =>
    focused().updateTabContent(id, content),
  setTabContentBaseline: (id: string, content: string): void =>
    focused().setTabContentBaseline(id, content),
  reloadTabFromDisk: (id: string, content: string): void =>
    focused().reloadTabFromDisk(id, content),
  markTabSaved: (id: string, uri?: string, label?: string): void =>
    focused().markTabSaved(id, uri, label),

  focusNextTab: (): void => focused().focusNextTab(),
  focusPreviousTab: (): void => focused().focusPreviousTab(),

  onDidChange: (listener: () => void): (() => void) =>
    EditorGroupsService.onDidChange(listener),
};
