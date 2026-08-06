import type { editor } from "monaco-editor";
import type { EditorTab, OpenEditorInput } from "./editorTypes";
import { EditorHost } from "./editorHost";
import {
  basenameFromPath,
  languageIdFromPath,
} from "./languageFromPath";
import { disposeMonacoModelForTab } from "./monacoModelPath";

type EditorChangeListener = () => void;

export type ActiveEditorSnapshot = {
  content: string;
  /** Character offsets into `content` (UTF-16 code units, Monaco model offsets). */
  selectionStart: number;
  selectionEnd: number;
};

function createTabId(): string {
  return `tab-${crypto.randomUUID()}`;
}

/** Alternative editor tabs that sync Monaco content and dirty state via EditorService. */
const MANAGED_SILK_URI_PREFIXES = ["silk://plsql/"];

/** Workbench chrome tabs — not part of Hot Exit restore. */
const EXCLUDED_SESSION_URI_PREFIXES = [
  "silk://settings",
  "silk://keybindings",
  "silk://documentation",
  "silk://connection/",
];

function isManagedSilkTabUri(uri: string | undefined): boolean {
  if (!uri) return false;
  return MANAGED_SILK_URI_PREFIXES.some((prefix) => uri.startsWith(prefix));
}

export function isExcludedFromEditorSession(uri: string | undefined): boolean {
  if (!uri) return false;
  return EXCLUDED_SESSION_URI_PREFIXES.some(
    (prefix) => uri === prefix || uri.startsWith(prefix),
  );
}

export type EditorSessionTabSnapshot = {
  id: string;
  label: string;
  uri?: string;
  languageId: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
  isPreview: boolean;
  isPinned: boolean;
  description?: string;
  tooltip?: string;
};

export type EditorSessionSnapshot = {
  version: 1;
  savedAt: number;
  activeTabId: string | null;
  untitledCounter: number;
  tabs: EditorSessionTabSnapshot[];
};

type LanguageIdResolver = (path: string, fromExtension: string) => string;

class EditorServiceImpl {
  private tabs: EditorTab[] = [];
  private activeTabId: string | null = null;
  private untitledCounter = 1;
  private readonly savedContent = new Map<string, string>();
  private readonly listeners = new Set<EditorChangeListener>();
  private initialized = false;
  private enablePreviewEditors = true;
  /** Live Monaco instance for the active text editor; cleared on unmount. */
  private activeTextEditor: editor.IStandaloneCodeEditor | null = null;
  /** Per-tab Monaco view state (scroll / cursor) restored when the tab remounts. */
  private readonly viewStates = new Map<string, editor.ICodeEditorViewState>();
  private defaultUntitledLanguageId = "plaintext";
  private resolveLanguageId: LanguageIdResolver = (_path, fromExtension) =>
    fromExtension;
  /** When true, ensureInitialTab will not invent an Untitled tab (Hot Exit restore in flight). */
  private sessionRestorePending = false;

  /**
   * Call before first React paint so getTabs() does not open a blank Untitled
   * while async Hot Exit restore runs.
   */
  prepareSessionRestore(): void {
    this.sessionRestorePending = true;
    this.initialized = true;
  }

  ensureInitialTab(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (this.tabs.length === 0 && !this.sessionRestorePending) {
      this.openUntitled();
    }
  }

  getTabs(): readonly EditorTab[] {
    this.ensureInitialTab();
    return this.tabs;
  }

  getActiveTabId(): string | null {
    this.ensureInitialTab();
    return this.activeTabId;
  }

  getActiveTab(): EditorTab | undefined {
    const id = this.getActiveTabId();
    return id ? this.tabs.find((tab) => tab.id === id) : undefined;
  }

  /**
   * Called from EditorArea on Monaco mount/unmount so query commands can read the live
   * selection/cursor (tab content alone is not enough — selection lives in the editor model).
   */
  setActiveTextEditor(instance: editor.IStandaloneCodeEditor | null): void {
    this.activeTextEditor = instance;
  }

  getActiveTextEditor(): editor.IStandaloneCodeEditor | null {
    return this.activeTextEditor;
  }

  saveViewState(
    tabId: string,
    state: editor.ICodeEditorViewState | null,
  ): void {
    if (!state) {
      this.viewStates.delete(tabId);
      return;
    }
    this.viewStates.set(tabId, state);
  }

  /** Returns and keeps the saved view state for restore on remount. */
  getViewState(tabId: string): editor.ICodeEditorViewState | null {
    return this.viewStates.get(tabId) ?? null;
  }

  setDefaultUntitledLanguageId(languageId: string): void {
    this.defaultUntitledLanguageId = languageId;
  }

  configureLanguageIdResolver(resolver: LanguageIdResolver): void {
    this.resolveLanguageId = resolver;
  }

  setTabLanguageId(id: string, languageId: string): void {
    const tab = this.tabs.find((item) => item.id === id);
    if (!tab || tab.languageId === languageId) return;
    tab.languageId = languageId;
    this.fireDidChange();
  }

  /**
   * Optional tab chrome (muted suffix + tooltip). No-op when unchanged.
   * Used by the app to show per-tab connection binding without renaming the file.
   */
  setTabDecoration(
    id: string,
    decoration: { description?: string | null; tooltip?: string | null },
  ): void {
    const tab = this.tabs.find((item) => item.id === id);
    if (!tab) return;
    const nextDescription = decoration.description?.trim() || undefined;
    const nextTooltip = decoration.tooltip?.trim() || undefined;
    if (tab.description === nextDescription && tab.tooltip === nextTooltip) {
      return;
    }
    tab.description = nextDescription;
    tab.tooltip = nextTooltip;
    this.fireDidChange();
  }

  /**
   * Snapshot of the active Monaco buffer + selection offsets. Falls back to the whole tab
   * content with a collapsed selection at the end when Monaco is not mounted yet.
   */
  getActiveEditorSnapshot(): ActiveEditorSnapshot | null {
    const tab = this.getActiveTab();
    if (!tab) return null;

    const instance = this.activeTextEditor;
    if (!instance) {
      const content = tab.content;
      return {
        content,
        selectionStart: content.length,
        selectionEnd: content.length,
      };
    }

    const model = instance.getModel();
    const content = model?.getValue() ?? tab.content;
    const selection = instance.getSelection();
    if (!model || !selection) {
      return {
        content,
        selectionStart: content.length,
        selectionEnd: content.length,
      };
    }

    const selectionStart = model.getOffsetAt(selection.getStartPosition());
    const selectionEnd = model.getOffsetAt(selection.getEndPosition());
    return { content, selectionStart, selectionEnd };
  }

  openUntitled(languageId?: string): string {
    const label = `Untitled-${this.untitledCounter++}`;
    return this.openEditor({
      label,
      languageId: languageId ?? this.defaultUntitledLanguageId,
      content: "",
      preview: false,
    });
  }

  getUntitledCounter(): number {
    return this.untitledCounter;
  }

  getSavedContent(tabId: string): string {
    return this.savedContent.get(tabId) ?? "";
  }

  /**
   * Snapshot tabs eligible for Hot Exit (excludes settings / keybindings / docs /
   * connection editors).
   */
  captureSessionSnapshot(): EditorSessionSnapshot {
    const tabs: EditorSessionTabSnapshot[] = [];
    for (const tab of this.tabs) {
      if (isExcludedFromEditorSession(tab.uri)) continue;
      tabs.push({
        id: tab.id,
        label: tab.label,
        uri: tab.uri,
        languageId: tab.languageId,
        content: tab.content,
        savedContent: this.savedContent.get(tab.id) ?? tab.content,
        isDirty: tab.isDirty,
        isPreview: tab.isPreview,
        isPinned: tab.isPinned,
        description: tab.description,
        tooltip: tab.tooltip,
      });
    }
    let activeTabId = this.activeTabId;
    if (activeTabId && !tabs.some((tab) => tab.id === activeTabId)) {
      activeTabId = tabs[0]?.id ?? null;
    }
    return {
      version: 1,
      savedAt: Date.now(),
      activeTabId,
      untitledCounter: this.untitledCounter,
      tabs,
    };
  }

  /**
   * Replace open editors with a Hot Exit snapshot. Clears restore-pending and
   * opens Untitled when the snapshot has no tabs.
   */
  applySessionSnapshot(snapshot: EditorSessionSnapshot | null): void {
    for (const tab of this.tabs) {
      this.disposeClosedTab(tab);
    }
    this.tabs = [];
    this.activeTabId = null;
    this.savedContent.clear();
    this.viewStates.clear();
    this.sessionRestorePending = false;
    this.initialized = true;

    if (!snapshot || snapshot.tabs.length === 0) {
      this.untitledCounter = Math.max(1, snapshot?.untitledCounter ?? 1);
      this.openUntitled();
      this.updateContextKeys();
      this.fireDidChange();
      return;
    }

    this.untitledCounter = Math.max(1, snapshot.untitledCounter);
    for (const item of snapshot.tabs) {
      if (isExcludedFromEditorSession(item.uri)) continue;
      const tab: EditorTab = {
        id: item.id,
        label: item.label,
        uri: item.uri,
        languageId: item.languageId,
        content: item.content,
        isDirty: item.isDirty,
        isPreview: item.isPreview,
        isPinned: item.isPinned,
        description: item.description,
        tooltip: item.tooltip,
      };
      this.tabs.push(tab);
      this.savedContent.set(item.id, item.savedContent);
    }

    if (this.tabs.length === 0) {
      this.openUntitled();
    } else {
      const active =
        (snapshot.activeTabId &&
          this.tabs.find((tab) => tab.id === snapshot.activeTabId)?.id) ||
        this.tabs[0]!.id;
      this.activeTabId = active;
    }

    this.updateContextKeys();
    this.fireDidChange();
  }

  /**
   * Update tab buffer used for Hot Exit / display without toggling dirty
   * (e.g. DDL fetch completed).
   */
  setTabContentSnapshot(id: string, content: string): void {
    const tab = this.tabs.find((item) => item.id === id);
    if (!tab || tab.content === content) return;
    tab.content = content;
    if (!tab.isDirty) {
      this.savedContent.set(id, content);
    }
    this.fireDidChange();
  }

  openEditor(input: OpenEditorInput): string {
    if (input.uri) {
      const existing = this.tabs.find((tab) => tab.uri === input.uri);
      if (existing) {
        this.setActiveTab(existing.id);
        if (!input.preview) {
          this.pinTab(existing.id);
        }
        return existing.id;
      }
    }

    const previewTab = this.tabs.find(
      (tab) => tab.isPreview && !tab.isPinned && tab.id !== this.activeTabId,
    );
    if (input.preview && previewTab) {
      this.replaceTab(previewTab.id, input);
      this.setActiveTab(previewTab.id);
      return previewTab.id;
    }

    if (input.preview) {
      const active = this.getActiveTab();
      if (active?.isPreview && !active.isPinned) {
        this.replaceTab(active.id, input);
        this.setActiveTab(active.id);
        return active.id;
      }
    }

    const id = createTabId();
    const tab: EditorTab = {
      id,
      label: input.label,
      uri: input.uri,
      languageId: input.languageId,
      content: input.content,
      isDirty: false,
      isPreview: input.preview ?? false,
      isPinned: false,
    };

    this.tabs.push(tab);
    this.savedContent.set(id, input.content);
    this.setActiveTab(id);
    return id;
  }

  openFile(path: string, content: string, preview?: boolean): string {
    const fromExtension = languageIdFromPath(path);
    return this.openEditor({
      uri: path,
      label: basenameFromPath(path),
      languageId: this.resolveLanguageId(path, fromExtension),
      content,
      preview: preview ?? this.enablePreviewEditors,
    });
  }

  getEnablePreviewEditors(): boolean {
    return this.enablePreviewEditors;
  }

  setEnablePreviewEditors(enabled: boolean): void {
    if (this.enablePreviewEditors === enabled) return;
    this.enablePreviewEditors = enabled;
    this.fireDidChange();
  }

  toggleEnablePreviewEditors(): void {
    this.setEnablePreviewEditors(!this.enablePreviewEditors);
  }

  closeSavedTabs(): void {
    const savedIds = this.tabs
      .filter((tab) => !tab.isDirty)
      .map((tab) => tab.id);

    for (const id of savedIds) {
      if (this.tabs.length <= 1) {
        break;
      }
      this.closeTab(id);
    }
  }

  setActiveTab(id: string): void {
    if (!this.tabs.some((tab) => tab.id === id)) return;
    if (this.activeTabId === id) return;
    this.activeTabId = id;
    this.updateContextKeys();
    this.fireDidChange();
  }

  closeTab(id: string): void {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;

    const [removed] = this.tabs.splice(index, 1);
    if (removed) {
      this.disposeClosedTab(removed);
    }

    if (this.activeTabId === id) {
      const nextTab = this.tabs[index] ?? this.tabs[index - 1] ?? null;
      this.activeTabId = nextTab?.id ?? null;
    }

    if (this.tabs.length === 0) {
      this.openUntitled();
    }

    this.updateContextKeys();
    this.fireDidChange();
  }

  closeActiveTab(): void {
    const active = this.getActiveTab();
    if (active) {
      this.closeTab(active.id);
    }
  }

  closeAllTabs(): void {
    for (const tab of this.tabs) {
      this.disposeClosedTab(tab);
    }
    this.tabs = [];
    this.activeTabId = null;
    this.savedContent.clear();
    this.viewStates.clear();
    this.openUntitled();
    this.updateContextKeys();
    this.fireDidChange();
  }

  closeOtherTabs(keepId: string): void {
    const removed = this.tabs.filter((tab) => tab.id !== keepId);
    this.tabs = this.tabs.filter((tab) => tab.id === keepId);
    for (const tab of removed) {
      this.disposeClosedTab(tab);
    }
    this.activeTabId = keepId;
    this.updateContextKeys();
    this.fireDidChange();
  }

  closeTabsToRight(fromId: string): void {
    const index = this.tabs.findIndex((tab) => tab.id === fromId);
    if (index === -1) return;

    const removed = this.tabs.splice(index + 1);
    for (const tab of removed) {
      this.disposeClosedTab(tab);
    }

    if (
      this.activeTabId &&
      !this.tabs.some((tab) => tab.id === this.activeTabId)
    ) {
      this.activeTabId = fromId;
    }

    this.updateContextKeys();
    this.fireDidChange();
  }

  /**
   * Reorder a tab to `toIndex` (0-based in the resulting list).
   * Used by tab-bar drag-and-drop.
   */
  moveTab(tabId: string, toIndex: number): void {
    const fromIndex = this.tabs.findIndex((tab) => tab.id === tabId);
    if (fromIndex === -1) return;

    const clamped = Math.max(0, Math.min(toIndex, this.tabs.length - 1));
    if (fromIndex === clamped) return;

    const [tab] = this.tabs.splice(fromIndex, 1);
    this.tabs.splice(clamped, 0, tab);
    this.fireDidChange();
  }

  private disposeClosedTab(tab: EditorTab): void {
    this.savedContent.delete(tab.id);
    this.viewStates.delete(tab.id);
    disposeMonacoModelForTab(tab);
  }

  pinTab(id: string): void {
    const tab = this.tabs.find((item) => item.id === id);
    if (!tab) return;
    tab.isPreview = false;
    tab.isPinned = true;
    this.fireDidChange();
  }

  updateTabContent(id: string, content: string): void {
    const tab = this.tabs.find((item) => item.id === id);
    if (!tab || tab.content === content) return;
    if (tab.uri?.startsWith("silk://") && !isManagedSilkTabUri(tab.uri)) return;

    tab.content = content;
    tab.isDirty = content !== (this.savedContent.get(id) ?? "");
    this.updateContextKeys();
    this.fireDidChange();
  }

  /** Set content and saved baseline for managed silk:// editor tabs (e.g. PL/SQL source). */
  setTabContentBaseline(id: string, content: string): void {
    const tab = this.tabs.find((item) => item.id === id);
    if (!tab || !isManagedSilkTabUri(tab.uri)) return;

    tab.content = content;
    tab.isDirty = false;
    this.savedContent.set(id, content);
    this.updateContextKeys();
    this.fireDidChange();
  }

  /** Replace tab content from disk and clear dirty (external reload / reopen). */
  reloadTabFromDisk(id: string, content: string): void {
    const tab = this.tabs.find((item) => item.id === id);
    if (!tab) return;

    tab.content = content;
    tab.isDirty = false;
    this.savedContent.set(id, content);

    if (this.activeTabId === id && this.activeTextEditor) {
      const model = this.activeTextEditor.getModel();
      if (model && model.getValue() !== content) {
        const position = this.activeTextEditor.getPosition();
        model.setValue(content);
        if (position) {
          this.activeTextEditor.setPosition(position);
        }
      }
    }

    this.updateContextKeys();
    this.fireDidChange();
  }

  /** Absolute filesystem path tabs only (not untitled / silk://). */
  getFilesystemTabs(): readonly EditorTab[] {
    return this.tabs.filter(
      (tab) =>
        Boolean(tab.uri?.trim()) &&
        !tab.uri!.startsWith("silk://"),
    );
  }

  markTabSaved(id: string, uri?: string, label?: string): void {
    const tab = this.tabs.find((item) => item.id === id);
    if (!tab) return;

    if (uri) {
      tab.uri = uri;
    }
    if (label) {
      tab.label = label;
    }

    tab.isDirty = false;
    tab.isPreview = false;
    this.savedContent.set(id, tab.content);
    this.updateContextKeys();
    this.fireDidChange();
  }

  focusNextTab(): void {
    if (this.tabs.length < 2) return;
    const index = this.tabs.findIndex((tab) => tab.id === this.activeTabId);
    const next = this.tabs[(index + 1) % this.tabs.length];
    this.setActiveTab(next.id);
  }

  focusPreviousTab(): void {
    if (this.tabs.length < 2) return;
    const index = this.tabs.findIndex((tab) => tab.id === this.activeTabId);
    const previous =
      this.tabs[(index - 1 + this.tabs.length) % this.tabs.length];
    this.setActiveTab(previous.id);
  }

  onDidChange(listener: EditorChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private replaceTab(id: string, input: OpenEditorInput): void {
    const tab = this.tabs.find((item) => item.id === id);
    if (!tab) return;

    tab.label = input.label;
    tab.uri = input.uri;
    tab.languageId = input.languageId;
    tab.content = input.content;
    tab.isDirty = false;
    tab.isPreview = input.preview ?? false;
  }

  private updateContextKeys(): void {
    const active = this.getActiveTab();
    EditorHost.setContextKey("activeEditorAvailable", Boolean(active));
    EditorHost.setContextKey("editorFocus", Boolean(active));
    EditorHost.setContextKey("resourceDirty", Boolean(active?.isDirty));
    EditorHost.updateWindowTitle(active);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const EditorService = new EditorServiceImpl();
