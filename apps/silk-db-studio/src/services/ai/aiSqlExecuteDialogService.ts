export type AiSqlExecuteDialogRequest = {
  sql: string;
  isWrite: boolean;
  readOnly: boolean;
  /** When read-only blocks a write, confirm stays disabled. */
  blockedReason: string | null;
  warnings: string[];
};

type AiSqlExecuteDialogListener = () => void;

class AiSqlExecuteDialogServiceImpl {
  private request: AiSqlExecuteDialogRequest | null = null;
  private pendingResolve: ((confirmed: boolean) => void) | null = null;
  private readonly listeners = new Set<AiSqlExecuteDialogListener>();

  getRequest(): AiSqlExecuteDialogRequest | null {
    return this.request;
  }

  isOpen(): boolean {
    return this.request !== null;
  }

  open(next: AiSqlExecuteDialogRequest): Promise<boolean> {
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

  close(confirmed = false): void {
    if (!this.request && !this.pendingResolve) return;
    this.request = null;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.fireDidChange();
    resolve?.(confirmed);
  }

  onDidChange(listener: AiSqlExecuteDialogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const AiSqlExecuteDialogService = new AiSqlExecuteDialogServiceImpl();
