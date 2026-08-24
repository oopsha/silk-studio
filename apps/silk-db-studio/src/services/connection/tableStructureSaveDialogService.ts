import type { ObjectEditorRef } from "./objectEditorConstants";
import type { TableStructureChangeSet } from "./tableStructureDiff";

export type TableStructureSaveDialogRequest = {
  tabId: string;
  ref: ObjectEditorRef;
  objectLabel: string;
  changes: TableStructureChangeSet;
  /** Joined display text for the "SQL" tab — always `statements.join(";\n\n") + ";"`. */
  sql: string;
  /** What actually gets executed, in order. */
  statements: string[];
  warnings: string[];
  /** Non-empty disables the confirm button. */
  blockers: string[];
};

type TableStructureSaveDialogListener = () => void;

class TableStructureSaveDialogServiceImpl {
  private request: TableStructureSaveDialogRequest | null = null;
  private pendingResolve: ((saved: boolean) => void) | null = null;
  private readonly listeners = new Set<TableStructureSaveDialogListener>();

  getRequest(): TableStructureSaveDialogRequest | null {
    return this.request;
  }

  isOpen(): boolean {
    return this.request !== null;
  }

  /**
   * Opens the confirm dialog. Resolves `true` after a successful save,
   * `false` if the user cancels or closes without saving.
   */
  open(next: TableStructureSaveDialogRequest): Promise<boolean> {
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

  patch(partial: Partial<TableStructureSaveDialogRequest>): void {
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

  onDidChange(listener: TableStructureSaveDialogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const TableStructureSaveDialogService = new TableStructureSaveDialogServiceImpl();
