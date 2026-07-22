import type { EditorTab, OpenEditorInput } from "./editorTypes";
import { EditorHost } from "./editorHost";
import {
  basenameFromPath,
  languageIdFromPath,
} from "./languageFromPath";

type EditorChangeListener = () => void;

function createTabId(): string {
  return `tab-${crypto.randomUUID()}`;
}

class EditorServiceImpl {
  private tabs: EditorTab[] = [];
  private activeTabId: string | null = null;
  private untitledCounter = 1;
  private readonly savedContent = new Map<string, string>();
  private readonly listeners = new Set<EditorChangeListener>();
  private initialized = false;
  private enablePreviewEditors = true;

  ensureInitialTab(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (this.tabs.length === 0) {
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

  openUntitled(): string {
    const label = `Untitled-${this.untitledCounter++}`;
    return this.openEditor({
      label,
      languageId: "plaintext",
      content: "",
      preview: false,
    });
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
    return this.openEditor({
      uri: path,
      label: basenameFromPath(path),
      languageId: languageIdFromPath(path),
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

    this.tabs.splice(index, 1);
    this.savedContent.delete(id);

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
    this.tabs = [];
    this.activeTabId = null;
    this.savedContent.clear();
    this.openUntitled();
    this.updateContextKeys();
    this.fireDidChange();
  }

  closeOtherTabs(keepId: string): void {
    this.tabs = this.tabs.filter((tab) => tab.id === keepId);
    for (const key of [...this.savedContent.keys()]) {
      if (key !== keepId) {
        this.savedContent.delete(key);
      }
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
      this.savedContent.delete(tab.id);
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
    if (tab.uri?.startsWith("silk://")) return;

    tab.content = content;
    tab.isDirty = content !== (this.savedContent.get(id) ?? "");
    this.updateContextKeys();
    this.fireDidChange();
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
