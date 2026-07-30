export type AiSqlReviewAction = "insert" | "newTab" | "cancel";

export type AiSqlDiffDialogRequest = {
  sql: string;
  /** Current editor selection, or full buffer when nothing is selected. */
  original: string;
  originalLabel: string;
  warnings: string[];
  languageId: string;
};

type AiSqlDiffDialogListener = () => void;

class AiSqlDiffDialogServiceImpl {
  private request: AiSqlDiffDialogRequest | null = null;
  private pendingResolve: ((action: AiSqlReviewAction) => void) | null = null;
  private readonly listeners = new Set<AiSqlDiffDialogListener>();

  getRequest(): AiSqlDiffDialogRequest | null {
    return this.request;
  }

  isOpen(): boolean {
    return this.request !== null;
  }

  open(next: AiSqlDiffDialogRequest): Promise<AiSqlReviewAction> {
    if (this.pendingResolve) {
      this.pendingResolve("cancel");
      this.pendingResolve = null;
    }
    this.request = next;
    this.fireDidChange();
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  close(action: AiSqlReviewAction = "cancel"): void {
    if (!this.request && !this.pendingResolve) return;
    this.request = null;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.fireDidChange();
    resolve?.(action);
  }

  onDidChange(listener: AiSqlDiffDialogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const AiSqlDiffDialogService = new AiSqlDiffDialogServiceImpl();
