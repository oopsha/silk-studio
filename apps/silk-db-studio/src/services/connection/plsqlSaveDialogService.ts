import type { PlsqlEditorRef } from "./plsqlEditorConstants";

export type PlsqlSaveDialogRequest = {
  tabId: string;
  ref: PlsqlEditorRef;
  sql: string;
  warnings: string[];
  objectLabel: string;
  /** Current editor buffer (for Diff vs DB). */
  bufferContent: string;
  /** Live DB source at dialog open time; null while loading / on failure. */
  dbSource: string | null;
  dbSourceError: string | null;
  dbSourceLoading: boolean;
};

type PlsqlSaveDialogListener = () => void;

class PlsqlSaveDialogServiceImpl {
  private request: PlsqlSaveDialogRequest | null = null;
  private pendingResolve: ((saved: boolean) => void) | null = null;
  private readonly listeners = new Set<PlsqlSaveDialogListener>();

  getRequest(): PlsqlSaveDialogRequest | null {
    return this.request;
  }

  isOpen(): boolean {
    return this.request !== null;
  }

  /**
   * Opens the confirm dialog. Resolves `true` after a successful save,
   * `false` if the user cancels or closes without saving.
   */
  open(next: PlsqlSaveDialogRequest): Promise<boolean> {
    if (this.pendingResolve) {
      this.pendingResolve(false);
      this.pendingResolve = null;
    }
    this.request = next;
    this.fireDidChange();
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  patch(partial: Partial<PlsqlSaveDialogRequest>): void {
    if (!this.request) return;
    this.request = { ...this.request, ...partial };
    this.fireDidChange();
  }

  close(saved = false): void {
    if (!this.request && !this.pendingResolve) return;
    this.request = null;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.fireDidChange();
    resolve?.(saved);
  }

  onDidChange(listener: PlsqlSaveDialogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const PlsqlSaveDialogService = new PlsqlSaveDialogServiceImpl();
