import type { EditorTab } from "../editor/editorTypes";

type WindowTitleChangeListener = () => void;

class WindowTitleServiceImpl {
  private workspaceName = "silk-editor";
  private activeEditor: EditorTab | undefined;
  private readonly listeners = new Set<WindowTitleChangeListener>();

  getWorkspaceName(): string {
    return this.workspaceName;
  }

  setWorkspaceName(name: string): void {
    if (this.workspaceName === name) return;
    this.workspaceName = name;
    this.fireDidChange();
  }

  updateFromEditor(tab: EditorTab | undefined): void {
    this.activeEditor = tab;
    this.applyDocumentTitle();
    this.fireDidChange();
  }

  getTitle(): string {
    if (!this.activeEditor) {
      return this.workspaceName;
    }

    const prefix = this.activeEditor.isDirty
      ? `${this.activeEditor.label} • `
      : `${this.activeEditor.label} — `;
    return `${prefix}${this.workspaceName}`;
  }

  onDidChange(listener: WindowTitleChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private applyDocumentTitle(): void {
    document.title = this.getTitle();
  }

  private fireDidChange(): void {
    this.applyDocumentTitle();
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const WindowTitleService = new WindowTitleServiceImpl();
