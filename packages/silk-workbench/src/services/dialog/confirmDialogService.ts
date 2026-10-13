export type ConfirmDialogRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type ConfirmDialogListener = () => void;

class ConfirmDialogServiceImpl {
  private request: ConfirmDialogRequest | null = null;
  private pendingResolve: ((confirmed: boolean) => void) | null = null;
  private readonly listeners = new Set<ConfirmDialogListener>();

  getRequest(): ConfirmDialogRequest | null {
    return this.request;
  }

  confirm(request: ConfirmDialogRequest): Promise<boolean> {
    if (this.pendingResolve) {
      this.pendingResolve(false);
      this.pendingResolve = null;
    }
    this.request = request;
    this.fireDidChange();
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  close(confirmed: boolean): void {
    if (!this.request && !this.pendingResolve) return;
    this.request = null;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.fireDidChange();
    resolve?.(confirmed);
  }

  onDidChange(listener: ConfirmDialogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) listener();
  }
}

export const ConfirmDialogService = new ConfirmDialogServiceImpl();
